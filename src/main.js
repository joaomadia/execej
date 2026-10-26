const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const core = require("./core");
const onrApi = require("./core/onr-api");
const webPkiNative = require("./core/webpki-native");

const APP_VERSION = app.getVersion();
autoUpdater.logger = log;
autoUpdater.autoDownload = false;

let mainWindow;
const autuationPreviewDirs = new Map();
let cachedWebPkiLicense = "";

function removeAutuationPreview(id) {
  const dir = autuationPreviewDirs.get(id);
  if (!dir) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  autuationPreviewDirs.delete(id);
  return true;
}

function removeAllAutuationPreviews() {
  for (const id of autuationPreviewDirs.keys()) {
    try {
      removeAutuationPreview(id);
    } catch (error) {
      log.error(`Não foi possível remover a prévia temporária ${id}:`, error);
    }
  }
}

function webPkiResultString(value, keys) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  return "";
}

function certificateContentFromWebPki(value) {
  return webPkiResultString(value, ["certificate", "content", "encodedCertificate", "value"])
    .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "")
    .trim();
}

async function configForOnrSignature(config, forceRefresh = false) {
  if (!config.onr_signature_enabled) throw new Error("A assinatura ONR está desativada nas configurações.");
  if (!String(config.onr_api_key || "").trim()) throw new Error("Informe a X-Api-Key da ONR nas configurações.");
  if (forceRefresh) cachedWebPkiLicense = "";
  if (cachedWebPkiLicense && !forceRefresh) return { ...config, webPkiLicense: cachedWebPkiLicense };
  let response;
  try {
    response = await fetch(`${onrApi.DEFAULT_ONR_BASE_URL}/api/configuration`, {
      headers: { Accept: "application/json, text/plain, */*" }
    });
  } catch (error) {
    throw new Error(`Não foi possível obter a configuração Web PKI da ONR: ${error.message}`);
  }
  if (!response.ok) throw new Error(`A ONR respondeu HTTP ${response.status} ao carregar a configuração Web PKI.`);
  const configuration = await response.json();
  cachedWebPkiLicense = String(configuration?.webPki?.license || "").trim();
  if (!cachedWebPkiLicense) throw new Error("A ONR não retornou uma licença para o componente Web PKI.");
  return { ...config, webPkiLicense: cachedWebPkiLicense };
}

function isWebPkiLicenseError(error) {
  return error?.code === "license_invalid"
    || /invalid license|license_invalid|licen[cç]a.*web pki/i.test(String(error?.message || error || ""));
}

async function runWithValidWebPkiLicense(config, operation) {
  const resolvedConfig = await configForOnrSignature(config);
  try {
    return await operation(resolvedConfig);
  } catch (error) {
    if (!isWebPkiLicenseError(error)) throw error;
    const refreshedConfig = await configForOnrSignature(config, true);
    return operation(refreshedConfig);
  }
}

function notifyOnrSigningProgress(sender, message) {
  if (sender && !sender.isDestroyed()) sender.send("onr:signingProgress", message);
}

async function signOnrPdfFiles(filePaths, certificateThumbprint, sender) {
  const config = await configForOnrSignature(loadConfig());
  const thumbprint = String(certificateThumbprint || "").trim();
  const paths = Array.isArray(filePaths) ? filePaths.map((item) => path.resolve(String(item || ""))) : [];
  if (!thumbprint) throw new Error("Selecione um certificado digital para assinar.");
  if (!paths.length) throw new Error("Nenhum PDF foi informado para assinatura ONR.");
  for (const filePath of paths) {
    if (path.extname(filePath).toLowerCase() !== ".pdf" || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Arquivo PDF inválido para assinatura ONR: ${filePath}`);
    }
  }

  const certificateResult = await runWithValidWebPkiLicense(
    config,
    (resolvedConfig) => webPkiNative.readCertificate(resolvedConfig, thumbprint)
  );
  const certificateContent = certificateContentFromWebPki(certificateResult);
  if (!certificateContent) throw new Error("O Web PKI não retornou o certificado selecionado.");
  const stagedFiles = [];
  const tempDirs = [];
  let operationError = null;
  try {
    for (const [index, filePath] of paths.entries()) {
      notifyOnrSigningProgress(sender, `Assinando PDF ${index + 1} de ${paths.length}: ${path.basename(filePath)}`);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej_onr_sign_"));
      tempDirs.push(tempDir);
      const pdfaPath = path.join(tempDir, "preparado.pdf");
      const conversion = await core.convertPdfToPdfAIfPossible(filePath, pdfaPath);
      if (!conversion.pdfa) {
        throw new Error(`Não foi possível preparar "${path.basename(filePath)}" em PDF/A para assinatura ONR. ${conversion.warning || "Verifique se o Ghostscript está instalado."}`);
      }
      const prepared = await onrApi.prepareSignature(config, {
        contentBase64: fs.readFileSync(pdfaPath).toString("base64"),
        fileName: path.basename(filePath),
        certificateContent
      });
      const nativeResult = await runWithValidWebPkiLicense(config, (resolvedConfig) => (
        webPkiNative.signHash(resolvedConfig, {
          thumbprint,
          hash: prepared.hash,
          digestAlgorithm: prepared.digestAlgorithm
        })
      ));
      const signature = webPkiResultString(nativeResult, ["signature", "value", "signedData", "content"])
        || webPkiResultString(nativeResult?.signatureInfo, ["signature", "value", "content"]);
      if (!signature) throw new Error("O Web PKI não retornou a assinatura digital.");
      const document = await onrApi.completeSignature(config, { state: prepared.state, signature });
      const signedFile = onrApi.signedFileFromDocument(document);
      if (!signedFile) throw new Error("A ONR não retornou o PDF assinado.");
      const signedPdf = await onrApi.downloadSignedFile(config, signedFile);
      if (!signedPdf.subarray(0, 4).equals(Buffer.from("%PDF"))) {
        throw new Error(`A ONR retornou um arquivo inválido para "${path.basename(filePath)}".`);
      }
      const stagedPath = path.join(path.dirname(filePath), `.execej-onr-${crypto.randomUUID()}.tmp`);
      const staged = { filePath, stagedPath, backupPath: "", preserveBackup: false };
      stagedFiles.push(staged);
      fs.writeFileSync(stagedPath, signedPdf);
    }

    const replaced = [];
    try {
      for (const staged of stagedFiles) {
        staged.backupPath = path.join(path.dirname(staged.filePath), `.execej-onr-backup-${crypto.randomUUID()}.tmp`);
        fs.copyFileSync(staged.filePath, staged.backupPath);
        replaced.push(staged);
        fs.copyFileSync(staged.stagedPath, staged.filePath);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const staged of [...replaced].reverse()) {
        try {
          fs.copyFileSync(staged.backupPath, staged.filePath);
        } catch (rollbackError) {
          staged.preserveBackup = true;
          rollbackErrors.push(`${staged.backupPath}: ${rollbackError.message}`);
        }
      }
      if (rollbackErrors.length) {
        throw new Error(`${error.message} Não foi possível restaurar todos os PDFs; cópias de segurança preservadas em: ${rollbackErrors.join("; ")}`);
      }
      throw error;
    }
    notifyOnrSigningProgress(sender, `${paths.length} PDF(s) assinado(s) pela ONR.`);
    return paths;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const staged of stagedFiles) {
      try {
        fs.rmSync(staged.stagedPath, { force: true });
      } catch (error) {
        cleanupErrors.push(`${staged.stagedPath}: ${error.message}`);
      }
      if (staged.backupPath && !staged.preserveBackup) {
        try {
          fs.rmSync(staged.backupPath, { force: true });
        } catch (error) {
          cleanupErrors.push(`${staged.backupPath}: ${error.message}`);
        }
      }
    }
    for (const tempDir of tempDirs) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(`${tempDir}: ${error.message}`);
      }
    }
    if (cleanupErrors.length) {
      const message = `Não foi possível remover arquivos temporários da assinatura ONR: ${cleanupErrors.join("; ")}`;
      if (operationError) log.error(message);
      else throw new Error(message);
    }
  }
}

const CONFIG_FILE = "config_execej.json";
const PROTOCOLS_FILE = "protocolos_execej.json";
const STORAGE_MIGRATION_MARKER = "storage_migration_execej_v1.json";
const LEGACY_CONFIG_FILES = ["config_notif9514.json"];
const LEGACY_PROTOCOLS_FILES = ["protocolos_notif9514.json"];
const LEGACY_USER_DATA_NAMES = ["EXECEJ", "execej", "Notif 9514", "notif-9514", "Notif9514", "notif9514"];

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

function protocolsPath() {
  return path.join(app.getPath("userData"), PROTOCOLS_FILE);
}

function migrationMarkerPath() {
  return path.join(app.getPath("userData"), STORAGE_MIGRATION_MARKER);
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((item) => {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function storageDirs() {
  const appData = app.getPath("appData");
  return uniquePaths([
    app.getPath("userData"),
    app.getAppPath(),
    process.cwd(),
    path.dirname(process.execPath),
    ...LEGACY_USER_DATA_NAMES.map((name) => path.join(appData, name))
  ]);
}

function storageCandidates(targetPath, fileNames) {
  const target = path.resolve(targetPath);
  const names = [...new Set(fileNames)];
  return uniquePaths(storageDirs().flatMap((dir) => names.map((name) => path.join(dir, name))))
    .filter((candidate) => path.resolve(candidate) !== target);
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function migrateJsonStorageIfMissing(targetPath, candidates, isValid, preferNonEmptyArray = false) {
  if (fs.existsSync(targetPath)) return;
  const valid = candidates
    .map((candidate) => ({ candidate, data: readJsonFile(candidate) }))
    .filter(({ data }) => isValid(data));
  if (!valid.length) return;
  const chosen = preferNonEmptyArray
    ? valid.find(({ data }) => Array.isArray(data) && data.length) || valid[0]
    : valid[0];
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(chosen.candidate, targetPath);
}

function protocolStorageKey(protocol = {}) {
  const id = String(protocol.id || "").trim();
  if (id) return `id:${id}`;
  const office = String(protocol.officeProtocol || protocol.office_protocol || "").trim().toUpperCase();
  const prenotation = String(protocol.prenotation || protocol.prenotacao || protocol.prenotação || "").trim();
  if (office && prenotation) return `protocol:${office}|${prenotation.replace(/\D/g, "")}`;
  const odsPath = String(protocol.odsPath || protocol.ods_path || "").trim().toLowerCase();
  if (odsPath) return `ods:${odsPath}`;
  const folderPath = String(protocol.folderPath || protocol.protocolFolder || protocol.folder_path || "").trim().toLowerCase();
  if (folderPath) return `folder:${folderPath}`;
  return `name:${String(protocol.name || "").trim().toLowerCase()}`;
}

function protocolTime(protocol = {}) {
  return Date.parse(protocol.updatedAt || protocol.updated_at || protocol.createdAt || protocol.created_at || "") || 0;
}

function mergeStoredProtocols(lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const protocol of list) {
      if (!protocol || typeof protocol !== "object") continue;
      const key = protocolStorageKey(protocol);
      const current = byKey.get(key);
      if (!current || protocolTime(protocol) >= protocolTime(current)) byKey.set(key, protocol);
    }
  }
  return [...byKey.values()];
}

function writeMigrationMarker() {
  fs.mkdirSync(path.dirname(migrationMarkerPath()), { recursive: true });
  fs.writeFileSync(migrationMarkerPath(), JSON.stringify({ migratedAt: new Date().toISOString() }, null, 2), "utf8");
}

function migrateProtocolsStorageOnce() {
  if (fs.existsSync(migrationMarkerPath())) return;
  const candidates = uniquePaths([
    protocolsPath(),
    ...storageCandidates(protocolsPath(), [PROTOCOLS_FILE, ...LEGACY_PROTOCOLS_FILES])
  ]);
  const protocolLists = candidates.map(readJsonFile).filter(Array.isArray);
  const merged = mergeStoredProtocols(protocolLists);
  if (merged.length) {
    fs.mkdirSync(path.dirname(protocolsPath()), { recursive: true });
    fs.writeFileSync(protocolsPath(), JSON.stringify(merged, null, 2), "utf8");
  }
  writeMigrationMarker();
}

function migrateLegacyStorage() {
  migrateJsonStorageIfMissing(
    configPath(),
    storageCandidates(configPath(), [CONFIG_FILE, ...LEGACY_CONFIG_FILES]),
    (data) => data && typeof data === "object" && !Array.isArray(data)
  );
  migrateProtocolsStorageOnce();
}

function bundledResourcePath(name) {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), name);
}

function loadConfig() {
  migrateLegacyStorage();
  let loaded;
  try {
    loaded = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    loaded = {};
  }
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) loaded = {};
  if (loaded.onr_api_key_encrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Não foi possível desbloquear a X-Api-Key da ONR neste computador.");
    }
    try {
      loaded.onr_api_key = safeStorage.decryptString(Buffer.from(loaded.onr_api_key_encrypted, "base64"));
    } catch (error) {
      throw new Error(`Não foi possível ler a X-Api-Key criptografada da ONR: ${error.message}`);
    }
  } else if (String(loaded.onr_api_key || "").trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("O armazenamento seguro do Windows não está disponível para proteger a X-Api-Key da ONR.");
    }
    loaded.onr_api_key_encrypted = safeStorage.encryptString(String(loaded.onr_api_key).trim()).toString("base64");
    delete loaded.onr_api_key;
    fs.writeFileSync(configPath(), JSON.stringify(loaded, null, 2), "utf8");
  }
  delete loaded.onr_api_key_encrypted;
  const hasRtdCostTable = Object.prototype.hasOwnProperty.call(loaded, "rtd_cost_table")
    || Object.prototype.hasOwnProperty.call(loaded, "rtdCostTable");
  const config = core.normalizeConfig(loaded);
  if (!config.base_protocol_template) {
    const fallback = bundledResourcePath("Protocolo Geral.ods");
    if (fs.existsSync(fallback)) config.base_protocol_template = fallback;
  }
  return hasRtdCostTable ? config : hydrateRtdCostTable(config);
}

function protocolContextFromPathStrict(filePath) {
  const candidates = [path.basename(filePath || "", path.extname(filePath || "")), path.basename(path.dirname(filePath || ""))];
  for (const text of candidates) {
    const match = String(text || "").match(/(IN[\w.-]+)\s*-\s*([0-9.]+)/i);
    if (match) {
      return {
        officeProtocol: match[1].toUpperCase(),
        prenotation: core.formatPrenotation(match[2])
      };
    }
  }
  return { officeProtocol: "", prenotation: "" };
}

function protocolLabel(protocol) {
  const name = String(protocol.name || "").trim();
  if (name && !(name === "Rascunho" && (protocol.officeProtocol || protocol.prenotation))) return name;
  if (protocol.officeProtocol && protocol.prenotation) return `Protocolo ${protocol.officeProtocol} - ${protocol.prenotation}`;
  if (protocol.officeProtocol) return `Rascunho ${protocol.officeProtocol}`;
  if (protocol.odsPath) return path.basename(protocol.odsPath, path.extname(protocol.odsPath));
  return "Rascunho";
}

function baseProtocolTemplatePath() {
  try {
    const configured = loadConfig().base_protocol_template;
    if (configured && fs.existsSync(configured)) return configured;
  } catch {}
  const fallback = bundledResourcePath("Protocolo Geral.ods");
  return fs.existsSync(fallback) ? fallback : "";
}

function hydrateRtdCostTable(config) {
  if (Array.isArray(config.rtd_cost_table) && config.rtd_cost_table.length) return config;
  const candidates = [
    config.base_protocol_template,
    bundledResourcePath("Protocolo Geral.ods")
  ].filter((candidate) => candidate && fs.existsSync(candidate));
  for (const candidate of candidates) {
    try {
      const table = core.rtdCostTableFromWorkbook(core.protocolSheetsFromOds(candidate));
      if (table.length) return { ...config, rtd_cost_table: table };
    } catch {}
  }
  return config;
}

function workbookForProtocol(protocol = {}) {
  if (protocol.sheets && typeof protocol.sheets === "object") {
    return core.normalizeWorkbookData({ sheetOrder: protocol.sheetOrder, sheets: protocol.sheets });
  }
  const source = String(protocol.odsPath || "").trim();
  if (source && fs.existsSync(source)) return core.protocolSheetsFromOds(source);
  const template = baseProtocolTemplatePath();
  if (template) return core.protocolSheetsFromOds(template);
  return core.normalizeWorkbookData();
}

function normalizeProtocol(protocol = {}, touch = true) {
  const now = new Date().toISOString();
  const odsPath = String(protocol.odsPath || "").trim();
  const inferred = odsPath ? protocolContextFromPathStrict(odsPath) : { officeProtocol: "", prenotation: "" };
  const officeProtocol = String(protocol.officeProtocol || inferred.officeProtocol || "").trim().toUpperCase().replace(/\s+/g, "");
  const prenotationRaw = String(protocol.prenotation || inferred.prenotation || "").trim();
  const prenotation = prenotationRaw ? core.formatPrenotation(prenotationRaw) : "";
  const folderPath = String(protocol.folderPath || protocol.protocolFolder || (odsPath ? path.dirname(odsPath) : "")).trim();
  const normalized = {
    id: String(protocol.id || crypto.randomUUID()),
    name: String(protocol.name || "").trim(),
    officeProtocol,
    prenotation,
    odsPath,
    folderPath,
    status: prenotation ? "Vinculado" : "Rascunho",
    createdAt: protocol.createdAt || now,
    updatedAt: touch ? now : (protocol.updatedAt || now)
  };
  normalized.autuacoesMovimentacoes = Object.fromEntries(
    Object.entries(protocol.autuacoesMovimentacoes && typeof protocol.autuacoesMovimentacoes === "object" ? protocol.autuacoesMovimentacoes : {})
      .filter(([rowIndex, record]) => /^\d+$/.test(rowIndex) && record && Array.isArray(record.files))
      .map(([rowIndex, record]) => [rowIndex, {
        files: record.files.map((file) => String(file || "").trim()).filter(Boolean),
        parts: Array.isArray(record.parts)
          ? record.parts.map((part) => ({
            file: String(part.file || "").trim(),
            order: Number(part.order) || 0
          })).filter((part) => part.file)
          : [],
        hasAttachments: Boolean(record.hasAttachments),
        movement: String(record.movement || "").trim(),
        documentName: String(record.documentName || "").trim(),
        autuadoEm: String(record.autuadoEm || "")
      }])
      .filter(([, record]) => record.files.length > 0)
  );
  const config = loadConfig();
  const workbook = core.applyProtocolWorkbookCalculations(workbookForProtocol(protocol), {
    prenotation,
    basePrenotationValue: config.base_prenotation_value,
    rtdCostTable: config.rtd_cost_table,
    movement_document_rules: config.movement_document_rules
  });
  normalized.sheetOrder = workbook.sheetOrder;
  normalized.sheets = workbook.sheets;
  normalized.label = protocolLabel(normalized);
  return normalized;
}

function loadProtocols() {
  migrateLegacyStorage();
  try {
    const data = JSON.parse(fs.readFileSync(protocolsPath(), "utf8"));
    const protocols = Array.isArray(data) ? data : [];
    return protocols.map((protocol) => normalizeProtocol(protocol, false)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function saveProtocols(protocols) {
  fs.mkdirSync(path.dirname(protocolsPath()), { recursive: true });
  fs.writeFileSync(protocolsPath(), JSON.stringify(protocols.map((protocol) => normalizeProtocol(protocol, false)), null, 2), "utf8");
  return loadProtocols();
}

function saveProtocol(protocol) {
  const protocols = loadProtocols();
  const normalized = normalizeProtocol(protocol);
  const index = protocols.findIndex((item) => item.id === normalized.id);
  if (index >= 0) protocols[index] = { ...protocols[index], ...normalized, createdAt: protocols[index].createdAt || normalized.createdAt };
  else protocols.push(normalized);
  saveProtocols(protocols);
  return loadProtocols().find((item) => item.id === normalized.id) || normalized;
}

function deleteProtocol(id) {
  saveProtocols(loadProtocols().filter((protocol) => protocol.id !== id));
  return loadProtocols();
}

function findProtocol(id) {
  return loadProtocols().find((protocol) => protocol.id === id) || null;
}

function protocolTempOdsPath(protocol) {
  const tempDir = fs.mkdtempSync(path.join(app.getPath("temp"), "execej_protocol_"));
  const output = path.join(tempDir, `${safeDocumentFilePart(protocol.label || protocol.id, "protocolo")}.ods`);
  const config = loadConfig();
  const workbook = core.applyProtocolWorkbookCalculations({
    sheetOrder: protocol.sheetOrder,
    sheets: protocol.sheets
  }, {
    prenotation: protocol.prenotation,
    basePrenotationValue: config.base_prenotation_value,
    rtdCostTable: config.rtd_cost_table,
    movement_document_rules: config.movement_document_rules
  });
  core.writeWorkbookOds(output, workbook);
  return { tempDir, odsPath: output };
}

async function withProtocolOds(payload, fn) {
  const protocolId = String(payload?.protocolId || "").trim();
  if (!protocolId) return fn(payload?.odsPath || "");
  const protocol = findProtocol(protocolId);
  if (!protocol) throw new Error("Selecione um protocolo válido.");
  const prepared = protocolTempOdsPath(protocol);
  try {
    return await fn(prepared.odsPath, protocol);
  } finally {
    fs.rmSync(prepared.tempDir, { recursive: true, force: true });
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  const normalized = core.normalizeConfig(config);
  const apiKey = String(normalized.onr_api_key || "").trim();
  delete normalized.onr_api_key;
  if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("O armazenamento seguro do Windows não está disponível para guardar a X-Api-Key da ONR.");
    }
    normalized.onr_api_key_encrypted = safeStorage.encryptString(apiKey).toString("base64");
  } else {
    normalized.onr_api_key_encrypted = "";
  }
  fs.writeFileSync(configPath(), JSON.stringify(normalized, null, 2), "utf8");
  return loadConfig();
}

function safeDocumentFilePart(value, fallback = "documento") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 130);
  return cleaned || fallback;
}

function titleCaseFirstLetter(value) {
  const text = String(value || "").trim();
  return text ? `${text[0].toLocaleUpperCase("pt-BR")}${text.slice(1)}` : text;
}

function documentFilenameLabel(kind) {
  return titleCaseFirstLetter(String(kind || "").replace(/^Criar\s+/i, "").trim() || kind);
}

function shortFileDate(value) {
  const date = core.fileDateFromText(core.formatDateForDocument(value || new Date().toLocaleDateString("pt-BR")));
  const match = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[1]}.${match[2]}.${match[3].slice(-2)}` : safeDocumentFilePart(value, "data");
}

function fieldFromRecord(fields, aliases) {
  for (const alias of aliases) {
    const direct = fields[alias];
    if (direct !== undefined && String(direct).trim()) return String(direct).trim();
    const normalized = fields[core.normalizeKey(alias)];
    if (normalized !== undefined && String(normalized).trim()) return String(normalized).trim();
  }
  for (const [key, value] of Object.entries(fields)) {
    const normalizedKey = core.normalizeKey(key);
    if ((normalizedKey.includes("CIDADE") || normalizedKey.includes("MUNICIPIO")) && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function exactFieldFromRecord(fields, aliases) {
  const list = Array.isArray(aliases) ? aliases : [aliases];
  const wanted = new Set(list.map(core.normalizeKey));
  for (const alias of list) {
    const direct = fields[alias];
    if (direct !== undefined && String(direct).trim()) return String(direct).trim();
    const normalized = fields[core.normalizeKey(alias)];
    if (normalized !== undefined && String(normalized).trim()) return String(normalized).trim();
  }
  for (const [key, value] of Object.entries(fields)) {
    if (wanted.has(core.normalizeKey(key)) && String(value).trim()) return String(value).trim();
  }
  return "";
}

function letterAddressFromRecord(record) {
  const fields = record.fields || {};
  const street = exactFieldFromRecord(fields, [
    "ENDEREÇO",
    "ENDERECO",
    "ENDEREÇO COMPLETO",
    "ENDERECO COMPLETO",
    "ENDEREÇO NOTIFICAÇÃO",
    "ENDERECO NOTIFICACAO",
    "ENDEREÇO DA NOTIFICAÇÃO",
    "ENDERECO DA NOTIFICACAO",
    "ENDEREÇO DO DEVEDOR",
    "ENDERECO DO DEVEDOR",
    "LOGRADOURO",
    "RUA"
  ]);
  if (!street) return "";
  const parts = [
    street,
    exactFieldFromRecord(fields, ["NÚMERO", "NUMERO", "NUMERO ENDEREÇO", "NÚMERO ENDEREÇO"]),
    exactFieldFromRecord(fields, ["COMPLEMENTO", "COMPL"]),
    exactFieldFromRecord(fields, ["BAIRRO"]),
    exactFieldFromRecord(fields, ["CIDADE/UF", "CIDADE UF", "CIDADE", "MUNICÍPIO", "MUNICIPIO"])
  ];
  const compact = [];
  for (const part of parts) {
    const text = String(part || "").trim();
    if (text && !compact.some((item) => core.normalizeKey(item) === core.normalizeKey(text))) compact.push(text);
  }
  return compact.join(", ");
}

function uniqueOutputPath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const folder = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let index = 2;
  let candidate = path.join(folder, `${base} (${index})${ext}`);
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = path.join(folder, `${base} (${index})${ext}`);
  }
  return candidate;
}

function listFolderEntries(folderPath, depth = 0, state = { count: 0, truncated: false }) {
  const maxDepth = 4;
  const maxEntries = 700;
  try {
    if (!folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return { folderPath, exists: false, entries: [], truncated: false };
    }
  } catch {
    return { folderPath, exists: false, entries: [], truncated: false };
  }
  const entries = [];
  const dirents = fs.readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("~$"))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
  for (const entry of dirents) {
    if (state.count >= maxEntries) {
      state.truncated = true;
      break;
    }
    const fullPath = path.join(folderPath, entry.name);
    let stat = null;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    state.count += 1;
    const item = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? "folder" : "file",
      size: entry.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString(),
      children: []
    };
    if (entry.isDirectory() && depth < maxDepth) {
      item.children = listFolderEntries(fullPath, depth + 1, state).entries;
    }
    entries.push(item);
  }
  return { folderPath, exists: true, entries, truncated: state.truncated };
}

function documentOutputPath(outputDir, kind, record, options = {}) {
  if (options.mergeKind === "letters") {
    const address = letterAddressFromRecord(record);
    const name = address ? `${record.displayName} (${address})` : record.displayName;
    const parts = [
      shortFileDate(options.dateValue),
      name
    ].filter((part) => String(part || "").trim());
    return uniqueOutputPath(path.join(outputDir, `${parts.map((part) => safeDocumentFilePart(part)).join(" - ")}.odt`));
  }
  const fields = record.fields || {};
  const city = fieldFromRecord(fields, [
    "CIDADE",
    "MUNICÍPIO",
    "MUNICIPIO",
    "CIDADE NOTIFICAÇÃO",
    "CIDADE DA NOTIFICAÇÃO",
    "CIDADE DO ENDEREÇO",
    "CIDADE ENDEREÇO"
  ]);
  const parts = [
    documentFilenameLabel(kind),
    record.displayName,
    city
  ].filter((part) => String(part || "").trim());
  return uniqueOutputPath(path.join(outputDir, `${parts.map((part) => safeDocumentFilePart(part)).join(" - ")}.odt`));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    title: `EXECEJ v${APP_VERSION}`,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", removeAllAutuationPreviews);
}

app.whenReady().then(() => {
  migrateLegacyStorage();
  createWindow();
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 1500);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:version", () => APP_VERSION);
ipcMain.handle("config:load", () => loadConfig());
ipcMain.handle("config:save", (_event, config) => saveConfig(config));
ipcMain.handle("protocols:list", () => loadProtocols());
ipcMain.handle("protocols:save", (_event, protocol) => saveProtocol(protocol));
ipcMain.handle("protocols:delete", (_event, id) => deleteProtocol(id));
ipcMain.handle("protocols:inspectOds", (_event, odsPath) => normalizeProtocol({ odsPath }));
ipcMain.handle("protocols:listFiles", (_event, folderPath) => listFolderEntries(String(folderPath || "").trim()));
ipcMain.handle("onr:certificates:list", async () => {
  const config = loadConfig();
  return runWithValidWebPkiLicense(config, (resolvedConfig) => webPkiNative.listCertificates(resolvedConfig));
});

ipcMain.handle("dialog:file", async (_event, { kind, title, filters }) => {
  const result = kind === "folder"
    ? await dialog.showOpenDialog(mainWindow, { title, properties: ["openDirectory"] })
    : await dialog.showOpenDialog(mainWindow, { title, filters, properties: ["openFile"] });
  return result.canceled ? "" : result.filePaths[0];
});

ipcMain.handle("dialog:files", async (_event, { title, filters }) => {
  const result = await dialog.showOpenDialog(mainWindow, { title, filters, properties: ["openFile", "multiSelections"] });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("shell:openPath", (_event, target) => shell.openPath(target));
ipcMain.handle("ods:sheets", (_event, odsPath) => core.listOdsSheets(odsPath));
ipcMain.handle("merge:names", (_event, payload) => withProtocolOds(payload, (odsPath) => (
  core.extractRecords(odsPath, payload.sheetName, payload.nameCol, payload.firstRowHeader)
)));
ipcMain.handle("initial:create", (_event, payload) => core.createInitialFolder(loadConfig(), payload));
ipcMain.handle("movements:analyze", (_event, payload) => withProtocolOds(payload, (odsPath) => (
  core.analyzeMovements(odsPath, payload.sheetName, loadConfig())
)));
ipcMain.handle("movements:attachmentRequirements", (_event, payload) => withProtocolOds(payload, (odsPath) => (
  core.movementAttachmentRequirements(odsPath, payload.sheetName, payload.sourceRowIndex, loadConfig())
)));
ipcMain.handle("movements:autuationPreview", async (_event, protocolId) => {
  const protocol = findProtocol(String(protocolId || "").trim());
  if (!protocol) throw new Error("Selecione um protocolo válido para visualizar as autuações.");
  const id = crypto.randomUUID();
  const tempDir = fs.mkdtempSync(path.join(app.getPath("temp"), "execej_autuacao_preview_"));
  try {
    const filePath = await core.createAutuationPreview(
      protocol.autuacoesMovimentacoes,
      protocol.folderPath,
      tempDir
    );
    autuationPreviewDirs.set(id, tempDir);
    return { id, filePath };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
});
ipcMain.handle("movements:autuationPreview:close", (_event, id) => (
  removeAutuationPreview(String(id || ""))
));
ipcMain.handle("movements:autuar", async (_event, payload) => {
  const protocolId = String(payload?.protocolId || "").trim();
  const sourceRowIndex = Number(payload?.sourceRowIndex);
  if (!protocolId || !Number.isInteger(sourceRowIndex) || sourceRowIndex < 0) {
    throw new Error("Selecione um protocolo e uma movimentação válidos para autuar.");
  }
  return withProtocolOds(payload, async (odsPath, protocol) => {
    const rowKey = String(sourceRowIndex);
    if (protocol.autuacoesMovimentacoes?.[rowKey]) throw new Error("Esta movimentação já foi autuada.");
    const protocolFolder = payload.protocolFolder || protocol.folderPath;
    const generated = await core.autuarMovimentacao(loadConfig(), {
      ...payload,
      odsPath,
      protocolFolder
    });
    const autuacoesMovimentacoes = {
      ...(protocol.autuacoesMovimentacoes || {}),
      [rowKey]: {
        files: generated.files,
        parts: generated.parts,
        hasAttachments: generated.hasAttachments,
        movement: generated.movement,
        documentName: generated.documentName,
        autuadoEm: new Date().toISOString()
      }
    };
    try {
      if (payload.certificateThumbprint) {
        if (!generated.signatureFiles.length) {
          throw new Error("Não foi encontrada a folha de autuação com Nome e Cargo para assinatura.");
        }
        await signOnrPdfFiles(generated.signatureFiles, payload.certificateThumbprint);
      }
      const saved = saveProtocol({ ...protocol, autuacoesMovimentacoes });
      return { protocol: saved };
    } catch (error) {
      core.estornarAutuacaoFiles(protocolFolder, generated.files);
      throw error;
    }
  });
});
ipcMain.handle("movements:estornarAutuacao", async (_event, payload) => {
  const protocolId = String(payload?.protocolId || "").trim();
  const sourceRowIndex = Number(payload?.sourceRowIndex);
  if (!protocolId || !Number.isInteger(sourceRowIndex) || sourceRowIndex < 0) {
    throw new Error("Selecione um protocolo e uma movimentação válidos para estornar.");
  }
  const protocol = findProtocol(protocolId);
  if (!protocol) throw new Error("Selecione um protocolo válido.");
  const rowKey = String(sourceRowIndex);
  const autuacao = protocol.autuacoesMovimentacoes?.[rowKey];
  if (!autuacao) throw new Error("Esta movimentação não possui autuação registrada.");
  core.estornarAutuacaoFiles(protocol.folderPath, autuacao.files);
  const autuacoesMovimentacoes = { ...protocol.autuacoesMovimentacoes };
  delete autuacoesMovimentacoes[rowKey];
  return { protocol: saveProtocol({ ...protocol, autuacoesMovimentacoes }) };
});
ipcMain.handle("finalPdf:generate", async (event, payload) => {
  return withProtocolOds(payload, async (odsPath, protocol) => {
    const result = await core.generateFinalPdf(loadConfig(), {
      ...payload,
      odsPath,
      protocolFolder: payload.protocolFolder || protocol?.folderPath || "",
      autuacoesMovimentacoes: protocol?.autuacoesMovimentacoes || {}
    }, (message) => {
      event.sender.send("finalPdf:progress", message);
    });
    if (payload.certificateThumbprint) {
      await signOnrPdfFiles([result.output], payload.certificateThumbprint, event.sender);
    }
    return result;
  });
});
ipcMain.handle("pdfa:convert", async (event, payload) => {
  return core.convertAnyFileToPdfA(payload, (message) => {
    event.sender.send("pdfa:progress", message);
  });
});
ipcMain.handle("arisp:generate", async (event, payload) => {
  return core.generateArispStats(loadConfig(), payload, (message) => {
    event.sender.send("arisp:progress", message);
  });
});
ipcMain.handle("note:preview", (_event, payload) => {
  return payload.mode === "blank"
    ? core.noteTextsFromItems(payload.matricula, payload.items || [])
    : core.buildNoteRequirementTexts(payload.matricula, payload);
});
ipcMain.handle("note:generate", async (event, payload) => {
  const result = core.generateNote(loadConfig(), payload);
  if (payload.certificateThumbprint) {
    await signOnrPdfFiles([result.output], payload.certificateThumbprint, event.sender);
  }
  return result;
});

ipcMain.handle("documents:generate", async (_event, payload) => {
  const config = loadConfig();
  const { records, resolvedOdsPath } = await withProtocolOds(payload, (odsPath) => ({
    records: core.extractRecords(odsPath, payload.sheetName, payload.nameCol, payload.firstRowHeader),
    resolvedOdsPath: odsPath
  }));
  const selected = records.filter((record) => payload.selectedRows.includes(record.rowNumber));
  if (!selected.length) throw new Error("Selecione pelo menos um nome.");
  const kind = payload.kind;
  const modelsByKind = payload.modelsByKind || {};
  let model = null;
  for (const modelName of modelsByKind[kind] || [kind]) {
    model = core.findModelFile(config.models_folder, modelName);
    if (model) break;
  }
  if (!model && payload.templatePath) model = payload.templatePath;
  if (!model || !fs.existsSync(model)) throw new Error(`Modelo não encontrado para "${kind}".`);
  fs.mkdirSync(payload.outputDir, { recursive: true });
  const formattedDate = core.formatDateForDocument(payload.dateValue);
  const outputs = [];
  for (const record of selected) {
    const fields = { ...record.fields };
    core.addField(fields, "DATA", formattedDate);
    core.addField(fields, "DATA EXTENSO", formattedDate);
    core.addField(fields, "DATA_EXTENSO", formattedDate);
    core.addField(fields, "DATA_CARTA", formattedDate);
    core.addField(fields, "DATA CARTA", formattedDate);
    core.addField(fields, "DATA DA CARTA", formattedDate);
    core.addField(fields, "DATA CERTIDÃO", formattedDate);
    core.addField(fields, "DATA_CERTIDAO", formattedDate);
    core.addField(fields, "DATA CERTIDAO", formattedDate);
    core.addField(fields, "DATA DA CERTIDAO", formattedDate);
    core.addField(fields, "DATA DA CERTIDÃO", formattedDate);
    core.addField(fields, "TIPO", kind);
    core.addField(fields, "TIPO_CARTA", kind);
    core.addGenerationDateFields(fields);
    core.addProtocolFields(fields, core.protocolContextFromValues(payload, resolvedOdsPath));
    core.addSignatureFields(fields, config, payload);
    const output = documentOutputPath(payload.outputDir, kind, record, {
      mergeKind: payload.mergeKind,
      dateValue: payload.dateValue
    });
    core.mergeOdtDocument(model, output, fields);
    outputs.push(output);
  }
  return { outputs, outputDir: payload.outputDir };
});

ipcMain.handle("update:check", async () => {
  const result = await autoUpdater.checkForUpdates();
  return Boolean(result && result.updateInfo);
});

ipcMain.handle("update:download", () => autoUpdater.downloadUpdate());

autoUpdater.on("update-available", (info) => {
  mainWindow?.webContents.send("update:available", info);
});
autoUpdater.on("update-not-available", () => {
  mainWindow?.webContents.send("update:notAvailable");
});
autoUpdater.on("download-progress", (progress) => {
  mainWindow?.webContents.send("update:progress", progress);
});
autoUpdater.on("update-downloaded", () => {
  mainWindow?.webContents.send("update:downloaded");
});
ipcMain.handle("update:install", () => autoUpdater.quitAndInstall(false, true));
