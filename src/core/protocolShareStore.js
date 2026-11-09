const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function protocolDirectoryName(id) {
  return crypto.createHash("sha256").update(String(id)).digest("hex");
}

function protocolIdentityKey(protocol = {}) {
  const officeProtocol = String(protocol.officeProtocol || protocol.office_protocol || "").trim().toUpperCase().replace(/\s+/g, "");
  const prenotation = String(protocol.prenotation || protocol.prenotacao || protocol.prenotação || "").replace(/\D/g, "");
  if (officeProtocol && prenotation) return `protocol:${officeProtocol}|${prenotation}`;
  const odsPath = String(protocol.odsPath || protocol.ods_path || "").trim();
  return odsPath ? `ods:${path.resolve(odsPath).toLowerCase()}` : "";
}

function createProtocolShareStore(rootPath) {
  const root = path.resolve(String(rootPath || ""));
  if (!rootPath) throw new Error("Escolha a pasta compartilhada dos protocolos.");
  const protocolsRoot = path.join(root, "Protocolos");

  function ensureAvailable() {
    let rootStat;
    try {
      rootStat = fs.statSync(root);
    } catch (error) {
      throw new Error(`A pasta compartilhada está indisponível: ${root}. ${error.message}`);
    }
    if (!rootStat.isDirectory()) throw new Error(`A pasta compartilhada não é uma pasta: ${root}`);
    fs.mkdirSync(protocolsRoot, { recursive: true });
  }

  function initialize() {
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(protocolsRoot, { recursive: true });
    if (!fs.statSync(protocolsRoot).isDirectory()) throw new Error("O local compartilhado não é uma pasta válida.");
    return { root, protocolsRoot };
  }

  function protocolDirectory(id) {
    if (!String(id || "").trim()) throw new Error("O protocolo não tem um identificador válido.");
    return path.join(protocolsRoot, protocolDirectoryName(id));
  }

  function protocolFile(id) {
    return path.join(protocolDirectory(id), "protocolo.json");
  }

  function protocolFolderPath(id) {
    return path.join(protocolDirectory(id), "Pasta");
  }

  function hasProtocol(id) {
    ensureAvailable();
    return fs.existsSync(protocolFile(id));
  }

  function listProtocols() {
    ensureAvailable();
    const protocols = [];
    for (const entry of fs.readdirSync(protocolsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(protocolsRoot, entry.name, "protocolo.json");
      if (!fs.existsSync(filePath)) continue;
      const protocol = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!protocol || typeof protocol !== "object" || Array.isArray(protocol) || !protocol.id) {
        throw new Error(`Cadastro de protocolo compartilhado inválido: ${filePath}`);
      }
      protocols.push(protocol);
    }
    return protocols;
  }

  function findProtocolByIdentity(protocol) {
    const identity = protocolIdentityKey(protocol);
    if (!identity) return null;
    return listProtocols().find((item) => protocolIdentityKey(item) === identity) || null;
  }

  function writeProtocol(filePath, protocol) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(protocol, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
    return protocol;
  }

  function importProtocol(protocol) {
    ensureAvailable();
    if (!protocol || typeof protocol !== "object" || !String(protocol.id || "").trim()) {
      throw new Error("O protocolo importado não tem um identificador válido.");
    }
    const identity = protocolIdentityKey(protocol);
    if (!identity) throw new Error("Não foi possível identificar o protocolo importado para evitar duplicação.");

    const lockPath = path.join(protocolsRoot, `.import-${protocolDirectoryName(identity)}.lock`);
    let lockFd;
    try {
      lockFd = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const concurrentDuplicate = findProtocolByIdentity(protocol);
      if (concurrentDuplicate) {
        return {
          created: false,
          updated: false,
          protocol: concurrentDuplicate
        };
      }
      throw new Error("Outra estação está importando este protocolo. Aguarde e atualize a lista antes de tentar novamente.");
    }

    try {
      const duplicate = findProtocolByIdentity(protocol);
      if (duplicate) {
        const merged = {
          ...duplicate,
          ...protocol,
          id: duplicate.id,
          createdAt: duplicate.createdAt || protocol.createdAt
        };
        writeProtocol(protocolFile(duplicate.id), merged);
        return { created: false, updated: true, protocol: merged };
      }

      const directory = protocolDirectory(protocol.id);
      fs.mkdirSync(directory, { recursive: true });
      try {
        return { created: true, updated: false, protocol: writeProtocol(path.join(directory, "protocolo.json"), protocol) };
      } catch (error) {
        try {
          fs.rmdirSync(directory);
        } catch (cleanupError) {
          if (cleanupError.code !== "ENOENT" && cleanupError.code !== "ENOTEMPTY") throw cleanupError;
        }
        throw error;
      }
    } catch (error) {
      throw error;
    } finally {
      fs.closeSync(lockFd);
      fs.rmSync(lockPath, { force: true });
    }
  }

  function saveProtocol(protocol) {
    ensureAvailable();
    const filePath = protocolFile(protocol?.id);
    if (!fs.existsSync(filePath)) throw new Error("O protocolo ainda não foi publicado na pasta compartilhada.");
    return writeProtocol(filePath, protocol);
  }

  return {
    root,
    initialize,
    protocolFolderPath,
    hasProtocol,
    listProtocols,
    findProtocolByIdentity,
    importProtocol,
    saveProtocol
  };
}

module.exports = { createProtocolShareStore, protocolIdentityKey };
