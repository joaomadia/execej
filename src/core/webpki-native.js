const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WEB_PKI_NOT_FOUND = "Componente Web PKI não encontrado. Instale o Web PKI da ONR e tente novamente.";
const KEY_USAGE_FLAGS = {
  crlSign: 2,
  dataEncipherment: 16,
  decipherOnly: 32768,
  digitalSignature: 128,
  encipherOnly: 1,
  keyAgreement: 8,
  keyCertSign: 4,
  keyEncipherment: 32,
  nonRepudiation: 64
};

function nativeHostCandidates() {
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Lacuna Software", "Web PKI");
  return [
    path.join(base, "native-host-chrome.json"),
    path.join(base, "native-host-edge.json"),
    path.join(base, "Lacuna.WebPKI.ChromeWin.exe")
  ];
}

function resolveNativeExecutable() {
  for (const candidate of nativeHostCandidates()) {
    try {
      const executable = candidate.endsWith(".json")
        ? path.resolve(path.dirname(candidate), JSON.parse(fs.readFileSync(candidate, "utf8")).path || "")
        : candidate;
      if (executable && fs.existsSync(executable)) return executable;
    } catch {
      // Try the next known installation location.
    }
  }
  throw new Error(WEB_PKI_NOT_FOUND);
}

function parseKeyUsage(value) {
  if (value && typeof value === "object") return value;
  const flags = Number(value) || 0;
  return Object.fromEntries(Object.entries(KEY_USAGE_FLAGS).map(([name, flag]) => [name, (flags & flag) !== 0]));
}

function normalizeCertificate(certificate) {
  return {
    ...certificate,
    keyUsage: parseKeyUsage(certificate.keyUsage),
    source: "Windows"
  };
}

function writeMessage(stream, message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length, 0);
  stream.write(Buffer.concat([size, payload]));
}

function runNativeCommand(config, command, request, options = {}) {
  const executable = resolveNativeExecutable();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd: path.dirname(executable),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: !options.authorizeSignatures
    });
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const pending = new Map();
    let stdoutBuffer = Buffer.alloc(0);
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`Tempo esgotado ao executar ${command} no Web PKI.`)), options.timeoutMs || 60000);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeAllListeners();
      try {
        child.kill();
      } catch {}
      if (error) reject(error);
      else resolve(value);
    }

    function send(commandName, commandRequest, id = requestId) {
      return new Promise((resolveMessage, rejectMessage) => {
        pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
        writeMessage(child.stdin, {
          requestId: id,
          license: config.webPkiLicense || "",
          domain: config.webPkiDomain || "localhost",
          command: commandName,
          request: commandRequest,
          language: "pt-BR",
          keepAlive: true,
          trace: false,
          pkcs11Modules: [],
          requireLicense: false
        });
      });
    }

    async function readSignatureBufferedContent(response) {
      const file = response?.signatureInfo?.file;
      if (!file?.streamId) return response;
      if (!Number.isFinite(Number(file.length)) || Number(file.length) < 0) {
        throw new Error("O Web PKI retornou uma assinatura em blocos com tamanho inválido.");
      }
      const chunks = [];
      let offset = 0;
      while (offset < Number(file.length)) {
        const chunkResult = await send("readBufferedContent", { streamId: file.streamId, offset }, `${requestId}-content-${offset}`);
        if (!chunkResult.success) {
          const error = new Error(chunkResult.exception?.message || stderr || "Falha ao ler a assinatura do Web PKI.");
          error.code = chunkResult.exception?.code;
          throw error;
        }
        const written = Number(chunkResult.response?.written) || 0;
        const chunk = String(chunkResult.response?.buffer || "");
        if (chunk) chunks.push(Buffer.from(chunk, "base64"));
        if (!written) throw new Error("O Web PKI interrompeu o envio da assinatura.");
        offset += written;
      }
      await send("finishBufferedContent", { streamId: file.streamId }, `${requestId}-content-finish`).catch(() => {});
      response.signatureInfo.content = Buffer.concat(chunks).toString("base64");
      delete response.signatureInfo.file;
      return response;
    }

    async function unwrap(result) {
      if (result.success) return readSignatureBufferedContent(result.response);
      if (result.exception?.code === "io_error" && result.streamId && result.streamLength) {
        let content = "";
        let offset = 0;
        while (offset < result.streamLength) {
          const id = `${requestId}-${offset}`;
          const chunkResult = await send("readBufferedResponse", { streamId: result.streamId, offset }, id);
          if (!chunkResult.success) {
            const error = new Error(chunkResult.exception?.message || stderr || "Falha ao ler a resposta do Web PKI.");
            error.code = chunkResult.exception?.code;
            throw error;
          }
          const chunk = String(chunkResult.response?.buffer || "");
          if (!chunk) break;
          content += chunk;
          offset += chunk.length;
        }
        await send("finishBufferedResponse", { streamId: result.streamId }, `${requestId}-finish`).catch(() => {});
        return readSignatureBufferedContent(JSON.parse(content));
      }
      const error = new Error(result.exception?.message || stderr || "Falha ao executar o Web PKI.");
      error.code = result.exception?.code;
      throw error;
    }

    child.stdout.on("data", (chunk) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      while (stdoutBuffer.length >= 4) {
        const length = stdoutBuffer.readUInt32LE(0);
        if (stdoutBuffer.length < length + 4) break;
        const payload = stdoutBuffer.subarray(4, length + 4).toString("utf8");
        stdoutBuffer = stdoutBuffer.subarray(length + 4);
        try {
          const result = JSON.parse(payload);
          pending.get(result.requestId)?.resolve(result);
          pending.delete(result.requestId);
        } catch (error) {
          finish(error);
          return;
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => finish(new Error(WEB_PKI_NOT_FOUND)));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(stderr || `O Web PKI foi encerrado inesperadamente (${code ?? "sem código"}).`));
    });

    (async () => {
      try {
        if (options.authorizeSignatures) {
          const authorization = await unwrap(await send("authorizeSignatures", {
            certificateThumbprint: options.authorizeSignatures.certificateThumbprint,
            signatureCount: options.authorizeSignatures.signatureCount || 1,
            enableDontAskAgain: false
          }));
          if (!authorization?.authorized) throw new Error("A autorização para usar o certificado foi cancelada.");
        }
        finish(null, await unwrap(await send(command, request)));
      } catch (error) {
        finish(error);
      }
    })();
  });
}

async function listCertificates(config) {
  const result = await runNativeCommand(config, "listCertificates", null);
  return Array.isArray(result) ? result.map(normalizeCertificate) : [];
}

function readCertificate(config, thumbprint) {
  return runNativeCommand(config, "readCertificate", { certificateThumbprint: thumbprint });
}

function signHash(config, { thumbprint, hash, digestAlgorithm }) {
  return runNativeCommand(config, "signHash", {
    certificateThumbprint: thumbprint,
    hash,
    digestAlgorithm
  }, {
    timeoutMs: 300000,
    authorizeSignatures: { certificateThumbprint: thumbprint, signatureCount: 1 }
  });
}

module.exports = { listCertificates, readCertificate, signHash };
