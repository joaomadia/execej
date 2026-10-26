const DEFAULT_ONR_BASE_URL = "https://assinador-web.onr.org.br";

function onrApiKey(config) {
  const value = String(config?.onr_api_key || "").trim();
  if (!value) throw new Error("Informe a X-Api-Key da ONR nas configurações.");
  return value;
}

async function requestJson(config, endpoint, body) {
  const response = await fetch(`${DEFAULT_ONR_BASE_URL}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Api-Key": onrApiKey(config),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let result = text;
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    // Some API errors are returned as plain text.
  }
  if (!response.ok) {
    const message = typeof result === "string" ? result : JSON.stringify(result);
    if (response.status === 401) throw new Error("A ONR recusou a X-Api-Key. Confira o valor nas configurações.");
    if (response.status === 403) throw new Error("A X-Api-Key não tem permissão para assinar pela ONR.");
    throw new Error(`A ONR respondeu HTTP ${response.status}: ${message || response.statusText}`);
  }
  return result;
}

function signatureHashParameters(response) {
  const hashModel = response?.toSignHash || {};
  const toSign = response?.toSign || {};
  let hash = String(hashModel.value || toSign.hash || "").trim();
  if (!hash && hashModel.hexValue) {
    const hex = String(hashModel.hexValue).replace(/\s+/g, "");
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
      throw new Error("A ONR retornou um hash inválido para assinatura.");
    }
    hash = Buffer.from(hex, "hex").toString("base64");
  }
  if (!hash) throw new Error("A ONR não retornou o hash do documento para assinatura.");
  const digestName = String(hashModel.algorithm || toSign.signatureAlgorithm?.digestAlgorithm || "SHA256")
    .trim()
    .toUpperCase()
    .replace(/[_-]/g, "");
  const algorithms = {
    MD5: "MD5",
    SHA1: "SHA-1",
    SHA256: "SHA-256",
    SHA384: "SHA-384",
    SHA512: "SHA-512",
    SHA3256: "SHA3-256"
  };
  return {
    state: String(response?.state || "").trim(),
    hash,
    digestAlgorithm: algorithms[digestName] || digestName
  };
}

async function prepareSignature(config, { contentBase64, fileName, certificateContent }) {
  if (!contentBase64) throw new Error("Não há PDF para assinar.");
  const response = await requestJson(config, "/api/signature", {
    file: {
      content: contentBase64,
      name: fileName || "documento.pdf",
      mimeType: "application/pdf",
      contentType: "application/pdf"
    },
    certificate: { content: certificateContent },
    signatureType: "Pdf",
    pdfSignatureOptions: { convertToPdfA: false }
  });
  if (response?.success === false) {
    const reasons = {
      PdfAlreadySigned: "o PDF já contém assinatura digital",
      CorruptedPdf: "o PDF está corrompido",
      CertificateValidationFailed: "o certificado selecionado não foi aceito",
      PasswordProtectedPdf: "o PDF está protegido por senha",
      PdfAConversionFailed: "não foi possível preparar o PDF/A",
      PdfANonCompliant: "o documento não está em conformidade com PDF/A"
    };
    throw new Error(`A ONR recusou a preparação: ${reasons[response.failure] || response.failure || "erro não informado"}.`);
  }
  const parameters = signatureHashParameters(response);
  if (!parameters.state) throw new Error("A ONR não retornou o estado da assinatura.");
  return { response, ...parameters };
}

async function completeSignature(config, { state, signature }) {
  if (!state || !signature) throw new Error("Não foi possível concluir a assinatura digital.");
  return requestJson(config, "/api/signature/completion", { state, signature });
}

async function downloadSignedFile(config, file) {
  const embedded = String(file?.content || file?.Content || "").trim();
  if (embedded) return Buffer.from(embedded, "base64");
  const location = String(file?.location || file?.Location || file?.url || file?.Url || "").trim();
  if (!location) throw new Error("A ONR não retornou o PDF assinado.");
  const baseUrl = new URL(`${DEFAULT_ONR_BASE_URL}/`);
  const url = new URL(location, baseUrl);
  if (url.protocol !== "https:") throw new Error("A ONR retornou um endereço inseguro para o PDF assinado.");
  const sameOrigin = url.origin === baseUrl.origin;
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf, application/octet-stream, */*",
      ...(sameOrigin ? { "X-Api-Key": onrApiKey(config) } : {})
    }
  });
  if (!response.ok) throw new Error(`Falha ao baixar o PDF assinado da ONR (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function signedFileFromDocument(document) {
  const file = document?.signedFile || document?.SignedFile;
  return file && typeof file === "object" ? file : null;
}

module.exports = {
  DEFAULT_ONR_BASE_URL,
  completeSignature,
  downloadSignedFile,
  prepareSignature,
  signedFileFromDocument
};
