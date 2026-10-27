const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const childProcess = require("child_process");
const { pathToFileURL } = require("url");
const AdmZip = require("adm-zip");
const { PDFArray, PDFDocument, PDFName, degrees } = require("pdf-lib");
const { PDFParse } = require("pdf-parse");

const APP_TITLE = "EXECEJ";
const MONTHS_PT = {
  1: "janeiro",
  2: "fevereiro",
  3: "março",
  4: "abril",
  5: "maio",
  6: "junho",
  7: "julho",
  8: "agosto",
  9: "setembro",
  10: "outubro",
  11: "novembro",
  12: "dezembro"
};

const DEFAULT_EXTRACTION_ATTACHMENT_RULES = [
  { movement: "Arquivos Compatíveis", document: "Arquivos Compatíveis (DATA)", quantity: "1+" },
  { movement: "Arquivos Incompatíveis", document: "Arquivos Incompatíveis (DATA)", quantity: "1+" }
];

const DEFAULT_MOVEMENT_ATTACHMENT_RULES = [
  { movement: "Não Intimado", document: "Intimação Negativa (DATA)", quantity: "1+" },
  { movement: "Intimado", document: "Intimação Positiva (DATA)", quantity: "1+" },
  { movement: "Prenotado; Prenotação", document: "Prenotação (DATA)", quantity: "1+" },
  { movement: "Exigência Cumprida", document: "Reentrada (DATA)", quantity: "1+" },
  { movement: "Exigência", document: "Exigência", quantity: "1" },
  ...DEFAULT_EXTRACTION_ATTACHMENT_RULES,
  { movement: "Notificação Enviada", document: "Carta de Notificação (DATA)", quantity: "1+" },
  { movement: "Edital", document: "Edital (DATA)", quantity: "1+" },
  { movement: "Transcurso de Prazo (Purga de Mora); Transcurso de Prazo", document: "Certidão de Transcurso de Prazo", quantity: "1+" },
  { movement: "Requerimento Consolidação", document: "Requerimento Consolidação", quantity: "1+" },
  { movement: "Requerimento Consolidação", document: "Guia ITBI", quantity: "1" },
  { movement: "Requerimento Consolidação", document: "Comprovante de Pagamento", quantity: "1" },
  { movement: "Valor Venal", document: "Valor Venal", quantity: "1" },
  { movement: "Consolidação", document: "Certidão Matrícula", quantity: "1" },
  { movement: "Desistência", document: "Requerimento Desistência", quantity: "1+" }
];

const MOVEMENT_PREFILL_OPTIONS = [
  "Prenotado",
  "Arquivos Compatíveis",
  "Arquivos Incompatíveis",
  "Custas Informadas",
  "Exigência",
  "Exigência Cumprida",
  "Notificação Enviada",
  "Edital",
  "Intimado",
  "Não Intimado",
  "Transcurso de Prazo (Purga de Mora)",
  "Requerimento Consolidação",
  "Transcurso de Prazo (Consolidação)",
  "Valor Venal",
  "Consolidação",
  "Decurso de Prazo da Prenotação",
  "Arquivamento",
  "Desistência"
];

const DEFAULT_CONFIG = {
  initial_folder_root: "",
  base_protocol_template: "",
  models_folder: "",
  note_requirement_model: "",
  notifications_sheet: "Notificações",
  notifications_name_col: "E",
  base_prenotation_value: "81,56",
  certificate_sheet: "Transcurso de Prazo",
  certificate_name_col: "F",
  movements_sheet: "Movimentações",
  movement_attachment_rules: DEFAULT_MOVEMENT_ATTACHMENT_RULES,
  movement_prefill_options: MOVEMENT_PREFILL_OPTIONS,
  rtd_cost_table: [],
  signers: [],
  default_signature_name: "",
  default_signature_cargo: "",
  onr_signature_enabled: false,
  onr_api_key: "",
  image_autuation_enabled: false,
  image_output_folder: "",
  image_output_bucket_size: 1000,
  image_output_folder_pattern: "{<0^8}.{FAIXA}",
  image_output_format: "tiff",
  image_output_filename: "{<0^8}.{PRENOT}"
};

const DEFAULT_PROTOCOL_SHEET_NAMES = [
  "Movimentações",
  "Custas Intimação",
  "Extração de Arquivos",
  "Notificações",
  "Intimação",
  "Transcurso de Prazo",
  "Consolidação",
  "Tabela de Custas RTD"
];

const MOVEMENT_DOCUMENT_RULES = [
  ["Prenotado", "Autuação"],
  ["Arquivos Compatíveis", "Certidão Extração de Arquivos"],
  ["Arquivos Incompatíveis", "Certidão Extração de Arquivos Incompletos"],
  ["Exigência Cumprida", "Certidão Extração de Arquivos"],
  ["Intimado", "Certidão Notificações RTD Positivas"],
  ["Não Intimado", "Certidão Notificações RTD Negativas"],
  ["Edital de Publicação", "Certidão Edital de Publicação"],
  ["Transcurso de Prazo (Consolidação)", "Certidão Prazo Consolidação"],
  ["Requerimento Consolidação", "Certidão Requerimento Consolidação"],
  ["Consolidação", "Certidão Averbação da Consolidação"],
  ["Valor Venal", "Certidão Valor Venal"],
  ["Averbado", "Certidão Averbação da Consolidação"],
  ["Desistência", "Certidão Requerimento Desistência"],
  ["Notificação Enviada", "Certidão Carta de Notificação"],
  ["Decurso de Prazo da Prenotação", "Certidão Decurso de Prazo da Prenotação"]
];

const NOTE_REQUIREMENT_HEADER =
  "Trata-se de Requerimento de Intimação de Alienação Fiduciária referente ao imóvel objeto da matrícula nº {matricula}, deste Registro.";
const NOTE_REQUIREMENT_ITEM_1 =
  "1. O presente procedimento só poderá prosseguir mediante a apresentação de Requerimento e Projeção de Valores para pagamento da dívida, e na hipótese de emissão de Cédula de Crédito Imobiliário, a apresentação de declaração atualizada da instituição custodiante atestando quem é o atual credor.";
const NOTE_REQUIREMENT_ITEM_2 =
  "2. Para que os documentos nato-digitais produzam seus efeitos jurídicos, é preciso que os requisitos do artigo 208, § 1º, inciso II, do Código Nacional de Normas da Corregedoria Nacional de Justiça do Conselho Nacional de Justiça (CNN/CN/CNJ-Extra) sejam observados, ou seja, estarem no padrão de formato PDF/A e assinados digitalmente.";
const NOTE_DOCUMENTS = {
  requerimento: ["o arquivo de requerimento", "requerimento"],
  projecao: ["o arquivo de projeção de valores", "projeção de valores"],
  procuracao: ["o arquivo de procuração", "procuração"]
};

function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeForMatch(value) {
  return normalizeKey(value).replace(/_/g, "");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlUnescape(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attrs(tag) {
  const result = {};
  const text = tag.replace(/^<[^ ]+\s?/, "").replace(/\/?>$/, "");
  for (const match of text.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    result[match[1]] = xmlUnescape(match[2]);
  }
  return result;
}

function repeated(attributes, name) {
  const raw = attributes[`table:${name}`] || attributes[name];
  const number = Number(raw || 1);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 1;
}

function columnLetter(index) {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function columnToIndex(value, fallback = 5) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return fallback;
  if (/^\d+$/.test(text)) return Math.max(0, Number(text) - 1);
  let index = 0;
  for (const char of text) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function safeFilename(value, fallback = "documento") {
  const cleaned = String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[<>:"/\\|?*\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 130);
  return cleaned || fallback;
}

function formatPrenotation(value) {
  const text = String(value || "").trim();
  if (text.includes(".")) return text;
  const digits = text.replace(/\D/g, "");
  return digits.length > 3 ? `${digits.slice(0, -3)}.${digits.slice(-3)}` : text;
}

function formatDateLong(date = new Date()) {
  return `${String(date.getDate()).padStart(2, "0")} de ${MONTHS_PT[date.getMonth() + 1]} de ${date.getFullYear()}`;
}

const NUMBER_UNITS_PT = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove"
];

const NUMBER_TEENS_PT = {
  10: "dez",
  11: "onze",
  12: "doze",
  13: "treze",
  14: "quatorze",
  15: "quinze",
  16: "dezesseis",
  17: "dezessete",
  18: "dezoito",
  19: "dezenove"
};

const NUMBER_TENS_PT = {
  20: "vinte",
  30: "trinta",
  40: "quarenta",
  50: "cinquenta",
  60: "sessenta",
  70: "setenta",
  80: "oitenta",
  90: "noventa"
};

const NUMBER_HUNDREDS_PT = {
  100: "cem",
  200: "duzentos",
  300: "trezentos",
  400: "quatrocentos",
  500: "quinhentos",
  600: "seiscentos",
  700: "setecentos",
  800: "oitocentos",
  900: "novecentos"
};

function numberToPortuguese(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return String(value || "");
  if (number < 10) return NUMBER_UNITS_PT[number];
  if (number < 20) return NUMBER_TEENS_PT[number];
  if (number < 100) {
    const tens = Math.floor(number / 10) * 10;
    const unit = number % 10;
    return unit ? `${NUMBER_TENS_PT[tens]} e ${numberToPortuguese(unit)}` : NUMBER_TENS_PT[tens];
  }
  if (number < 1000) {
    if (number === 100) return NUMBER_HUNDREDS_PT[100];
    const hundreds = Math.floor(number / 100) * 100;
    const rest = number % 100;
    const prefix = hundreds === 100 ? "cento" : NUMBER_HUNDREDS_PT[hundreds];
    return rest ? `${prefix} e ${numberToPortuguese(rest)}` : prefix;
  }
  if (number < 1000000) {
    const thousands = Math.floor(number / 1000);
    const rest = number % 1000;
    const prefix = thousands === 1 ? "mil" : `${numberToPortuguese(thousands)} mil`;
    if (!rest) return prefix;
    return `${prefix}${rest < 100 ? " e " : " "}${numberToPortuguese(rest)}`;
  }
  return String(number);
}

function dateFromMovementRow(row, layout = null) {
  const columns = layout || { date: 2, day: 3, month: 4, year: 5 };
  const day = getCell(row, columns.day);
  const month = getCell(row, columns.month);
  const year = getCell(row, columns.year);
  if (day && month && year) {
    const monthNum = monthNumber(month);
    const yearNum = year.length === 4 ? Number(year) : 2000 + Number(year);
    return new Date(yearNum, monthNum - 1, Number(day));
  }
  return parseDateValue(getCell(row, columns.date) || firstDateFromRow(row));
}

function formatAutuationDateLong(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const day = date.getDate();
  const year = date.getFullYear();
  return `Aos ${numberToPortuguese(day)} (${String(day).padStart(2, "0")}) dias do mês de ${MONTHS_PT[date.getMonth() + 1]} de ${numberToPortuguese(year)} (${year})`;
}

function autuationDateFromMovement(row, layout = null) {
  const date = dateFromMovementRow(row, layout);
  return date ? formatAutuationDateLong(date) : "";
}

function monthNumber(value) {
  const text = normalizeKey(value);
  for (const [number, name] of Object.entries(MONTHS_PT)) {
    if (normalizeKey(name) === text) return Number(number);
  }
  const numeric = Number(String(value || "").trim());
  if (numeric >= 1 && numeric <= 12) return numeric;
  throw new Error(`Mês inválido: "${value}".`);
}

function formatDateForDocument(value) {
  const text = String(value || "").trim();
  if (!text) return formatDateLong(new Date());
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return text;
  let [, day, month, year] = match.map(Number);
  if (year < 100) year += 2000;
  return `${String(day).padStart(2, "0")} de ${MONTHS_PT[month]} de ${year}`;
}

function fileDateFromText(value) {
  const text = String(value || "");
  let match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (match) {
    let [, day, month, year] = match.map(Number);
    if (year < 100) year += 2000;
    return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
  }
  match = text.match(/(\d{1,2})\s+de\s+([\p{L}]+)\s+de\s+(\d{2,4})/iu);
  if (match) {
    let [, day, month, year] = match;
    year = Number(year);
    if (year < 100) year += 2000;
    return `${String(day).padStart(2, "0")}.${String(monthNumber(month)).padStart(2, "0")}.${year}`;
  }
  return "00.00.0000";
}

function parseDateValue(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    let [, day, month, year] = match.map(Number);
    if (year < 100) year += 2000;
    return new Date(year, month - 1, day);
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match.map(Number);
    return new Date(year, month - 1, day);
  }
  match = text.match(/(\d{1,2})\s+de\s+([\p{L}]+)\s+de\s+(\d{2,4})/iu);
  if (match) {
    let [, day, month, year] = match;
    year = Number(year);
    if (year < 100) year += 2000;
    return new Date(year, monthNumber(month) - 1, Number(day));
  }
  return null;
}

function addBusinessDays(date, days) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let remaining = Number(days) || 0;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const weekday = result.getDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

function datePartsForMovement(movement, dateText) {
  const date = parseDateValue(dateText);
  if (!date) return ["", "", ""];
  const effective = movementMatches(movement, ["Intimado"]) ? addBusinessDays(date, 1) : date;
  return [
    String(effective.getDate()).padStart(2, "0"),
    MONTHS_PT[effective.getMonth() + 1],
    String(effective.getFullYear())
  ];
}

function cellDisplayText(xml) {
  return xml
    .replace(/<text:s(?:\s+[^>]*)?\/>/g, " ")
    .replace(/<text:tab(?:\s+[^>]*)?\/>/g, "\t")
    .replace(/<text:line-break(?:\s+[^>]*)?\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+\n/g, "\n")
    .split(/\n+/)
    .map((part) => xmlUnescape(part).trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readZipText(filePath, entryName) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry(entryName);
  if (!entry) throw new Error(`${entryName} não encontrado em ${filePath}`);
  return entry.getData().toString("utf8");
}

function tableBlocks(contentXml) {
  return [...contentXml.matchAll(/<table:table\b[^>]*>[\s\S]*?<\/table:table>/g)].map((match) => match[0]);
}

function listOdsSheets(odsPath) {
  const xml = readZipText(odsPath, "content.xml");
  return tableBlocks(xml)
    .map((table) => attrs(table.match(/^<table:table\b[^>]*>/)[0])["table:name"])
    .filter(Boolean);
}

function readOdsSheet(odsPath, sheetName, maxCols = 120, maxRows = 20000) {
  const xml = readZipText(odsPath, "content.xml");
  const wanted = normalizeForMatch(sheetName);
  const tables = tableBlocks(xml);
  let selected = null;
  const available = [];
  for (const table of tables) {
    const name = attrs(table.match(/^<table:table\b[^>]*>/)[0])["table:name"] || "";
    available.push(name);
    if (normalizeForMatch(name) === wanted) selected = table;
  }
  if (!selected) throw new Error(`A guia "${sheetName}" não foi encontrada. Guias disponíveis: ${available.join(", ")}`);
  const rows = [];
  for (const rowMatch of selected.matchAll(/<table:table-row\b[^>]*>[\s\S]*?<\/table:table-row>/g)) {
    if (rows.length >= maxRows) break;
    const rowXml = rowMatch[0];
    const rowAttrs = attrs(rowXml.match(/^<table:table-row\b[^>]*>/)[0]);
    const values = [];
    for (const cellMatch of rowXml.matchAll(/<table:(?:table-cell|covered-table-cell)\b(?![^>]*\/>)[^>]*>[\s\S]*?<\/table:(?:table-cell|covered-table-cell)>|<table:(?:table-cell|covered-table-cell)\b[^>]*\/>/g)) {
      if (values.length >= maxCols) break;
      const cellXml = cellMatch[0];
      const cellAttrs = attrs(cellXml.match(/^<table:(?:table-cell|covered-table-cell)\b[^>]*\/?>/)[0]);
      const value = cellDisplayText(cellXml);
      const count = Math.min(repeated(cellAttrs, "number-columns-repeated"), maxCols - values.length);
      for (let i = 0; i < count; i += 1) values.push(value);
    }
    let repeat = repeated(rowAttrs, "number-rows-repeated");
    if (repeat > 1 && !values.some((value) => value.trim())) repeat = 1;
    for (let i = 0; i < repeat && rows.length < maxRows; i += 1) rows.push([...values]);
  }
  while (rows.length && !rows[rows.length - 1].some((cell) => String(cell).trim())) rows.pop();
  return rows;
}

function cloneRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "")));
}

function trimTrailingEmptyCells(row, minCols = 1) {
  const cloned = Array.isArray(row) ? [...row] : [];
  while (cloned.length > minCols && !String(cloned[cloned.length - 1] ?? "").trim()) cloned.pop();
  return cloned.length ? cloned : [""];
}

function compactRows(rows, minRows = 1) {
  const cloned = cloneRows(rows).map((row) => trimTrailingEmptyCells(row));
  while (cloned.length > minRows && !cloned[cloned.length - 1].some((cell) => String(cell).trim())) cloned.pop();
  return cloned;
}

function normalizeWorkbookData(data = {}) {
  const rawSheets = data.sheets && typeof data.sheets === "object" ? data.sheets : {};
  const sheetOrder = Array.isArray(data.sheetOrder) && data.sheetOrder.length
    ? data.sheetOrder.map(String)
    : Object.keys(rawSheets);
  const normalizedOrder = [];
  const sheets = {};
  for (const name of [...sheetOrder, ...Object.keys(rawSheets)]) {
    const sheetName = String(name || "").trim();
    if (!sheetName || normalizedOrder.includes(sheetName)) continue;
    const value = rawSheets[sheetName];
    const rows = Array.isArray(value) ? value : value?.rows;
    sheets[sheetName] = compactRows(rows || [[]]);
    normalizedOrder.push(sheetName);
  }
  if (!normalizedOrder.length) {
    for (const sheetName of DEFAULT_PROTOCOL_SHEET_NAMES) {
      sheets[sheetName] = [[]];
      normalizedOrder.push(sheetName);
    }
  }
  return { sheetOrder: normalizedOrder, sheets };
}

function readOdsWorkbook(odsPath) {
  const sheetOrder = listOdsSheets(odsPath);
  const sheets = {};
  for (const sheetName of sheetOrder) sheets[sheetName] = readOdsSheet(odsPath, sheetName);
  return normalizeWorkbookData({ sheetOrder, sheets });
}

function protocolSheetsFromOds(odsPath) {
  return readOdsWorkbook(odsPath);
}

function getCell(row, index) {
  return index < row.length ? String(row[index] || "").trim() : "";
}

function firstDateFromRow(row) {
  const joined = row.filter(Boolean).join(" ");
  const match = joined.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/);
  return match ? match[0] : "DATA";
}

function movementLayout(rows) {
  const headerIndex = rows.findIndex((row) => {
    const keys = row.map(normalizeKey);
    return keys.includes("MOVIMENTACAO") && (keys.includes("DATA") || keys.includes("NOME_ARQUIVO"));
  });
  const headers = headerIndex >= 0 ? rows[headerIndex] : [];
  const find = (tokens, fallback) => {
    const indices = headerTokenIndices(headers, tokens);
    return indices.length ? indices[0] : fallback;
  };
  const movement = find(["MOVIMENTAÇÃO", "MOVIMENTACAO"], headerIndex >= 0 ? 0 : 1);
  const date = find(["DATA"], movement + 1);
  const day = find(["DIA"], date + 1);
  const month = find(["MÊS", "MES"], day + 1);
  const year = find(["ANO"], month + 1);
  const document = find(["NOME ARQUIVO", "NOME_ARQUIVO"], year + 1);
  return { headerIndex, firstDataIndex: headerIndex >= 0 ? headerIndex + 1 : 0, movement, date, day, month, year, document };
}

function movementRowsFromSheetRows(rows) {
  const layout = movementLayout(rows);
  const entries = [];
  let movementIndex = -1;
  for (let sourceRow = layout.firstDataIndex; sourceRow < rows.length; sourceRow += 1) {
    const row = rows[sourceRow];
    const movement = getCell(row, layout.movement);
    if (!movement) continue;
    const key = normalizeKey(movement);
    if (["MOVIMENTACAO", "PROTOCOLO"].includes(key)) continue;
    movementIndex += 1;
    entries.push({ row, movement, movementIndex, sourceRow, layout });
  }
  return { layout, entries };
}

function movementDocumentNameFromRules(movement, rules) {
  for (const rule of rules) {
    if (movementMatches(movement, rule.movement)) return rule.file;
  }
  return "";
}

function movementDocumentName(movement, previousMovements = [], config = {}) {
  const configuredDocument = movementDocumentNameFromRules(movement, normalizeMovementDocumentRules(config));
  if (configuredDocument) return configuredDocument;
  if (movementMatches(movement, ["Arquivamento"])) {
    if (previousMovements.some((item) => movementMatches(item, ["Decurso de Prazo da Prenotação"]))) return "Certidão Arquivamento por Decurso";
    if (previousMovements.some((item) => movementMatches(item, ["Desistência"]))) return "Certidão Arquivamento por Desistência";
    return "Certidão Arquivamento por Consolidação";
  }
  return "";
}

function ensureRowLength(row, length) {
  while (row.length <= length) row.push("");
  return row;
}

function applyMovementSheetCalculations(rows, context = {}) {
  const cloned = cloneRows(rows);
  const { layout, entries } = movementRowsFromSheetRows(cloned);
  if (layout.headerIndex < 0) return cloned;
  const previousMovements = [];
  for (const { row, movement, layout: rowLayout } of entries) {
    ensureRowLength(row, Math.max(rowLayout.day, rowLayout.month, rowLayout.year, rowLayout.document));
    const [day, month, year] = datePartsForMovement(movement, getCell(row, rowLayout.date));
    row[rowLayout.day] = day;
    row[rowLayout.month] = month;
    row[rowLayout.year] = year;
    const documentName = movementDocumentName(movement, previousMovements, context);
    row[rowLayout.document] = documentName;
    previousMovements.push(movement);
  }
  const firstPrenotation = entries.find(({ movement }) => movementMatches(movement, ["Prenotado", "Prenotação"]));
  if (firstPrenotation && cloned[0]) {
    ensureRowLength(cloned[0], 2);
    const autuationDate = autuationDateFromMovement(firstPrenotation.row, firstPrenotation.layout);
    if (autuationDate) cloned[0][2] = autuationDate;
  }
  return cloned;
}

function headerIndex(headers, names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(normalizeKey);
  return headers.findIndex((header) => wanted.includes(normalizeKey(header)));
}

function headerIndexWithoutQuestion(headers, names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(normalizeKey);
  return headers.findIndex((header) => wanted.includes(normalizeKey(header)) && !String(header || "").includes("?"));
}

function setIfColumn(row, index, value) {
  if (index < 0) return;
  ensureRowLength(row, index);
  row[index] = String(value ?? "");
}

function documentTypeFromValue(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11 || text.length === 14) return "CPF/MF";
  if (digits.length === 14 || text.length === 18) return "CNPJ/MF";
  return text ? "Inválido" : "";
}

function formatCep(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 2)}.${digits.slice(2, 5)}-${digits.slice(5)}` : String(value || "").trim();
}

function formatDottedIdentifier(value) {
  return formatPrenotation(value);
}

function parseLocalizedNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "")
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .trim();
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function formatDecimalPt(value) {
  const number = parseLocalizedNumber(value);
  if (number === null) return "";
  return number.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrencyPt(value) {
  return `R$ ${roundCurrency(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function protocolCalculationContext(context = {}) {
  const prenotation = String(context.prenotation || "").trim();
  const basePrenotationValue = String(context.basePrenotationValue || context.base_prenotation_value || "").trim();
  return {
    prenotation: prenotation ? formatPrenotation(prenotation) : "",
    basePrenotationValue
  };
}

function firstFilledFromRows(rows, index, start = 1) {
  if (index < 0) return "";
  for (let rowIndex = start; rowIndex < rows.length; rowIndex += 1) {
    const value = getCell(rows[rowIndex], index);
    if (value) return value;
  }
  return "";
}

function applyExtractionSheetCalculations(rows, context = {}) {
  const cloned = cloneRows(rows);
  const calculationContext = protocolCalculationContext(context);
  const headers = cloned[0] || [];
  const docTypeIndex = headerIndex(headers, ["DOC_TIPO"]);
  const documentIndex = headerIndex(headers, ["CPF ou CNPJ", "CPF CNPJ"]);
  const dateIndex = headerIndex(headers, ["DATA EXTRAÇÃO", "DATA EXTRACAO"]);
  const prenotationFlagIndex = headerIndex(headers, ["PRENOTAÇÃO?", "PRENOTACAO?"]);
  const dateLongIndex = headerIndex(headers, ["DATA EXTENSO"]);
  const prenotationIndex = headerIndexWithoutQuestion(headers, ["PRENOTAÇÃO", "PRENOTACAO"]);
  const prenotationFormattedIndex = headerIndex(headers, ["PREN_FORMATADA"]);
  for (let rowIndex = 1; rowIndex < cloned.length; rowIndex += 1) {
    const row = cloned[rowIndex];
    if (!rowHasValues(row)) continue;
    setIfColumn(row, docTypeIndex, documentTypeFromValue(getCell(row, documentIndex)));
    if (normalizeKey(getCell(row, prenotationFlagIndex)) === "SIM") {
      const date = parseDateValue(getCell(row, dateIndex));
      setIfColumn(row, dateLongIndex, date ? formatDateLong(date) : "");
    }
    if (calculationContext.prenotation) setIfColumn(row, prenotationIndex, calculationContext.prenotation);
    setIfColumn(row, prenotationFormattedIndex, formatDottedIdentifier(getCell(row, prenotationIndex)));
  }
  return cloned;
}

function applyNotificationSheetCalculations(rows, context = {}) {
  const cloned = cloneRows(rows);
  const calculationContext = protocolCalculationContext(context);
  const headers = cloned[0] || [];
  const sexoIndex = headerIndex(headers, ["SEXO"]);
  const aouoIndex = headerIndex(headers, ["(AouO)", "AouO"]);
  const aoSenhorIndex = headerIndex(headers, ["Ao Senhor(a)"]);
  const senhorIndex = headerIndex(headers, ["Senhor(a)"]);
  const documentIndex = headerIndex(headers, ["CPF ou CNPJ", "CPF CNPJ"]);
  const docTypeIndex = headerIndex(headers, ["AUXILIAR_DOC"]);
  const auxCepIndex = headerIndex(headers, ["AUX CEP"]);
  const cepIndex = headerIndex(headers, ["CEP"]);
  const cepFormattedIndex = headerIndex(headers, ["CEP_FORMATADO"]);
  const matriculaIndex = headerIndex(headers, ["MATRÍCULA", "MATRICULA"]);
  const matriculaFormattedIndex = headerIndex(headers, ["MAT_FORMATADA"]);
  const chargeValueIndex = headerIndex(headers, ["VALOR ENCARGOS"]);
  const chargeFormattedIndex = headerIndex(headers, ["VALOR_ENC_FORMATADO"]);
  const intimationValueIndex = headerIndex(headers, ["VALOR INTIMAÇÕES", "VALOR INTIMACOES"]);
  const prenotationValueIndex = headerIndex(headers, ["PRENOTAÇÃO", "PRENOTACAO"]);
  const totalValueIndex = headerIndex(headers, ["VALOR TOTAL"]);
  const totalFormattedIndex = headerIndex(headers, ["VALOR_INT_FORMATADO"]);
  const protocolIndex = headerIndex(headers, ["PROTOCOLO"]);
  const protocolFormattedIndex = headerIndex(headers, ["PROT_FORMATADO"]);
  for (let rowIndex = 1; rowIndex < cloned.length; rowIndex += 1) {
    const row = cloned[rowIndex];
    if (!rowHasValues(row)) continue;
    const sexo = normalizeKey(getCell(row, sexoIndex));
    const docType = documentTypeFromValue(getCell(row, documentIndex));
    setIfColumn(row, docTypeIndex, docType);
    setIfColumn(row, aouoIndex, sexo === "M" ? "o" : (docType === "CNPJ/MF" ? "os" : "a"));
    setIfColumn(row, aoSenhorIndex, sexo === "M" ? "Ao senhor" : (docType === "CNPJ/MF" ? "À empresa" : "À senhora"));
    setIfColumn(row, senhorIndex, sexo === "M" ? "senhor" : (docType === "CNPJ/MF" ? "empresa" : "senhora"));
    setIfColumn(row, auxCepIndex, "CEP");
    setIfColumn(row, cepFormattedIndex, formatCep(getCell(row, cepIndex)));
    setIfColumn(row, matriculaFormattedIndex, formatDottedIdentifier(getCell(row, matriculaIndex)));
    setIfColumn(row, chargeFormattedIndex, formatDecimalPt(getCell(row, chargeValueIndex)));
    if (calculationContext.basePrenotationValue) setIfColumn(row, prenotationValueIndex, calculationContext.basePrenotationValue);
    if (calculationContext.prenotation) setIfColumn(row, protocolIndex, calculationContext.prenotation);
    const intimationValue = parseLocalizedNumber(getCell(row, intimationValueIndex));
    const prenotationValue = parseLocalizedNumber(getCell(row, prenotationValueIndex));
    const totalValue = [intimationValue, prenotationValue].filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
    const hasTotalParts = intimationValue !== null || prenotationValue !== null;
    setIfColumn(row, totalValueIndex, hasTotalParts ? formatDecimalPt(totalValue) : "");
    setIfColumn(row, totalFormattedIndex, hasTotalParts ? formatDecimalPt(totalValue) : "");
    setIfColumn(row, protocolFormattedIndex, formatDottedIdentifier(getCell(row, protocolIndex)));
  }
  return cloned;
}

function tableRtdLookup(workbook) {
  const rows = Array.isArray(workbook?.rtd_cost_table) && workbook.rtd_cost_table.length
    ? rtdCostTableRows(workbook.rtd_cost_table)
    : firstSheetByName(workbook, "Tabela de Custas RTD");
  const result = new Map();
  const headers = rows[0] || [];
  const cityIndex = headerIndex(headers, ["CIDADE", "COMARCA"]);
  const rateIndex = headerIndex(headers, ["FATOR", "FATOR RTD", "MULTIPLICADOR"]);
  const acceptsPowerIndex = headerIndex(headers, ["ACEITA PROCURAÇÃO", "ACEITA PROCURACAO"]);
  const addsAnnexIndex = headerIndex(headers, ["ADICIONA ANEXO?", "ADICIONA ANEXO", "ANEXO EXTRA"]);
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const city = getCell(rows[rowIndex], cityIndex >= 0 ? cityIndex : 0);
    if (!city) continue;
    const fallbackAddsAnnex = !cityWithoutExtraAnnex(city);
    result.set(normalizeKey(city), {
      city,
      rate: parseLocalizedNumber(getCell(rows[rowIndex], rateIndex >= 0 ? rateIndex : 1)) || 0,
      acceptsPower: getCell(rows[rowIndex], acceptsPowerIndex >= 0 ? acceptsPowerIndex : 2),
      addsAnnex: yesNoBoolean(getCell(rows[rowIndex], addsAnnexIndex), fallbackAddsAnnex)
    });
  }
  return result;
}

function cityLookupEntry(lookup, city) {
  return lookup.get(normalizeKey(city)) || { city, rate: 0, acceptsPower: "", addsAnnex: !cityWithoutExtraAnnex(city) };
}

function tremembeCity(city) {
  return ["TREMEMBE_SP", "TREMEMBE"].includes(normalizeKey(city));
}

function cityWithoutExtraAnnex(city) {
  return [
    "TREMEMBE_SP",
    "TREMEMBE",
    "SAO_JOSE_DOS_CAMPOS_SP",
    "SAO_JOSE_DOS_CAMPOS"
  ].includes(normalizeKey(city));
}

function yesNoBoolean(value, fallback = true) {
  const key = normalizeKey(value);
  if (["SIM", "S", "YES", "TRUE", "1"].includes(key)) return true;
  if (["NAO", "N", "NO", "FALSE", "0"].includes(key)) return false;
  return fallback;
}

function yesNoText(value) {
  return value ? "SIM" : "NÃO";
}

function normalizeRtdCostTable(rows) {
  const source = Array.isArray(rows) ? rows : [];
  return source
    .map((row) => {
      const city = String(row?.city ?? row?.cidade ?? row?.comarca ?? "").trim();
      if (!city) return null;
      const fallbackAddsAnnex = !cityWithoutExtraAnnex(city);
      return {
        city,
        rate: String(row?.rate ?? row?.fator ?? row?.fator_rtd ?? "").trim(),
        acceptsPower: String(row?.acceptsPower ?? row?.accepts_power ?? row?.aceitaProcuracao ?? row?.aceita_procuracao ?? "").trim(),
        addsAnnex: yesNoText(yesNoBoolean(row?.addsAnnex ?? row?.adds_annex ?? row?.adicionaAnexo ?? row?.adiciona_anexo, fallbackAddsAnnex))
      };
    })
    .filter(Boolean);
}

function rtdCostTableRows(configRows) {
  return [
    ["Cidade", "Fator", "Aceita Procuração", "Adiciona Anexo?"],
    ...normalizeRtdCostTable(configRows).map((row) => [row.city, row.rate, row.acceptsPower, row.addsAnnex])
  ];
}

function rtdCostTableFromWorkbook(workbook) {
  const rows = firstSheetByName(workbook, "Tabela de Custas RTD");
  if (!rows.length) return [];
  const headers = rows[0] || [];
  const cityIndex = headerIndex(headers, ["CIDADE", "COMARCA"]);
  const rateIndex = headerIndex(headers, ["FATOR", "FATOR RTD", "MULTIPLICADOR"]);
  const acceptsPowerIndex = headerIndex(headers, ["ACEITA PROCURAÇÃO", "ACEITA PROCURACAO"]);
  const addsAnnexIndex = headerIndex(headers, ["ADICIONA ANEXO?", "ADICIONA ANEXO", "ANEXO EXTRA"]);
  const result = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const city = getCell(rows[rowIndex], cityIndex >= 0 ? cityIndex : 0);
    if (!city) continue;
    const fallbackAddsAnnex = !cityWithoutExtraAnnex(city);
    result.push({
      city,
      rate: getCell(rows[rowIndex], rateIndex >= 0 ? rateIndex : 1),
      acceptsPower: getCell(rows[rowIndex], acceptsPowerIndex >= 0 ? acceptsPowerIndex : 2),
      addsAnnex: yesNoText(yesNoBoolean(getCell(rows[rowIndex], addsAnnexIndex), fallbackAddsAnnex))
    });
  }
  return result;
}

function custasEntries(rows, cityLookup) {
  const entries = [];
  const seenAddresses = new Set();
  for (let rowIndex = 8; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const name = getCell(row, 1);
    const city = getCell(row, 6);
    const address = getCell(row, 3) || [getCell(row, 3), getCell(row, 4), getCell(row, 5)].filter(Boolean).join(" ").trim();
    if (!name && !city && !address) continue;
    setIfColumn(row, 2, "");
    setIfColumn(row, 4, "");
    setIfColumn(row, 5, "");
    const lookup = cityLookupEntry(cityLookup, city);
    const addressKey = normalizeKey(address || `${name}-${city}`);
    const firstAddress = addressKey && !seenAddresses.has(addressKey);
    if (addressKey) seenAddresses.add(addressKey);
    setIfColumn(row, 0, address ? (firstAddress ? "1" : "0") : "");
    setIfColumn(row, 7, lookup.acceptsPower || "");
    entries.push({ row, name, city, address, firstAddress, acceptsPower: lookup.acceptsPower, rate: lookup.rate, addsAnnex: lookup.addsAnnex });
  }
  return entries;
}

function setCustasTotalHeaders(rows) {
  setIfColumn(rows[1], 9, "CUSTAS TOTAIS");
  setIfColumn(rows[2], 9, "DILIGÊNCIAS");
  setIfColumn(rows[3], 9, "RTD");
  setIfColumn(rows[4], 9, "ANEXOS");
  setIfColumn(rows[5], 9, "DESMATERIALIZAÇÃO");
}

function applyCustasSheetCalculations(rows, workbook) {
  const cloned = cloneRows(rows);
  while (cloned.length < 9) cloned.push([]);
  for (let index = 0; index < cloned.length; index += 1) {
    if (!Array.isArray(cloned[index])) cloned[index] = [];
  }
  const cityLookup = tableRtdLookup(workbook);
  const diligenceValue = parseLocalizedNumber(getCell(cloned[4], 1)) || 0;
  const registrationValue = parseLocalizedNumber(getCell(cloned[4], 2)) || 0;
  const microfilmValue = parseLocalizedNumber(getCell(cloned[4], 3)) || 0;
  const annexValue = parseLocalizedNumber(getCell(cloned[4], 4)) || 0;
  const annexCount = parseLocalizedNumber(getCell(cloned[4], 5)) || 0;
  const dematerializationValue = parseLocalizedNumber(getCell(cloned[4], 6)) || 0;
  const powerDeductionEnabled = normalizeKey(getCell(cloned[4], 7)) === "SIM";
  const entries = custasEntries(cloned, cityLookup).filter((entry) => entry.name && entry.city);
  const countedDiligenceEntries = entries.filter((entry) => !(
    powerDeductionEnabled && !entry.firstAddress && normalizeKey(entry.acceptsPower) === "SIM"
  ));
  const diligenceTotal = countedDiligenceEntries.length * diligenceValue;
  const rtdTotal = entries.reduce((sum, entry) => sum + roundCurrency(registrationValue * entry.rate) + roundCurrency(microfilmValue * entry.rate), 0);
  const annexTotal = entries.reduce((sum, entry) => sum + roundCurrency((entry.addsAnnex ? annexCount + 1 : annexCount) * annexValue * entry.rate), 0);
  const dematerializationTotal = entries.filter((entry) => !tremembeCity(entry.city)).length * dematerializationValue;
  setCustasTotalHeaders(cloned);
  setIfColumn(cloned[2], 10, formatCurrencyPt(diligenceTotal));
  setIfColumn(cloned[3], 10, formatCurrencyPt(rtdTotal));
  setIfColumn(cloned[4], 10, formatCurrencyPt(annexTotal));
  setIfColumn(cloned[5], 10, formatCurrencyPt(dematerializationTotal));
  setIfColumn(cloned[6], 10, formatCurrencyPt(diligenceTotal + rtdTotal + annexTotal + dematerializationTotal));

  const cities = uniqueTextValues(entries.map((entry) => entry.city));
  for (let offset = 0; offset < cities.length; offset += 1) {
    const colIndex = 12 + offset;
    const city = cities[offset];
    const cityEntries = entries.filter((entry) => normalizeKey(entry.city) === normalizeKey(city));
    const cityDiligenceEntries = cityEntries.filter((entry) => !(
      powerDeductionEnabled && !entry.firstAddress && normalizeKey(entry.acceptsPower) === "SIM"
    ));
    const cityRate = cityLookupEntry(cityLookup, city).rate;
    const cityDiligence = cityDiligenceEntries.length * diligenceValue;
    const cityRtd = cityEntries.length * (roundCurrency(registrationValue * cityRate) + roundCurrency(microfilmValue * cityRate));
    const cityAnnex = cityEntries.length * roundCurrency((cityLookupEntry(cityLookup, city).addsAnnex ? annexCount + 1 : annexCount) * annexValue * cityRate);
    const cityDematerialization = tremembeCity(city) ? 0 : cityEntries.length * dematerializationValue;
    setIfColumn(cloned[1], colIndex, city);
    setIfColumn(cloned[2], colIndex, formatCurrencyPt(cityDiligence));
    setIfColumn(cloned[3], colIndex, formatCurrencyPt(cityRtd));
    setIfColumn(cloned[4], colIndex, formatCurrencyPt(cityAnnex));
    setIfColumn(cloned[5], colIndex, formatCurrencyPt(cityDematerialization));
    setIfColumn(cloned[6], colIndex, formatCurrencyPt(cityDiligence + cityRtd + cityAnnex + cityDematerialization));
  }
  return cloned;
}

function isFemaleSex(value) {
  return normalizeKey(value) === "F";
}

function notificationSexLookup(workbook = null) {
  if (!workbook) return new Map();
  const notificationRows = firstSheetByName(workbook, "Notificações");
  const headers = notificationRows[0] || [];
  const nameIndex = headerIndex(headers, ["NOME"]);
  const sexoIndex = headerIndex(headers, ["SEXO"]);
  const lookup = new Map();
  if (nameIndex < 0 || sexoIndex < 0) return lookup;
  for (let rowIndex = 1; rowIndex < notificationRows.length; rowIndex += 1) {
    const row = notificationRows[rowIndex];
    const name = getCell(row, nameIndex);
    const sexo = getCell(row, sexoIndex);
    if (name && sexo) lookup.set(normalizeForMatch(name), sexo);
  }
  return lookup;
}

function applyIntimationSheetCalculations(rows, workbook = null) {
  const cloned = cloneRows(rows);
  const headers = cloned[0] || [];
  const sexoIndex = headerIndex(headers, ["SEXO"]);
  const dasIndex = headerIndex(headers, ["dAs_notificações", "dAs_notificacÕES"]);
  const osAsIndex = headerIndex(headers, ["(os_as)", "os_as"]);
  const numberIndex = headerIndex(headers, ["(nºs_)", "nºs_", "nos"]);
  const debtorsIndex = headerIndex(headers, ["(devedore_s)", "devedore_s"]);
  const cityAuxIndex = headerIndex(headers, ["AUXILIAR COMARCA RTD"]);
  const cityIndex = headerIndex(headers, ["COMARCA RTD"]);
  const registerAuxIndex = headerIndex(headers, ["AUXILIAR Nº REGISTRO", "AUXILIAR N REGISTRO"]);
  const registerIndex = headerIndex(headers, ["Nº REGISTRO", "N REGISTRO"]);
  const registerFormattedIndex = headerIndex(headers, ["Nº REGISTRO FORMATADO", "N REGISTRO FORMATADO"]);
  const namesAuxIndex = headerIndex(headers, ["AUXILIAR NOMES"]);
  const nameIndex = headerIndex(headers, ["NOME"]);
  const sexByNotificationName = notificationSexLookup(workbook);
  let dateIndices = exactHeaderIndices(headers, INTIMATION_GENERIC_DATE_HEADERS);
  if (!dateIndices.length) dateIndices = dateColumnIndices(headers, INTIMATION_GENERIC_DATE_HEADERS, false);
  const groups = new Map();
  for (let rowIndex = 1; rowIndex < cloned.length; rowIndex += 1) {
    const row = cloned[rowIndex];
    if (!rowHasValues(row)) continue;
    const notificationSex = sexByNotificationName.get(normalizeForMatch(getCell(row, nameIndex)));
    if (notificationSex) setIfColumn(row, sexoIndex, notificationSex);
    const dateText = dateIndices.map((index) => getCell(row, index)).find(Boolean) || "";
    const parsedDate = fileDateFromText(dateText);
    const key = parsedDate === "00.00.0000" ? `linha-${rowIndex}` : parsedDate;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    const count = group.length;
    const allFemale = group.every((row) => isFemaleSex(getCell(row, sexoIndex)));
    const names = uniqueTextValues(group.map((row) => getCell(row, nameIndex)));
    const registers = uniqueTextValues(group.map((row) => getCell(row, registerFormattedIndex) || formatDottedIdentifier(getCell(row, registerIndex))));
    for (const row of group) {
      setIfColumn(row, dasIndex, count > 1 ? "das notificações registradas" : "da notificação registrada");
      setIfColumn(row, osAsIndex, allFemale ? (count > 1 ? "as" : "a") : (count > 1 ? "os" : "o"));
      setIfColumn(row, numberIndex, count > 1 ? "os nºs" : "o nº");
      setIfColumn(row, debtorsIndex, allFemale ? (count > 1 ? "devedoras fiduciantes" : "devedora fiduciante") : (count > 1 ? "devedores fiduciantes" : "devedor fiduciante"));
      const city = getCell(row, cityIndex);
      const cityKey = normalizeKey(city);
      setIfColumn(row, cityAuxIndex, city ? (["TREMEMBE_SP", "TREMEMBE"].includes(cityKey) ? "nesta cidade" : `em ${city}`) : "");
      setIfColumn(row, registerAuxIndex, joinWithCommaAnd(registers));
      setIfColumn(row, registerFormattedIndex, formatDottedIdentifier(getCell(row, registerIndex)));
      setIfColumn(row, namesAuxIndex, joinWithCommaAnd(names));
    }
  }
  return cloned;
}

function firstSheetByName(workbook, wantedName) {
  const sheetName = workbook.sheetOrder.find((name) => normalizeForMatch(name) === normalizeForMatch(wantedName));
  return sheetName ? cloneRows(workbook.sheets[sheetName]) : [];
}

function firstMovementDate(workbook, aliases, addBusiness = false) {
  const movementRows = firstSheetByName(workbook, "Movimentações");
  if (!movementRows.length) return null;
  const { entries } = movementRowsFromSheetRows(movementRows);
  for (const entry of entries) {
    if (!movementMatches(entry.movement, aliases)) continue;
    const date = parseDateValue(getCell(entry.row, entry.layout.date));
    if (!date) continue;
    return addBusiness ? addBusinessDays(date, 1) : date;
  }
  return null;
}

function lastMovementDate(workbook, aliases, addBusiness = false) {
  const movementRows = firstSheetByName(workbook, "Movimentações");
  if (!movementRows.length) return null;
  const { entries } = movementRowsFromSheetRows(movementRows);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!movementMatches(entry.movement, aliases)) continue;
    const date = parseDateValue(getCell(entry.row, entry.layout.date));
    if (!date) continue;
    return addBusiness ? addBusinessDays(date, 1) : date;
  }
  return null;
}

function intimationDetailText(workbook) {
  const rows = firstSheetByName(workbook, "Intimação");
  if (!rows.length) return "";
  const headers = rows[0] || [];
  const nameIndex = headerIndex(headers, ["NOME"]);
  const typeIndex = headerIndex(headers, ["TIPO NOTIFICAÇÃO", "TIPO DE NOTIFICAÇÃO", "TIPO INTIMAÇÃO", "TIPO DE INTIMAÇÃO"]);
  const cityIndex = headerIndex(headers, ["COMARCA RTD"]);
  const registerIndex = headerIndex(headers, ["Nº REGISTRO", "N REGISTRO"]);
  const formattedRegisterIndex = headerIndex(headers, ["Nº REGISTRO FORMATADO", "N REGISTRO FORMATADO"]);
  let dateIndices = exactHeaderIndices(headers, INTIMATION_GENERIC_DATE_HEADERS);
  if (!dateIndices.length) dateIndices = dateColumnIndices(headers, INTIMATION_GENERIC_DATE_HEADERS, false);
  const parts = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const name = getCell(row, nameIndex);
    if (!name) continue;
    const dateText = dateIndices.map((index) => getCell(row, index)).find(Boolean) || "";
    const date = parseDateValue(dateText);
    const dateLong = date ? formatDateLong(date) : formatDateForDocument(dateText);
    const type = getCell(row, typeIndex);
    const typeKey = normalizeKey(type);
    if (typeKey.includes("EDITAL")) {
      parts.push(`${name}, intimado através de edital em ${dateLong}`);
      continue;
    }
    const register = getCell(row, formattedRegisterIndex) || formatDottedIdentifier(getCell(row, registerIndex));
    const city = getCell(row, cityIndex);
    const suffix = [register ? `registro nº ${register} do RTD` : "registro do RTD", city ? `da comarca de ${city}` : ""].filter(Boolean).join(" ");
    parts.push(`${name}, intimado em ${dateLong}, conforme ${suffix}`);
  }
  return joinWithCommaAnd(parts);
}

function applyTranscursoSheetCalculations(rows, workbook) {
  const cloned = cloneRows(rows);
  const headers = cloned[0] || [];
  const notificationSheetName = workbook.sheetOrder.find((name) => normalizeForMatch(name) === normalizeForMatch("Notificações"));
  const notificationRows = notificationSheetName ? cloneRows(workbook.sheets[notificationSheetName]) : [];
  const notificationHeaders = notificationRows[0] || [];
  const notifSexoIndex = headerIndex(notificationHeaders, ["SEXO"]);
  const notifNameIndex = headerIndex(notificationHeaders, ["NOME"]);
  const notifCredoraIndex = headerIndex(notificationHeaders, ["CREDORA"]);
  const notifMatriculaIndex = headerIndex(notificationHeaders, ["MATRÍCULA", "MATRICULA"]);
  const notifProtocolIndex = headerIndex(notificationHeaders, ["PROTOCOLO"]);
  const filledNotifications = notificationRows.slice(1).filter(rowHasValues);
  const names = uniqueTextValues(filledNotifications.map((row) => getCell(row, notifNameIndex)));
  const hasMale = filledNotifications.some((row) => normalizeKey(getCell(row, notifSexoIndex)) === "M");
  const count = names.length;
  const auxOosIndex = headerIndex(headers, ["AUX_OOS"]);
  const intimationTypeIndex = headerIndex(headers, ["TIPO DE INTIMAÇÃO", "TIPO DE INTIMACAO"]);
  const rtdRecordsIndex = headerIndex(headers, ["Registros RTD"]);
  const rtdCityIndex = headerIndex(headers, ["Comarca de Registro RTD"]);
  const edictDatesIndex = headerIndex(headers, ["Datas Editais"]);
  const intimationTextIndex = headerIndex(headers, ["TEXTO INTIMAÇÃO", "TEXTO INTIMACAO"]);
  const prenotationDateIndex = headerIndex(headers, ["DATA PRENOTAÇÃO", "DATA PRENOTACAO"]);
  const joiningDateIndex = headerIndex(headers, ["DATA JUNTADA"]);
  const certificateProtocolIndex = headerIndex(headers, ["PROTOCOLO CERTIDÃO", "PROTOCOLO CERTIDAO"]);
  const certificateProtocolFormattedIndex = headerIndex(headers, ["PROT_CERT_FORMATADO"]);
  const prenotationDate = firstMovementDate(workbook, ["Prenotado", "Prenotação"]);
  const joiningDate = lastMovementDate(workbook, ["Intimado"], true);
  const intimationDetails = intimationDetailText(workbook);
  for (let rowIndex = 1; rowIndex < cloned.length; rowIndex += 1) {
    const row = cloned[rowIndex];
    if (!rowHasValues(row) && rowIndex > 1) continue;
    setIfColumn(row, headerIndex(headers, ["AUX_ASOS"]), hasMale ? (count > 1 ? "os" : "o") : (count > 1 ? "as" : "a"));
    setIfColumn(row, auxOosIndex, count > 1 ? "os" : "o");
    setIfColumn(row, headerIndex(headers, ["AUX_DEVEDORES"]), hasMale ? (count > 1 ? "aos devedores" : "ao devedor") : (count > 1 ? "às devedoras" : "à devedora"));
    setIfColumn(row, headerIndex(headers, ["AUX_DAS"]), count === 1 ? "da notificação" : "das notificações");
    setIfColumn(row, headerIndex(headers, ["NOMES"]), joinWithCommaAnd(names));
    setIfColumn(row, headerIndex(headers, ["CREDORA"]), firstFilledFromRows(notificationRows, notifCredoraIndex));
    const matricula = firstFilledFromRows(notificationRows, notifMatriculaIndex);
    setIfColumn(row, headerIndex(headers, ["MATRÍCULA", "MATRICULA"]), matricula);
    setIfColumn(row, headerIndex(headers, ["MAT_FORMATADA"]), formatDottedIdentifier(matricula));
    const protocol = firstFilledFromRows(notificationRows, notifProtocolIndex);
    setIfColumn(row, headerIndex(headers, ["PRENOTAÇÃO", "PRENOTACAO"]), protocol);
    setIfColumn(row, headerIndex(headers, ["PROT_FORMATADO"]), formatDottedIdentifier(protocol));
    setIfColumn(row, prenotationDateIndex, prenotationDate ? formatDateLong(prenotationDate) : "");
    setIfColumn(row, joiningDateIndex, joiningDate ? formatDateLong(joiningDate) : "");
    const intimationType = getCell(row, intimationTypeIndex);
    if (intimationDetails) {
      setIfColumn(row, intimationTextIndex, intimationDetails);
    } else if (normalizeKey(intimationType) === "RTD") {
      const city = getCell(row, rtdCityIndex);
      const cityKey = normalizeKey(city);
      const cityText = ["TREMEMBE_SP", "TREMEMBE"].includes(cityKey)
        ? " desta Comarca,"
        : (city ? ` da Comarca de ${city},` : " da Comarca de,");
      setIfColumn(row, intimationTextIndex, `do Registro de Títulos e Documentos${cityText} registrad${getCell(row, auxOosIndex)} sob nº ${getCell(row, rtdRecordsIndex)}`);
    } else if (intimationType) {
      setIfColumn(row, intimationTextIndex, `de Editais de Intimação, publicados em ${getCell(row, edictDatesIndex)}, em jornal eletrônico`);
    } else {
      setIfColumn(row, intimationTextIndex, "");
    }
    setIfColumn(row, certificateProtocolFormattedIndex, formatDottedIdentifier(getCell(row, certificateProtocolIndex)));
    if (rowHasValues(row)) break;
  }
  return cloned;
}

function formatTwoDigitValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits) return digits.padStart(2, "0");
  return text;
}

function applyConsolidationSheetCalculations(rows) {
  const cloned = cloneRows(rows);
  const headers = cloned[0] || [];
  const annotationIndex = headerIndex(headers, ["Nº AVERBAÇÃO", "N AVERBAÇÃO", "AVERBAÇÃO", "AVERBACAO"]);
  const annotationFormattedIndex = headerIndex(headers, ["AVERBAÇÃO_FORMATADO", "AVERBACAO_FORMATADO"]);
  const matriculaIndex = headerIndex(headers, ["MATRÍCULA", "MATRICULA"]);
  const matriculaFormattedIndex = headerIndex(headers, ["MATRÍCULA_FORMATADA", "MATRICULA_FORMATADA"]);
  for (let rowIndex = 1; rowIndex < cloned.length; rowIndex += 1) {
    const row = cloned[rowIndex];
    if (!rowHasValues(row)) continue;
    setIfColumn(row, annotationFormattedIndex, formatTwoDigitValue(getCell(row, annotationIndex)));
    setIfColumn(row, matriculaFormattedIndex, formatDottedIdentifier(getCell(row, matriculaIndex)));
  }
  return cloned;
}

function applyProtocolWorkbookCalculations(workbook, context = {}) {
  const normalized = normalizeWorkbookData(workbook);
  const sheets = {};
  const rtdCostTable = context.rtdCostTable || context.rtd_cost_table || workbook.rtd_cost_table || [];
  for (const sheetName of normalized.sheetOrder) {
    const rows = normalized.sheets[sheetName] || [[]];
    const normalizedName = normalizeForMatch(sheetName);
    const workbookContext = { sheetOrder: [...normalized.sheetOrder], sheets: { ...normalized.sheets, ...sheets }, rtd_cost_table: rtdCostTable };
    if (normalizedName === normalizeForMatch("Movimentações")) sheets[sheetName] = applyMovementSheetCalculations(rows, context);
    else if (normalizedName === normalizeForMatch("Custas Intimação")) sheets[sheetName] = applyCustasSheetCalculations(rows, workbookContext);
    else if (normalizedName === normalizeForMatch("Extração de Arquivos")) sheets[sheetName] = applyExtractionSheetCalculations(rows, context);
    else if (normalizedName === normalizeForMatch("Notificações")) sheets[sheetName] = applyNotificationSheetCalculations(rows, context);
    else if (normalizedName === normalizeForMatch("Intimação")) sheets[sheetName] = applyIntimationSheetCalculations(rows, workbookContext);
    else if (normalizedName === normalizeForMatch("Consolidação")) sheets[sheetName] = applyConsolidationSheetCalculations(rows);
    else sheets[sheetName] = cloneRows(rows);
  }
  const interim = { sheetOrder: [...normalized.sheetOrder], sheets };
  for (const sheetName of normalized.sheetOrder) {
    if (normalizeForMatch(sheetName) === normalizeForMatch("Transcurso de Prazo")) {
      sheets[sheetName] = applyTranscursoSheetCalculations(sheets[sheetName], interim);
    }
  }
  return { sheetOrder: [...normalized.sheetOrder], sheets };
}

function movementDateValues(row, layout = null) {
  const columns = layout || { date: 2, day: 3, month: 4, year: 5 };
  const day = getCell(row, columns.day);
  const month = getCell(row, columns.month);
  const year = getCell(row, columns.year);
  if (day && month && year) {
    const monthNum = monthNumber(month);
    const yearNum = year.length === 4 ? Number(year) : 2000 + Number(year);
    return [
      `${String(Number(day)).padStart(2, "0")}.${String(monthNum).padStart(2, "0")}.${yearNum}`,
      `${String(Number(day)).padStart(2, "0")} de ${MONTHS_PT[monthNum]} de ${yearNum}`
    ];
  }
  return [fileDateFromText(getCell(row, columns.date) || firstDateFromRow(row)), formatDateForDocument(getCell(row, columns.date) || firstDateFromRow(row))];
}

function movementMatches(text, aliases) {
  const normalized = normalizeForMatch(text);
  return (Array.isArray(aliases) ? aliases : [aliases])
    .flatMap((alias) => String(alias || "").split(/[;|\n]+/))
    .some((alias) => normalized === normalizeForMatch(alias));
}

function normalizeAttachmentQuantity(value) {
  return String(value || "").trim() === "1" ? "1" : "1+";
}

function cloneMovementRules(rules) {
  return rules.map((rule) => ({ ...rule }));
}

function cloneMovementDocumentRules(rules) {
  return rules.map((rule) => Array.isArray(rule)
    ? { movement: rule[0] || "", file: rule[1] || "" }
    : { movement: rule.movement || "", file: rule.file || rule.document || "" });
}

function normalizeMovementDocumentRules(config = {}) {
  const hasCustomRules = Array.isArray(config.movement_document_rules);
  const source = hasCustomRules ? config.movement_document_rules : MOVEMENT_DOCUMENT_RULES;
  const rules = source
    .map((rule) => {
      const movement = String(Array.isArray(rule)
        ? rule[0]
        : (rule?.movement ?? rule?.movimentacao ?? rule?.movimentacoes ?? "")).trim();
      const file = String(Array.isArray(rule)
        ? rule[1]
        : (rule?.file ?? rule?.arquivo ?? rule?.document ?? rule?.arquivo_modelo ?? rule?.arquivoModelo ?? "")).trim();
      return movement && file ? { movement, file } : null;
    })
    .filter(Boolean);
  return rules.length || hasCustomRules ? rules : cloneMovementDocumentRules(MOVEMENT_DOCUMENT_RULES);
}

function normalizeMovementAttachmentRules(config = {}) {
  const hasCustomRules = Array.isArray(config.movement_attachment_rules);
  const source = hasCustomRules ? config.movement_attachment_rules : DEFAULT_MOVEMENT_ATTACHMENT_RULES;
  const rules = source
    .map((rule) => {
      const movement = String(rule?.movement ?? rule?.movimentacoes ?? rule?.movimentacao ?? "").trim();
      const document = String(rule?.document ?? rule?.arquivo_modelo ?? rule?.arquivoModelo ?? "").trim();
      const quantity = normalizeAttachmentQuantity(rule?.quantity ?? rule?.quantidade_anexos ?? rule?.quantidadeAnexos);
      return movement && document ? { movement, document, quantity } : null;
    })
    .filter(Boolean);
  return rules.length || hasCustomRules ? rules : cloneMovementRules(DEFAULT_MOVEMENT_ATTACHMENT_RULES);
}

function normalizeMovementPrefillOptions(config = {}) {
  const source = Array.isArray(config.movement_prefill_options)
    ? config.movement_prefill_options
    : (Array.isArray(config.movementPrefillOptions) ? config.movementPrefillOptions : MOVEMENT_PREFILL_OPTIONS);
  const seen = new Set();
  const result = [];
  for (const value of source) {
    const text = String(value || "").trim();
    const key = normalizeKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function normalizeConfig(config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  merged.onr_signature_enabled = merged.onr_signature_enabled === true;
  merged.onr_api_key = String(merged.onr_api_key || "").trim();
  merged.models_folder = String(merged.models_folder || "").trim();
  merged.note_requirement_model = String(merged.note_requirement_model || "").trim();
  merged.image_autuation_enabled = merged.image_autuation_enabled === true;
  merged.image_output_folder = String(merged.image_output_folder || "").trim();
  const bucketSize = Number(merged.image_output_bucket_size);
  merged.image_output_bucket_size = Number.isSafeInteger(bucketSize) && bucketSize > 0 ? bucketSize : DEFAULT_CONFIG.image_output_bucket_size;
  merged.image_output_folder_pattern = String(merged.image_output_folder_pattern || DEFAULT_CONFIG.image_output_folder_pattern).trim();
  merged.image_output_format = ["tiff", "pdf"].includes(String(merged.image_output_format || "").toLowerCase())
    ? String(merged.image_output_format).toLowerCase()
    : DEFAULT_CONFIG.image_output_format;
  merged.image_output_filename = String(merged.image_output_filename || DEFAULT_CONFIG.image_output_filename).trim();
  merged.movement_document_rules = normalizeMovementDocumentRules(merged);
  merged.movement_attachment_rules = normalizeMovementAttachmentRules(merged);
  merged.movement_prefill_options = normalizeMovementPrefillOptions(merged);
  merged.rtd_cost_table = normalizeRtdCostTable(merged.rtd_cost_table || merged.rtdCostTable);
  return merged;
}

function isCompatibilityMovement(text) {
  return movementMatches(text, ["Arquivos Compatíveis", "Arquivos Compativeis", "Arquivos Incompatíveis", "Arquivos Incompativeis"]);
}

function compatibilityAccompaniesMovement(entries, currentIndex, aliases) {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const movement = entries[index]?.movement || "";
    if (isCompatibilityMovement(movement)) continue;
    return movementMatches(movement, aliases);
  }
  return false;
}

function compatibilityAccompaniesBuiltInDocument(entries, currentIndex) {
  return compatibilityAccompaniesMovement(entries, currentIndex, [
    "Prenotado",
    "Prenotação",
    "Requerimento Consolidação",
    "Requerimento Consolidacao",
    "Desistência",
    "Desistencia"
  ]);
}

function compatibilityAttachmentCoveredByPreviousMovement(entries, currentIndex) {
  return compatibilityAccompaniesMovement(entries, currentIndex, [
    "Prenotado",
    "Prenotação",
    "Desistência",
    "Desistencia"
  ]);
}

function slotFromMovementLabel(row, movement, movementIndex, layout, label, options = {}) {
  const dateText = getCell(row, layout.date) || firstDateFromRow(row);
  const [fileDate, longDate] = movementDateValues(row, layout);
  const title = label.replace("(DATA)", `(${dateText || "DATA"})`);
  return {
    title,
    movement,
    movement_date: dateText,
    single_file: false,
    row_index: movementIndex,
    file_date: fileDate,
    long_date: longDate,
    optional: Boolean(options.optional),
    files: []
  };
}

function slotFromMovementRule(row, movement, movementIndex, layout, rule) {
  const slot = slotFromMovementLabel(row, movement, movementIndex, layout, rule.document);
  slot.single_file = normalizeAttachmentQuantity(rule.quantity) === "1";
  return slot;
}

function fixedCertificateTalaoSlot() {
  return {
    title: "Certidão Talão",
    movement: "Regra fixa",
    movement_date: "",
    single_file: true,
    row_index: -1,
    file_date: "00.00.0000",
    long_date: "",
    fixed_position: "bookend",
    files: []
  };
}

function movementIsConfigured(movement, attachmentRules, documentRules) {
  if (attachmentRules.some((rule) => movementMatches(movement, rule.movement))) return true;
  if (documentRules.some((rule) => movementMatches(movement, rule.movement))) return true;
  return false;
}

function movementHasFixedDocument(row, layout) {
  const documentName = getCell(row, layout?.document ?? -1);
  if (!documentName) return false;
  return normalizeKey(documentName) !== "NOME_ARQUIVO";
}

function movementAttachmentRequirements(odsPath, sheetName, sourceRowIndex, config = {}) {
  const rows = readOdsSheet(odsPath, sheetName || config.movements_sheet);
  const { entries } = movementRowsFromSheetRows(rows);
  const entryIndex = entries.findIndex((entry) => entry.sourceRow === Number(sourceRowIndex));
  if (entryIndex < 0) throw new Error("A movimentação selecionada não foi encontrada na guia.");
  const entry = entries[entryIndex];
  if (isCompatibilityMovement(entry.movement) && compatibilityAttachmentCoveredByPreviousMovement(entries, entryIndex)) return [];
  return normalizeMovementAttachmentRules(config)
    .filter((rule) => movementMatches(entry.movement, rule.movement))
    .map((rule) => {
      const slot = slotFromMovementRule(entry.row, entry.movement, entry.movementIndex, entry.layout, rule);
      return {
        title: slot.title,
        movement: slot.movement,
        movement_date: slot.movement_date,
        row_index: slot.row_index,
        file_date: slot.file_date,
        long_date: slot.long_date,
        single_file: slot.single_file
      };
    });
}

function movementRequiresOnrSignature(odsPath, sheetName, sourceRowIndex, config = {}) {
  const rows = readOdsSheet(odsPath, sheetName || config.movements_sheet);
  const { entries } = movementRowsFromSheetRows(rows);
  const entryIndex = entries.findIndex((entry) => entry.sourceRow === Number(sourceRowIndex));
  if (entryIndex < 0) throw new Error("A movimentação selecionada não foi encontrada na guia.");
  const entry = entries[entryIndex];
  const documentName = getCell(entry.row, entry.layout.document)
    || movementDocumentName(entry.movement, entries.slice(0, entryIndex).map((item) => item.movement), config);
  const source = fixedDocumentSource(config, documentName, "", "");
  return source.type === "model" && modelHasSignatureFields(source.path);
}

function analyzeMovements(odsPath, sheetName, config = {}) {
  const rows = readOdsSheet(odsPath, sheetName);
  const { entries } = movementRowsFromSheetRows(rows);
  const hasArquivamento = entries.some(({ movement }) => normalizeKey(movement).includes("ARQUIVAMENTO"));
  const hasPrenotacao = entries.some(({ movement }) => movementMatches(movement, ["Prenotado", "Prenotação"]));
  if (!hasArquivamento) return { slots: [], status: "Procedimento não concluído ainda" };
  if (!hasPrenotacao) return { slots: [], status: "Prenotação não encontrada na guia Movimentações" };
  const slots = [];
  const rules = normalizeMovementAttachmentRules(config);
  const documentRules = normalizeMovementDocumentRules(config);
  const previousMovements = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const { row, movement, movementIndex, layout } = entries[entryIndex];
    const hasGeneratedDocument = movementHasFixedDocument(row, layout) || Boolean(movementDocumentName(movement, previousMovements, config));
    previousMovements.push(movement);
    if (isCompatibilityMovement(movement) && compatibilityAttachmentCoveredByPreviousMovement(entries, entryIndex)) {
      continue;
    }
    const matchedRules = rules.filter((rule) => movementMatches(movement, rule.movement));
    if (matchedRules.length) {
      for (const rule of matchedRules) slots.push(slotFromMovementRule(row, movement, movementIndex, layout, rule));
      continue;
    }
    if (!movementIsConfigured(movement, rules, documentRules) && !hasGeneratedDocument) {
      slots.push(slotFromMovementLabel(row, movement, movementIndex, layout, `${movement} (DATA)`, { optional: true }));
      continue;
    }
  }
  slots.unshift(fixedCertificateTalaoSlot());
  return { slots, status: `${slots.length} coluna(s) de anexos preparada(s)` };
}

function joinPortuguese(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} e ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function stripNoteItemNumber(text) {
  return String(text || "").replace(/^\s*\d+\.\s*/, "").trim();
}

function noteTextsFromItems(matricula, items) {
  const formatted = formatPrenotation(matricula);
  if (!formatted) throw new Error("Informe o número da matrícula.");
  const numbered = items.map(stripNoteItemNumber).filter(Boolean).map((item, index) => `${index + 1}. ${item}`);
  if (!numbered.length) throw new Error("Informe pelo menos um item da Nota de Exigência.");
  const header = NOTE_REQUIREMENT_HEADER.replace("{matricula}", formatted);
  const result = { matricula: formatted, header, items: numbered.join("\n\n"), full_text: `${header}\n\n${numbered.join("\n\n")}`, item_3_body: numbered[2] ? stripNoteItemNumber(numbered[2]) : "" };
  numbered.forEach((item, index) => {
    result[`item_${index + 1}`] = item;
    result[`item_${index + 1}_body`] = stripNoteItemNumber(item);
  });
  return result;
}

function buildNoteRequirementTexts(matricula, { missing = [], not_pdfa = [], unsigned = [] }) {
  const formatted = formatPrenotation(matricula);
  if (!formatted) throw new Error("Informe o número da matrícula.");
  if (!missing.length && !not_pdfa.length && !unsigned.length) throw new Error("Marque pelo menos uma exigência.");
  const docKeys = Object.keys(NOTE_DOCUMENTS);
  const missingSet = new Set(missing);
  const pdfaSet = new Set(not_pdfa);
  const unsignedSet = new Set(unsigned);
  const clauses = [];
  if (missingSet.size) {
    const names = docKeys.filter((key) => missingSet.has(key)).map((key) => `de ${NOTE_DOCUMENTS[key][1]}`);
    clauses.push(`não há a presença ${names.length === 1 ? `do arquivo ${names[0]}` : `dos arquivos ${joinPortuguese(names)}`}`);
  }
  const groups = new Map();
  for (const key of docKeys) {
    if (missingSet.has(key) || (!pdfaSet.has(key) && !unsignedSet.has(key))) continue;
    const group = `${pdfaSet.has(key)}:${unsignedSet.has(key)}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(key);
  }
  for (const [group, keys] of groups) {
    const [formatIssue, signatureIssue] = group.split(":").map((value) => value === "true");
    const names = keys.map((key) => `de ${NOTE_DOCUMENTS[key][1]}`);
    const subject = keys.length === 1 ? `o arquivo ${names[0]}` : `os arquivos ${joinPortuguese(names)}`;
    const verb = keys.length === 1 ? "está" : "estão";
    const signed = keys.length === 1 ? "assinado" : "assinados";
    if (formatIssue && signatureIssue) clauses.push(`${subject} não ${verb} no formato PDF/A nem ${signed} digitalmente`);
    else if (formatIssue) clauses.push(`${subject} não ${verb} no formato PDF/A`);
    else clauses.push(`${subject} não ${verb} ${signed} digitalmente`);
  }
  const actions = [];
  if (missingSet.size) actions.push(missingSet.size === 1 ? "apresentado o respectivo arquivo faltante" : "apresentados os respectivos arquivos faltantes");
  const correctionCount = [...groups.values()].flat().length;
  if (correctionCount) {
    actions.push(
      correctionCount === 1
        ? "regularizado, para que esteja em conformidade com os requisitos apresentados no item 2 desta Nota de Exigência"
        : "regularizados, para que estejam em conformidade com os requisitos apresentados no item 2 desta Nota de Exigência"
    );
  }
  const joinedClauses = clauses.length <= 1 ? clauses[0] : `${clauses.slice(0, -1).join("; e que ")}; e que ${clauses[clauses.length - 1]}`;
  const item3 = `3. Observa-se, pelos documentos apresentados, que ${joinedClauses}, devendo ser ${joinPortuguese(actions)}.`;
  const header = NOTE_REQUIREMENT_HEADER.replace("{matricula}", formatted);
  const items = [NOTE_REQUIREMENT_ITEM_1, NOTE_REQUIREMENT_ITEM_2, item3].join("\n\n");
  return { matricula: formatted, header, item_1: NOTE_REQUIREMENT_ITEM_1, item_2: NOTE_REQUIREMENT_ITEM_2, item_3: item3, item_3_body: stripNoteItemNumber(item3), items, full_text: `${header}\n\n${items}` };
}

function protocolContextFromPath(odsPath) {
  const candidates = [path.basename(odsPath, path.extname(odsPath)), path.basename(path.dirname(odsPath))];
  for (const text of candidates) {
    const match = text.match(/(IN[\w.-]+)\s*-\s*([0-9.]+)/i);
    if (match) return { office_protocol: match[1].toUpperCase(), prenotation: formatPrenotation(match[2]), label: `Protocolo ${match[1].toUpperCase()} - ${formatPrenotation(match[2])}` };
  }
  return { office_protocol: "INXXXXX", prenotation: "XX.XXX", label: "Protocolo INXXXXX - XX.XXX" };
}

function protocolContextFromValues(data = {}, fallbackPath = "") {
  const fallback = fallbackPath ? protocolContextFromPath(fallbackPath) : { office_protocol: "INXXXXX", prenotation: "XX.XXX" };
  const rawOffice = data.officeProtocol || data.office_protocol || data.protocolOffice || "";
  const rawPrenotation = data.prenotation || data.protocolPrenotation || "";
  const office = String(rawOffice || fallback.office_protocol || "INXXXXX").trim().toUpperCase().replace(/\s+/g, "");
  const prenotation = formatPrenotation(String(rawPrenotation || fallback.prenotation || "XX.XXX").trim());
  return {
    office_protocol: office || "INXXXXX",
    prenotation: prenotation || "XX.XXX",
    label: `Protocolo ${office || "INXXXXX"} - ${prenotation || "XX.XXX"}`
  };
}

function addField(fields, key, value) {
  if (!String(key || "").trim()) return;
  fields[String(key).trim()] = String(value ?? "");
  fields[normalizeKey(key)] = String(value ?? "");
}

function fieldExists(fields, key) {
  const raw = String(key || "").trim();
  if (!raw) return false;
  return Object.prototype.hasOwnProperty.call(fields, raw)
    || Object.prototype.hasOwnProperty.call(fields, normalizeKey(raw));
}

function addFieldIfMissing(fields, key, value) {
  if (!fieldExists(fields, key)) addField(fields, key, value);
}

function fieldValue(fields, key) {
  const raw = xmlUnescape(String(key || "").trim());
  if (Object.prototype.hasOwnProperty.call(fields, raw)) return fields[raw];
  const normalized = normalizeKey(raw);
  if (Object.prototype.hasOwnProperty.call(fields, normalized)) return fields[normalized];
  const aliases = [];
  if (normalized.includes("CPF") && normalized.includes("CNPJ")) {
    aliases.push("CPF_CNPJ", "CPF_OU_CNPJ", "CPF_CNPJ_LISTA", "CPFS_CNPJS");
  }
  if (normalized === "DATA_CARTA") aliases.push("DATA_DA_CARTA");
  if (normalized === "DATA_CERTIDAO") aliases.push("DATA_DA_CERTIDAO");
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(fields, alias)) return fields[alias];
  }
  return undefined;
}

function addProtocolFields(fields, context) {
  addField(fields, "PROTOCOLO", context.prenotation);
  addField(fields, "PROT_FORMATADO", context.prenotation);
  addField(fields, "PROTOCOLO_FORMATADO", context.prenotation);
  addField(fields, "PROTOCOLO FORMATADO", context.prenotation);
  addField(fields, "PRENOTACAO", context.prenotation);
  addField(fields, "PRENOTAÇÃO", context.prenotation);
  addField(fields, "PROTOCOLO_OFICIO", context.office_protocol);
  addField(fields, "PROTOCOLO OFÍCIO", context.office_protocol);
  addField(fields, "PROTOCOLO_COMPLETO", context.label);
  addField(fields, "PROTOCOLO COMPLETO", context.label);
}

function normalizeSigners(config = {}) {
  const source = Array.isArray(config.signers)
    ? config.signers
    : (Array.isArray(config.signatures) ? config.signatures : []);
  return source
    .map((entry) => {
      if (typeof entry === "string") {
        const [name, ...cargo] = entry.split("|");
        return { name: String(name || "").trim(), cargo: cargo.join("|").trim() };
      }
      return {
        name: String(entry?.name || entry?.nome || "").trim(),
        cargo: String(entry?.cargo || entry?.role || "").trim()
      };
    })
    .filter((entry) => entry.name || entry.cargo);
}

function resolveSignature(config = {}, data = {}) {
  const signers = normalizeSigners(config);
  const hasExplicitName = ["signerName", "signatureName", "assina"]
    .some((key) => Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined);
  const hasExplicitCargo = ["signerCargo", "signatureCargo", "cargoAssina"]
    .some((key) => Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined);
  const requestedName = String(data.signerName ?? data.signatureName ?? data.assina ?? "").trim();
  const requestedCargo = String(data.signerCargo ?? data.signatureCargo ?? data.cargoAssina ?? "").trim();
  const defaultName = String(config.default_signature_name || "").trim();
  const selectedName = hasExplicitName ? requestedName : (defaultName || signers[0]?.name || "");
  const selectedKey = normalizeKey(selectedName);
  const found = signers.find((signer) => normalizeKey(signer.name) === selectedKey);
  const defaultCargo = String(config.default_signature_cargo || "").trim();
  return {
    name: selectedName,
    cargo: hasExplicitCargo ? requestedCargo : (found?.cargo || defaultCargo || "")
  };
}

function addSignatureFields(fields, config = {}, data = {}) {
  const signature = resolveSignature(config, data);
  addField(fields, "NOME_ASSINA", signature.name);
  addField(fields, "NOME ASSINA", signature.name);
  addField(fields, "CARGO_ASSINA", signature.cargo);
  addField(fields, "CARGO ASSINA", signature.cargo);
}

function addGenerationDateFields(fields) {
  const today = formatDateLong(new Date());
  for (const key of ["DATA_ENCERRAMENTO", "DATA-ENCERRAMENTO", "DATA ENCERRAMENTO", "DATA_DE_ENCERRAMENTO", "DATA DE ENCERRAMENTO"]) addField(fields, key, today);
}

function addMovementFields(fields, row, context, layout = null) {
  const columns = layout || { movement: 1, document: 6, day: 3, month: 4, year: 5 };
  const [fileDate, longDate] = movementDateValues(row, layout);
  const autuationDate = autuationDateFromMovement(row, layout) || longDate;
  const movement = getCell(row, columns.movement);
  const documentName = getCell(row, columns.document);
  addProtocolFields(fields, context);
  addField(fields, "MOVIMENTACAO", movement);
  addField(fields, "MOVIMENTAÇÃO", movement);
  addField(fields, "NOME_MOVIMENTACAO", movement);
  addField(fields, "NOME MOVIMENTAÇÃO", movement);
  addField(fields, "NOME_ARQUIVO", documentName);
  addField(fields, "NOME ARQUIVO", documentName);
  addField(fields, "DATA", longDate);
  if (isAutuacaoDocument(documentName)) {
    addField(fields, "DATA EXTENSO", autuationDate);
    addField(fields, "DATA_EXTENSO", autuationDate);
  } else {
    addFieldIfMissing(fields, "DATA EXTENSO", longDate);
    addFieldIfMissing(fields, "DATA_EXTENSO", longDate);
  }
  addField(fields, "DATA AUTUAÇÃO", autuationDate);
  addField(fields, "DATA AUTUACAO", autuationDate);
  addField(fields, "DATA NA AUTUAÇÃO", autuationDate);
  addField(fields, "DATA NA AUTUACAO", autuationDate);
  addField(fields, "DATA_MOVIMENTACAO", longDate);
  addField(fields, "DATA MOVIMENTAÇÃO", longDate);
  addField(fields, "DATA_CERTIDAO", longDate);
  addField(fields, "DATA CERTIDÃO", longDate);
  addField(fields, "DATA_JUNTADA", longDate);
  addField(fields, "DATA JUNTADA", longDate);
  addField(fields, "DATA_ARQUIVO", fileDate);
  addField(fields, "DIA", getCell(row, columns.day));
  addField(fields, "MES", getCell(row, columns.month));
  addField(fields, "MÊS", getCell(row, columns.month));
  addField(fields, "ANO", getCell(row, columns.year));
  addGenerationDateFields(fields);
}

function isRtdPositiveCertificate(documentName) {
  const key = normalizeKey(documentName);
  return key.includes("RTD") && key.includes("POSITIV") && (key.includes("CERTID") || key.includes("CERTIDAO"));
}

function isRtdNegativeCertificate(documentName) {
  const key = normalizeKey(documentName);
  return key.includes("RTD") && key.includes("NEGATIV") && (key.includes("CERTID") || key.includes("CERTIDAO"));
}

const INTIMATION_CERTIFICATE_DATE_HEADERS = [
  "DATA DA CERTIDÃO",
  "DATA DA CERTIDAO",
  "DATA CERTIDÃO",
  "DATA CERTIDAO",
  "DATA DA CERTIDÃO POSITIVA",
  "DATA CERTIDÃO POSITIVA",
  "DATA DA CERTIDAO POSITIVA",
  "DATA CERTIDAO POSITIVA",
  "DATA DA CERTIDÃO NEGATIVA",
  "DATA CERTIDÃO NEGATIVA",
  "DATA DA CERTIDAO NEGATIVA",
  "DATA CERTIDAO NEGATIVA"
];

const INTIMATION_GENERIC_DATE_HEADERS = [
  "DATA DA CERTIDÃO",
  "DATA DA CERTIDAO",
  "DATA CERTIDÃO",
  "DATA CERTIDAO"
];

const INTIMATION_POSITIVE_DATE_HEADERS = [
  "DATA DA CERTIDÃO POSITIVA",
  "DATA CERTIDÃO POSITIVA",
  "DATA DA CERTIDAO POSITIVA",
  "DATA CERTIDAO POSITIVA"
];

const INTIMATION_NEGATIVE_DATE_HEADERS = [
  "DATA DA CERTIDÃO NEGATIVA",
  "DATA CERTIDÃO NEGATIVA",
  "DATA DA CERTIDAO NEGATIVA",
  "DATA CERTIDAO NEGATIVA"
];

function isAutuacaoDocument(documentName) {
  return normalizeKey(documentName) === "AUTUACAO";
}

function isExtractionCertificateDocument(documentName) {
  return normalizeKey(documentName) === "CERTIDAO_EXTRACAO_DE_ARQUIVOS";
}

function isAnyExtractionCertificateDocument(documentName) {
  const key = normalizeKey(documentName);
  return key.includes("CERTIDAO") && key.includes("EXTRACAO") && key.includes("ARQUIVO");
}

function isRequerimentoCertificate(documentName) {
  const key = normalizeKey(documentName);
  return key.includes("CERTID") && key.includes("REQUERIMENTO");
}

function isConsolidationAverbacaoCertificate(documentName) {
  const key = normalizeKey(documentName);
  return key.includes("CERTID") && key.includes("AVERBACAO") && key.includes("CONSOLIDACAO");
}

function odtValue(value) {
  return xmlEscape(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "<text:line-break/>");
}

function odtItemsBlock(value, paragraphAttrs = "") {
  const paragraphs = String(value || "").split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  const attrsText = paragraphAttrs || "";
  return paragraphs
    .map((part) => `<text:p${attrsText}><text:tab/>${odtValue(part)}</text:p>`)
    .join(`<text:p${attrsText}/>`);
}

function replaceFieldsInXml(xml, fields) {
  let text = xml;
  const items = fields.ITENS || fields.ITEMS;
  if (items) {
    text = text.replace(
      /<text:p\b(?![^>]*\/>)([^>]*)>(?:(?!<\/text:p>)[\s\S])*?(?:\{\{ITENS\}\}|\[\[ITENS\]\]|&lt;ITENS&gt;|<text:database-display\b[^>]*(?:text:column-name|text:name)="ITENS"(?:(?!<\/text:p>)[\s\S])*?<\/text:database-display>)(?:(?!<\/text:p>)[\s\S])*?<\/text:p>/g,
      (_match, paragraphAttrs) => odtItemsBlock(items, paragraphAttrs)
    );
  }

  text = text.replace(/\{\{([^}]+)\}\}|\[\[([^\]]+)\]\]|&lt;([^&<>]+)&gt;/g, (match, a, b, c) => {
    const value = fieldValue(fields, a || b || c);
    return value === undefined ? match : odtValue(value);
  });

  text = text.replace(/<text:database-display\b([^>]*)>[\s\S]*?<\/text:database-display>/g, (match, attributes) => {
    const found = attributes.match(/(?:text:column-name|text:name)="([^"]+)"/);
    if (!found) return match;
    const value = fieldValue(fields, found[1]);
    return value === undefined ? match : `<text:span>${odtValue(value)}</text:span>`;
  });

  const keys = Object.keys(fields).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const value = odtValue(fields[key]);
    const patterns = [`{{${key}}}`, `[[${key}]]`, `<<${key}>>`, `<${key}>`];
    for (const pattern of patterns) {
      text = text.split(pattern).join(value);
      text = text.split(xmlEscape(pattern)).join(value);
    }
    const fieldRegex = new RegExp(`<text:database-display\\b([^>]*(?:text:column-name|text:name)="${key}"[^>]*)>[\\s\\S]*?<\\/text:database-display>`, "g");
    text = text.replace(fieldRegex, `<text:span>${value}</text:span>`);
  }
  return text;
}

function mergeOdtDocument(templatePath, outputPath, fields) {
  const zip = new AdmZip(templatePath);
  for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith(".xml")) {
      const xml = entry.getData().toString("utf8");
      zip.updateFile(entry.entryName, Buffer.from(replaceFieldsInXml(xml, fields), "utf8"));
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  zip.writeZip(outputPath);
}

function modelHasSignatureFields(modelPath) {
  const zip = new AdmZip(modelPath);
  const xml = zip.getEntries()
    .filter((entry) => entry.entryName.endsWith(".xml"))
    .map((entry) => entry.getData().toString("utf8"))
    .join("\n");
  const fields = new Set();
  for (const match of xml.matchAll(/\{\{([^}]+)\}\}|\[\[([^\]]+)\]\]|<<([^>]+)>>|&lt;([^&<>]+)&gt;|<text:database-display\b([^>]*?)>/g)) {
    const placeholder = match[1] || match[2] || match[3] || match[4];
    const attributes = match[5] || "";
    const field = placeholder || attributes.match(/(?:text:column-name|text:name)="([^"]+)"/)?.[1] || "";
    if (field) fields.add(normalizeKey(field));
  }
  for (const match of xml.matchAll(/<(NOME(?:_ASSINA| ASSINA)|CARGO(?:_ASSINA| ASSINA))>/gi)) {
    fields.add(normalizeKey(match[1]));
  }
  const hasName = ["NOME_ASSINA", "NOME ASSINA"].some((field) => fields.has(normalizeKey(field)));
  const hasCargo = ["CARGO_ASSINA", "CARGO ASSINA"].some((field) => fields.has(normalizeKey(field)));
  return hasName && hasCargo;
}

function findModelFile(modelsFolder, modelName) {
  if (!modelsFolder || !fs.existsSync(modelsFolder)) return null;
  const wanted = normalizeKey(modelName.replace(/(\.MODELO)?\.odt$/i, ""));
  const direct = [`${modelName}.MODELO.odt`, `${modelName}.odt`, modelName];
  for (const name of direct) {
    const candidate = path.join(modelsFolder, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && path.extname(candidate).toLowerCase() === ".odt") return candidate;
  }
  for (const name of fs.readdirSync(modelsFolder)) {
    if (path.extname(name).toLowerCase() !== ".odt") continue;
    const bare = name.replace(/\.odt$/i, "").replace(/\.MODELO$/i, "");
    if (normalizeKey(bare) === wanted) return path.join(modelsFolder, name);
  }
  return null;
}

function requireModelFile(modelsFolder, modelName) {
  const found = findModelFile(modelsFolder, modelName);
  if (!found) throw new Error(`Modelo "${modelName}" não encontrado na pasta: ${modelsFolder}`);
  return found;
}

const FIXED_SOURCE_EXTENSIONS = new Set([
  ".pdf",
  ".odt",
  ".doc",
  ".docx",
  ".rtf",
  ".txt",
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".tif",
  ".tiff"
]);

function pathIsInside(child, parent) {
  if (!child || !parent) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function fixedSourceKey(filePath, includeExtension = false) {
  const ext = path.extname(filePath);
  const name = includeExtension ? path.basename(filePath) : path.basename(filePath, ext);
  return normalizeKey(name.replace(/\.MODELO$/i, ""));
}

function findManualFixedSourceFile(documentName, config = {}, protocolFolder = "", pdfsDir = "") {
  const raw = String(documentName || "").trim();
  if (!raw) return "";
  const roots = [protocolFolder, config.models_folder].filter((folder, index, list) => (
    folder && fs.existsSync(folder) && fs.statSync(folder).isDirectory() && list.indexOf(folder) === index
  ));
  const ext = path.extname(raw).toLowerCase();
  const directCandidates = [];
  if (path.isAbsolute(raw)) directCandidates.push(raw);
  for (const root of roots) {
    directCandidates.push(path.join(root, raw));
    if (!ext) for (const sourceExt of FIXED_SOURCE_EXTENSIONS) directCandidates.push(path.join(root, `${raw}${sourceExt}`));
  }
  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  const wantedStem = fixedSourceKey(raw, false);
  const wantedName = ext ? fixedSourceKey(raw, true) : "";
  const found = [];
  for (const root of roots) {
    walkFiles(root, (filePath) => {
      const fileExt = path.extname(filePath).toLowerCase();
      if (!FIXED_SOURCE_EXTENSIONS.has(fileExt)) return;
      if (pdfsDir && pathIsInside(filePath, pdfsDir)) return;
      if (ext && fixedSourceKey(filePath, true) !== wantedName) return;
      if (!ext && fixedSourceKey(filePath, false) !== wantedStem) return;
      found.push(filePath);
    });
  }
  return found.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || "";
}

function fixedDocumentSource(config, documentName, protocolFolder, pdfsDir) {
  const modelPath = findModelFile(config.models_folder, documentName);
  if (modelPath) return { type: "model", path: modelPath };
  const filePath = findManualFixedSourceFile(documentName, config, protocolFolder, pdfsDir);
  if (filePath) return { type: "file", path: filePath };
  throw new Error(`Modelo ou arquivo "${documentName}" não encontrado. Verifique a pasta de modelos, a pasta do protocolo ou a tabela Movimento | Arquivo nas configurações.`);
}

function uniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const parsed = path.parse(targetPath);
  let counter = 2;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name} - ${String(counter).padStart(2, "0")}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    counter += 1;
  }
}

function rowHasValues(row) {
  return row.some((cell) => String(cell).trim());
}

function uniqueTextValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = normalizeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function joinWithCommaAnd(values) {
  const items = uniqueTextValues(values);
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} e ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function documentWithType(document, type = "") {
  const text = String(document || "").trim();
  if (!text) return "";
  const explicitType = String(type || "").trim();
  if (explicitType) return `${explicitType} nº ${text}`;
  const key = normalizeKey(text);
  if (key.startsWith("CPF") || key.startsWith("CNPJ")) return text;
  const digits = text.replace(/\D/g, "");
  return `${digits.length === 14 ? "CNPJ" : "CPF"} ${text}`;
}

function personPairText({ name, document, documentType }) {
  if (name && document) return `${name}, ${documentWithType(document, documentType)}`;
  return name || documentWithType(document, documentType);
}

function separatedSignerLeadText(personPairs) {
  const usable = personPairs.filter(({ name, document }) => name || document);
  if (!usable.length) return "";
  if (usable.length === 1) return usable[0].name || documentWithType(usable[0].document, usable[0].documentType);
  const beforeLast = usable.slice(0, -1).map(personPairText);
  const last = usable[usable.length - 1];
  return joinWithCommaAnd([...beforeLast, last.name || documentWithType(last.document, last.documentType)]);
}

function applySeparatedSignerFields(fields, personPairs) {
  const usable = personPairs.filter(({ name, document }) => name || document);
  if (!usable.length || !fieldExists(fields, "ASSINOU DIGITALMENTE") || !fieldExists(fields, "DOC_TIPO")) return;
  const last = usable[usable.length - 1];
  const signerText = separatedSignerLeadText(usable);
  if (signerText) {
    addField(fields, "ASSINOU DIGITALMENTE", signerText);
    addField(fields, "ASSINOU_DIGITALMENTE", signerText);
  }
  if (last.documentType) addField(fields, "DOC_TIPO", last.documentType);
  if (last.document) {
    addField(fields, "CPF ou CNPJ", last.document);
    addField(fields, "CPF OU CNPJ", last.document);
    addField(fields, "CPF_CNPJ", last.document);
  }
}

function firstMatchingCell(row, headers, predicate) {
  for (let index = 0; index < headers.length; index += 1) {
    if (!predicate(headers[index])) continue;
    const value = getCell(row, index);
    if (value) return value;
  }
  return "";
}

function isDocumentTypeFieldHeader(header) {
  const key = normalizeKey(header);
  return key === "DOC_TIPO" || key === "DOCUMENTO_TIPO" || key === "TIPO_DOCUMENTO" || key === "TIPO_DOC";
}

function personPairsFromEntries(entries, headers, nameIndex = null) {
  const seen = new Set();
  const pairs = [];
  for (const entry of entries) {
    const row = entry.row || [];
    const name = Number.isInteger(nameIndex)
      ? getCell(row, nameIndex) || firstMatchingCell(row, headers, isNameFieldHeader)
      : firstMatchingCell(row, headers, isNameFieldHeader);
    const document = firstMatchingCell(row, headers, isCpfCnpjFieldHeader);
    const documentType = firstMatchingCell(row, headers, isDocumentTypeFieldHeader);
    if (!name && !document) continue;
    const key = `${normalizeKey(name)}|${normalizeKey(document)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ name, document, documentType });
  }
  return pairs;
}

function idColumnIndex(headers) {
  return headers.findIndex((header) => normalizeKey(header) === "ID");
}

function groupedEntriesForRow(rows, headers, rowIndex, firstDataIndex = 1) {
  const row = rows[rowIndex] || [];
  const idIndex = idColumnIndex(headers);
  const id = idIndex >= 0 ? getCell(row, idIndex) : "";
  if (!id) return [{ row, rowNumber: rowIndex + 1 }];
  const normalizedId = normalizeKey(id);
  const entries = [];
  for (let index = firstDataIndex; index < rows.length; index += 1) {
    const candidate = rows[index];
    if (!rowHasValues(candidate)) continue;
    if (normalizeKey(getCell(candidate, idIndex)) === normalizedId) {
      entries.push({ row: candidate, rowNumber: index + 1 });
    }
  }
  return entries.length ? entries : [{ row, rowNumber: rowIndex + 1 }];
}

function isNameFieldHeader(header) {
  const key = normalizeKey(header);
  if (!key) return false;
  if (key.startsWith("AUXILIAR")) return false;
  if (key.includes("ARQUIVO") || key.includes("MOVIMENTACAO") || key.includes("PROTOCOLO")) return false;
  return ["NOME", "NOMES", "NOME_COMPLETO"].includes(key)
    || key.endsWith("_NOMES")
    || key.includes("NOME")
    || key.includes("ASSINOU_DIGITALMENTE")
    || key.includes("ASSINADO_DIGITALMENTE")
    || key.includes("ASSINANTE");
}

function isCpfCnpjFieldHeader(header) {
  const key = normalizeKey(header);
  return key.includes("CPF") || key.includes("CNPJ");
}

function collectColumnValues(entries, headers, predicate) {
  const values = [];
  headers.forEach((header, index) => {
    if (!predicate(header)) return;
    for (const entry of entries) values.push(getCell(entry.row, index));
  });
  return uniqueTextValues(values);
}

function addGroupedAliases(fields, names, documents, entries, personPairs = []) {
  const nameText = joinWithCommaAnd(names);
  const documentText = joinWithCommaAnd(documents);
  if (nameText) {
    for (const key of ["NOME", "NOMES", "NOME_COMPLETO", "NOME COMPLETO"]) {
      addField(fields, key, nameText);
    }
    names.forEach((name, index) => {
      addField(fields, `NOME_${index + 1}`, name);
      addField(fields, `NOME ${index + 1}`, name);
    });
  }
  if (documentText) {
    for (const key of ["CPF ou CNPJ", "CPF OU CNPJ", "CPF_CNPJ", "CPF/CNPJ", "CPFS_CNPJS", "CPFS/CNPJS"]) {
      addField(fields, key, documentText);
    }
    documents.forEach((document, index) => {
      addField(fields, `CPF_CNPJ_${index + 1}`, document);
      addField(fields, `CPF OU CNPJ ${index + 1}`, document);
    });
  }
  if (names.length || documents.length) {
    const combined = personPairs.length
      ? personPairs.map(personPairText)
      : Array.from({ length: Math.max(names.length, documents.length) }, (_, index) => {
        if (names[index] && documents[index]) return `${names[index]}, ${documentWithType(documents[index])}`;
        return names[index] || documentWithType(documents[index]);
      });
    const combinedText = joinWithCommaAnd(combined);
    addField(fields, "NOMES E DOCUMENTOS", combinedText);
    addField(fields, "NOMES_E_DOCUMENTOS", combinedText);
    addField(fields, "NOMES E CPFS", combinedText);
    addField(fields, "NOMES_E_CPFS", combinedText);
    addField(fields, "NOMES E CPF", combinedText);
    addField(fields, "NOMES_E_CPF", combinedText);
    addField(fields, "ASSINANTES", combinedText);
    addField(fields, "ASSINANTES E DOCUMENTOS", combinedText);
    addField(fields, "ASSINANTES_E_DOCUMENTOS", combinedText);
    addField(fields, "ASSINOU DIGITALMENTE E DOCUMENTOS", combinedText);
    addField(fields, "ASSINOU_DIGITALMENTE_E_DOCUMENTOS", combinedText);
    addField(fields, "ASSINADO DIGITALMENTE POR", combinedText);
    addField(fields, "ASSINADO_DIGITALMENTE_POR", combinedText);
  }
  applySeparatedSignerFields(fields, personPairs);
  addField(fields, "LINHA", entries[0]?.rowNumber || "");
  addField(fields, "LINHAS", entries.map((entry) => entry.rowNumber).join(", "));
}

function rowGroupToFields(headers, entries, nameIndex = null) {
  const fields = {};
  const first = entries[0] || { row: [], rowNumber: "" };
  first.row.forEach((value, index) => {
    const letter = columnLetter(index);
    const header = headers[index] && String(headers[index]).trim() ? headers[index] : letter;
    addField(fields, header, value);
    addField(fields, letter, value);
    addField(fields, `COLUNA_${letter}`, value);
  });
  const names = uniqueTextValues([
    ...(Number.isInteger(nameIndex) ? entries.map((entry) => getCell(entry.row, nameIndex)) : []),
    ...collectColumnValues(entries, headers, isNameFieldHeader)
  ]);
  const documents = collectColumnValues(entries, headers, isCpfCnpjFieldHeader);
  const personPairs = personPairsFromEntries(entries, headers, nameIndex);
  headers.forEach((header, index) => {
    if (!header) return;
    const letter = columnLetter(index);
    if (isNameFieldHeader(header) && names.length) {
      const text = joinWithCommaAnd(names);
      addField(fields, header, text);
      addField(fields, letter, text);
      addField(fields, `COLUNA_${letter}`, text);
    }
    if (isCpfCnpjFieldHeader(header) && documents.length) {
      const text = joinWithCommaAnd(documents);
      addField(fields, header, text);
      addField(fields, letter, text);
      addField(fields, `COLUNA_${letter}`, text);
    }
  });
  addGroupedAliases(fields, names, documents, entries, personPairs);
  return fields;
}

function rowToFields(headers, row, rowNumber) {
  return rowGroupToFields(headers, [{ row, rowNumber }]);
}

function headerTokenIndices(headers, tokens) {
  const indices = [];
  for (const token of tokens) {
    const normalizedToken = normalizeKey(token);
    const tokenHasQuestion = String(token).includes("?");
    headers.forEach((header, index) => {
      if (indices.includes(index)) return;
      if (tokenHasQuestion && !String(header).includes("?")) return;
      const normalizedHeader = normalizeKey(header);
      if (normalizedToken && (normalizedToken === normalizedHeader || normalizedHeader.includes(normalizedToken))) indices.push(index);
    });
  }
  return indices;
}

function dateColumnIndices(headers, tokens, allowGenericFallback = true) {
  const indices = headerTokenIndices(headers, tokens);
  if (indices.length || !allowGenericFallback) return indices;
  headers.forEach((header, index) => {
    const normalized = normalizeKey(header);
    if (normalized.includes("DATA") && normalized.includes("CERTIDAO") && !indices.includes(index)) indices.push(index);
  });
  return indices;
}

function exactHeaderIndices(headers, tokens) {
  const wanted = tokens.map(normalizeKey).filter(Boolean);
  const indices = [];
  headers.forEach((header, index) => {
    if (wanted.includes(normalizeKey(header))) indices.push(index);
  });
  return indices;
}

function firstHeaderIndex(headers, tokens) {
  const indices = headerTokenIndices(headers, tokens);
  return indices.length ? indices[0] : -1;
}

function rowMatchesIntimationResult(row, headers, expectedResult) {
  const expected = normalizeKey(expectedResult);
  if (!expected) return true;
  const resultIndex = firstHeaderIndex(headers, ["RESULTADO"]);
  if (resultIndex < 0) return true;
  return normalizeKey(getCell(row, resultIndex)).includes(expected);
}

function fieldsFromIntimationByDate(odsPath, matchDate, expectedResult) {
  const rows = readOdsSheet(odsPath, "Intimação");
  const headers = rows[0] || [];
  const specificHeaders = normalizeKey(expectedResult).includes("POSITIV")
    ? INTIMATION_POSITIVE_DATE_HEADERS
    : INTIMATION_NEGATIVE_DATE_HEADERS;
  let indices = exactHeaderIndices(headers, specificHeaders);
  if (!indices.length) indices = exactHeaderIndices(headers, INTIMATION_GENERIC_DATE_HEADERS);
  if (!indices.length) indices = dateColumnIndices(headers, specificHeaders, false);
  if (!indices.length) indices = dateColumnIndices(headers, INTIMATION_GENERIC_DATE_HEADERS, false);
  if (!indices.length) throw new Error(`A guia "Intimação" não tem uma coluna de data compatível.`);
  const wanted = fileDateFromText(matchDate);
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowHasValues(row) || !rowMatchesIntimationResult(row, headers, expectedResult)) continue;
    for (const index of indices) {
      if (fileDateFromText(getCell(row, index)) === wanted) {
        return rowGroupToFields(headers, groupedEntriesForRow(rows, headers, rowIndex));
      }
    }
  }
  throw new Error(`Não encontrei na guia "Intimação" uma linha ${String(expectedResult || "").toLowerCase()} com data ${matchDate}.`);
}

function fieldsFromSheetByColumnValue(odsPath, sheetName, headerTokens, acceptedValues) {
  const rows = readOdsSheet(odsPath, sheetName);
  const headers = rows[0] || [];
  const indices = headerTokenIndices(headers, headerTokens);
  if (!indices.length) throw new Error(`A guia "${sheetName}" não tem a coluna: ${headerTokens.join(", ")}`);
  const accepted = new Set(acceptedValues.map(normalizeKey));
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowHasValues(row)) continue;
    for (const index of indices) {
      if (accepted.has(normalizeKey(getCell(row, index)))) {
        return rowGroupToFields(headers, groupedEntriesForRow(rows, headers, rowIndex));
      }
    }
  }
  throw new Error(`Não encontrei na guia "${sheetName}" uma linha onde ${headerTokens.join(", ")} seja ${acceptedValues.join(", ")}.`);
}

function fieldsFromSheetByDate(odsPath, sheetName, matchDate, headersToFind, allowGenericFallback = true) {
  const rows = readOdsSheet(odsPath, sheetName);
  const headers = rows[0] || [];
  const indices = dateColumnIndices(headers, headersToFind, allowGenericFallback);
  if (!indices.length) throw new Error(`A guia "${sheetName}" não tem uma coluna de data compatível: ${headersToFind.join(", ")}`);
  const wanted = fileDateFromText(matchDate);
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowHasValues(row)) continue;
    for (const index of indices) {
      if (fileDateFromText(getCell(row, index)) === wanted) {
        return rowGroupToFields(headers, groupedEntriesForRow(rows, headers, rowIndex));
      }
    }
  }
  throw new Error(`Não encontrei na guia "${sheetName}" uma linha com data ${matchDate}.`);
}

function firstDataRowFields(odsPath, sheetName) {
  const rows = readOdsSheet(odsPath, sheetName);
  const headers = rows[0] || [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (rowHasValues(row)) return rowGroupToFields(headers, groupedEntriesForRow(rows, headers, rowIndex));
  }
  return {};
}

function createInitialFolder(config, { officeProtocol, prenotation, overwrite = false }) {
  if (!config.initial_folder_root) throw new Error("Configure a pasta raiz inicial.");
  if (!config.base_protocol_template) throw new Error("Configure o arquivo base do protocolo ODS.");
  let office = String(officeProtocol || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!office) throw new Error("Informe o Protocolo Ofício Eletrônico.");
  if (!office.startsWith("IN")) office = `IN${office}`;
  const pren = String(prenotation || "").trim();
  if (!pren) throw new Error("Informe a Prenotação WebRI.");
  const folderName = `${safeFilename(office, "IN")} - ${safeFilename(pren, "prenotacao")}`;
  const target = path.join(config.initial_folder_root, folderName);
  const protocolFile = path.join(target, `Protocolo ${folderName}.ods`);
  for (const folder of ["Entrada", "Não entra no processo", path.join("Primeira Carta de Notificação", "Anexos")]) {
    fs.mkdirSync(path.join(target, folder), { recursive: true });
  }
  if (!fs.existsSync(protocolFile) || overwrite) fs.copyFileSync(config.base_protocol_template, protocolFile);
  return { folder: target, protocolFile };
}

function extractRecords(odsPath, sheetName, nameCol, firstRowHeader = true) {
  const rows = readOdsSheet(odsPath, sheetName);
  const headers = firstRowHeader ? rows[0] || [] : [];
  const dataRows = firstRowHeader ? rows.slice(1) : rows;
  const firstDataIndex = firstRowHeader ? 1 : 0;
  const nameIndex = columnToIndex(nameCol);
  const idIndex = firstRowHeader ? idColumnIndex(headers) : -1;
  const seenGroups = new Set();
  const records = [];
  dataRows.forEach((row, offset) => {
    if (!rowHasValues(row)) return;
    const rowIndex = firstDataIndex + offset;
    const rowNumber = rowIndex + 1;
    const id = idIndex >= 0 ? getCell(row, idIndex) : "";
    const groupKey = id ? `ID:${normalizeKey(id)}` : `ROW:${rowNumber}`;
    if (seenGroups.has(groupKey)) return;
    seenGroups.add(groupKey);
    const entries = id ? groupedEntriesForRow(rows, headers, rowIndex, firstDataIndex) : [{ row, rowNumber }];
    const name = joinWithCommaAnd(entries.map((entry) => getCell(entry.row, nameIndex)));
    if (!name) return;
    const fields = rowGroupToFields(headers, entries, nameIndex);
    addField(fields, "NOME", name);
    addField(fields, "NOME_COMPLETO", name);
    addField(fields, "LINHA", entries[0]?.rowNumber || rowNumber);
    records.push({ displayName: name, rowNumber, fields });
  });
  return records;
}

function findSoffice() {
  const candidates = [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files\\OpenOffice 4\\program\\soffice.exe",
    "C:\\Program Files (x86)\\OpenOffice 4\\program\\soffice.exe"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "soffice";
}

function officePdfFiltersFor(source) {
  const ext = path.extname(source).toLowerCase();
  if ([".odt", ".doc", ".docx", ".rtf"].includes(ext)) return ["pdf:writer_pdf_Export", "pdf"];
  if ([".ods", ".xls", ".xlsx"].includes(ext)) return ["pdf:calc_pdf_Export", "pdf"];
  if ([".odp", ".ppt", ".pptx"].includes(ext)) return ["pdf:impress_pdf_Export", "pdf"];
  return ["pdf"];
}

function officeConversionError(source, outputDir, soffice, attempts) {
  const lines = [`Falha ao converter em PDF: ${source}`, `Pasta de saída: ${outputDir}`, `OpenOffice/LibreOffice: ${soffice}`];
  attempts.forEach((attempt, index) => {
    const status = attempt.status === null || attempt.status === undefined ? "sem código" : attempt.status;
    const signal = attempt.signal ? `, sinal ${attempt.signal}` : "";
    const timedOut = attempt.error && attempt.error.code === "ETIMEDOUT" ? " (tempo excedido)" : "";
    lines.push(`Tentativa ${index + 1} (${attempt.filter}): status ${status}${signal}${timedOut}`);
    if (attempt.error) lines.push(`Erro: ${attempt.error.message}`);
    lines.push(`stdout: ${(attempt.stdout || "").trim() || "sem saída"}`);
    lines.push(`stderr: ${(attempt.stderr || "").trim() || "sem saída"}`);
  });
  lines.push("Dica: feche janelas abertas do OpenOffice/LibreOffice e tente novamente se houver tempo excedido.");
  return lines.join("\n");
}

const UNO_EXPORT_PDF_SCRIPT = `
import sys, time, uno
from com.sun.star.beans import PropertyValue
from com.sun.star.connection import NoConnectException

def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item

source = sys.argv[1]
output = sys.argv[2]
filter_name = sys.argv[3]
port = sys.argv[4]
local_ctx = uno.getComponentContext()
resolver = local_ctx.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local_ctx)
ctx = None
last_error = None
deadline = time.time() + 60
while time.time() < deadline:
    try:
        ctx = resolver.resolve("uno:socket,host=127.0.0.1,port=%s;urp;StarOffice.ComponentContext" % port)
        break
    except NoConnectException as error:
        last_error = error
        time.sleep(0.5)
if ctx is None:
    raise Exception("Nao conectou ao OpenOffice/LibreOffice UNO: %s" % last_error)
desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(source), "_blank", 0, (prop("Hidden", True), prop("ReadOnly", True),))
if document is None:
    raise Exception("OpenOffice/LibreOffice nao abriu o documento")
document.storeToURL(uno.systemPathToFileUrl(output), (prop("FilterName", filter_name),))
try:
    document.close(True)
except Exception:
    document.dispose()
`;

function officeProgramDir(soffice) {
  return fs.existsSync(soffice) ? path.dirname(soffice) : "";
}

function findOfficePython(soffice) {
  const programDir = officeProgramDir(soffice);
  if (!programDir) return "";
  const candidates = [
    path.join(programDir, "python.exe"),
    path.join(programDir, "python-core-2.7.18", "bin", "python.exe")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function officeUnoFilterFor(source) {
  const ext = path.extname(source).toLowerCase();
  if ([".ods", ".xls", ".xlsx"].includes(ext)) return "calc_pdf_Export";
  if ([".odp", ".ppt", ".pptx"].includes(ext)) return "impress_pdf_Export";
  return "writer_pdf_Export";
}

function officeEnv(programDir) {
  const env = { ...process.env };
  if (!programDir) return env;
  env.PATH = `${programDir};${env.PATH || ""}`;
  env.PYTHONPATH = programDir;
  const bootstrap = path.join(programDir, "fundamental.ini");
  if (fs.existsSync(bootstrap)) env.URE_BOOTSTRAP = `vnd.sun.star.pathname:${bootstrap.replace(/\\/g, "/")}`;
  return env;
}

function killProcessTree(pid) {
  if (!pid || process.platform !== "win32") return;
  childProcess.spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", timeout: 10000, windowsHide: true });
}

function killOfficeProcessesForProfile(profile) {
  if (process.platform !== "win32") return;
  const marker = path.basename(profile).replace(/'/g, "''");
  const script = [
    `$marker = '${marker}'`,
    "Get-CimInstance Win32_Process | Where-Object { ($_.Name -like 'soffice*' -or $_.Name -like 'openoffice*') -and $_.CommandLine -like \"*$marker*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  ].join("; ");
  childProcess.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", timeout: 10000, windowsHide: true });
}

function removeOfficeProfile(profile) {
  killOfficeProcessesForProfile(profile);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (_) {
    // A timed-out OpenOffice child can keep a log locked for a moment. It is safe to leave the temp profile behind.
  }
}

function convertFileToPdfWithUno(sourcePath, pdf, soffice, profile) {
  const python = findOfficePython(soffice);
  if (!python) return null;
  const programDir = officeProgramDir(soffice);
  const env = officeEnv(programDir);
  const scriptPath = path.join(profile, "execej_export_pdf.py");
  fs.writeFileSync(scriptPath, UNO_EXPORT_PDF_SCRIPT, "utf8");
  const port = String(24000 + Math.floor(Math.random() * 20000));
  const accept = `socket,host=127.0.0.1,port=${port};urp;StarOffice.ComponentContext`;
  const serverArgs = [
    `-env:UserInstallation=${pathToFileURL(profile).href}`,
    "-headless",
    "-invisible",
    "-nodefault",
    "-nofirststartwizard",
    "-norestore",
    "-nolockcheck",
    `-accept=${accept}`
  ];
  const server = childProcess.spawn(soffice, serverArgs, { env, windowsHide: true, stdio: "ignore" });
  server.on("error", () => {});
  const filter = officeUnoFilterFor(sourcePath);
  let result;
  try {
    result = childProcess.spawnSync(python, [scriptPath, sourcePath, pdf, filter, port], { env, encoding: "utf8", timeout: 120000, windowsHide: true });
  } finally {
    killProcessTree(server.pid);
    killOfficeProcessesForProfile(profile);
  }
  return { filter: `UNO ${filter}`, status: result.status, signal: result.signal, error: result.error, stdout: result.stdout, stderr: result.stderr };
}

function convertFileToPdf(source, outputDir) {
  const sourcePath = path.resolve(source);
  const outputPath = path.resolve(outputDir);
  if (!fs.existsSync(sourcePath)) throw new Error(`Arquivo para conversão não encontrado: ${sourcePath}`);
  fs.mkdirSync(outputPath, { recursive: true });
  const soffice = findSoffice();
  const profile = path.join(os.tmpdir(), `execej_office_${crypto.randomUUID()}`);
  fs.mkdirSync(profile, { recursive: true });
  const pdf = path.join(outputPath, `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`);
  const attempts = [];
  try {
    const unoResult = convertFileToPdfWithUno(sourcePath, pdf, soffice, profile);
    if (unoResult) {
      attempts.push(unoResult);
      if (fs.existsSync(pdf)) return pdf;
      if (unoResult.error && unoResult.error.code === "ETIMEDOUT") throw new Error(officeConversionError(sourcePath, outputPath, soffice, attempts));
    }
    for (const filter of officePdfFiltersFor(sourcePath)) {
      const args = [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--invisible",
        "--nodefault",
        "--nofirststartwizard",
        "--norestore",
        "--nolockcheck",
        "--convert-to",
        filter,
        "--outdir",
        outputPath,
        sourcePath
      ];
      const result = childProcess.spawnSync(soffice, args, { encoding: "utf8", timeout: 120000, windowsHide: true });
      attempts.push({ filter: `convert-to ${filter}`, status: result.status, signal: result.signal, error: result.error, stdout: result.stdout, stderr: result.stderr });
      if (fs.existsSync(pdf)) return pdf;
      if (result.error && result.error.code === "ETIMEDOUT") break;
    }
    throw new Error(officeConversionError(sourcePath, outputPath, soffice, attempts));
  } finally {
    removeOfficeProfile(profile);
  }
}

async function mergePdfs(pdfPaths, outputPath) {
  const merged = await PDFDocument.create();
  for (const pdfPath of pdfPaths) {
    const source = await PDFDocument.load(fs.readFileSync(pdfPath));
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, await merged.save());
}

async function createAutuationPreview(autuacoesMovimentacoes, protocolFolder, outputDir) {
  const pdfsDir = path.resolve(protocolFolder, "Autuação", "PDFs");
  const records = Object.entries(autuacoesMovimentacoes || {})
    .filter(([, record]) => record && Array.isArray(record.files))
    .map(([rowIndex, record], index) => ({
      rowIndex,
      record,
      index,
      timestamp: Date.parse(record.autuadoEm || "")
    }))
    .sort((a, b) => {
      const aTimestamp = Number.isFinite(a.timestamp) ? a.timestamp : Number.MAX_SAFE_INTEGER;
      const bTimestamp = Number.isFinite(b.timestamp) ? b.timestamp : Number.MAX_SAFE_INTEGER;
      return aTimestamp - bTimestamp || a.index - b.index;
    });
  if (!records.length) throw new Error("Ainda não há movimentações autuadas para visualizar.");

  const pdfPaths = [];
  for (const { rowIndex, record } of records) {
    const parts = Array.isArray(record.parts) && record.parts.length
      ? [...record.parts].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      : record.files.map((file) => ({ file }));
    if (!parts.length) throw new Error(`A autuação da movimentação ${rowIndex} não contém PDFs.`);
    for (const part of parts) {
      const filePath = path.resolve(String(part.file || ""));
      if (path.dirname(filePath) !== pdfsDir || path.extname(filePath).toLowerCase() !== ".pdf") {
        throw new Error(`O PDF registrado para a movimentação ${rowIndex} está fora da pasta Autuação\\PDFs.`);
      }
      if (!fs.existsSync(filePath)) {
        throw new Error(`O PDF autuado para a movimentação ${rowIndex} não foi encontrado:\n${filePath}`);
      }
      pdfPaths.push(filePath);
    }
  }

  const outputPath = path.join(outputDir, "visualizacao-autuacoes.pdf");
  await mergePdfs(pdfPaths, outputPath);
  return outputPath;
}

function imageFilenameFromPattern(pattern, officeProtocol, prenotation, bucketStart = "") {
  const rawPrenotation = String(prenotation || "").trim();
  const prenotationDigits = rawPrenotation.replace(/\D/g, "");
  const bucketDigits = String(bucketStart || "").replace(/\D/g, "");
  const office = String(officeProtocol || "").trim().toUpperCase().replace(/\s+/g, "");
  const configuredPattern = String(pattern || "").trim();
  if (!configuredPattern) throw new Error("Informe o padrão do caminho do IMAGE nas configurações.");

  const formattedPattern = configuredPattern.replace(/\{([<>])([A-Za-z0-9])\^(\d{1,3})\}\.\{(PRENOT|FAIXA)\}/g, (_placeholder, side, character, widthText, variable) => {
    const value = variable === "FAIXA" ? bucketDigits : prenotationDigits;
    if (!value) throw new Error(`Não foi possível determinar ${variable === "FAIXA" ? "a faixa da prenotação" : "a prenotação"} para montar o caminho do IMAGE.`);
    const width = Number(widthText);
    if (width < 1 || width > 130) throw new Error("A largura do preenchimento do nome do arquivo deve estar entre 1 e 130.");
    return side === "<"
      ? value.padStart(width, character)
      : value.padEnd(width, character);
  });
  const filename = formattedPattern.replace(/\{([^{}]+)\}/g, (_placeholder, token) => {
    if (token === "IN") {
      if (!office) throw new Error("O protocolo IN não está preenchido para montar o nome do arquivo do IMAGE.");
      return office;
    }
    if (token === "PRENOT") {
      if (!prenotationDigits) throw new Error("A prenotação não está preenchida para montar o nome do arquivo do IMAGE.");
      return prenotationDigits;
    }
    if (token === "FAIXA") {
      if (!bucketDigits) throw new Error("Não foi possível determinar a faixa da prenotação para montar o caminho do IMAGE.");
      return bucketDigits;
    }
    throw new Error(`Variável inválida no padrão do nome do arquivo do IMAGE: {${token}}.`);
  });
  if (/[{}]/.test(filename)) throw new Error("O padrão do nome do arquivo contém chaves sem uma variável válida.");
  const safeName = safeFilename(filename, "");
  if (!safeName) throw new Error("O padrão do nome do arquivo do IMAGE não gerou um nome válido.");
  return safeName;
}

function removePreviousImageExport(previousPath, outputDir, keepPaths = []) {
  const previous = String(previousPath || "").trim();
  if (!previous) return;
  const resolvedPrevious = path.resolve(previous);
  const resolvedOutputDir = path.resolve(outputDir);
  const relativePath = path.relative(resolvedOutputDir, resolvedPrevious);
  const extension = path.extname(resolvedPrevious).toLowerCase();
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath) || ![".tif", ".tiff", ".pdf"].includes(extension)) return;
  if (keepPaths.some((keepPath) => path.resolve(keepPath) === resolvedPrevious)) return;
  fs.rmSync(resolvedPrevious, { force: true });
}

async function exportAutuationImage(
  autuacoesMovimentacoes,
  protocolFolder,
  outputDir,
  format,
  filenamePattern,
  protocolContext = {},
  previousOutputPath = "",
  bucketSize = DEFAULT_CONFIG.image_output_bucket_size,
  folderPattern = DEFAULT_CONFIG.image_output_folder_pattern
) {
  const normalizedFormat = String(format || "").toLowerCase();
  if (!["tiff", "pdf"].includes(normalizedFormat)) {
    throw new Error("Escolha TIFF ou PDF nas configurações de vínculo com o IMAGE.");
  }
  if (!String(outputDir || "").trim()) {
    throw new Error("Escolha a pasta de saída do IMAGE nas configurações.");
  }

  const prenotationDigits = String(protocolContext.prenotation || "").replace(/\D/g, "");
  const prenotationNumber = Number(prenotationDigits);
  const normalizedBucketSize = Number(bucketSize);
  if (!prenotationDigits || !Number.isSafeInteger(prenotationNumber)) {
    throw new Error("Informe uma prenotação numérica válida para criar o caminho do IMAGE.");
  }
  if (!Number.isSafeInteger(normalizedBucketSize) || normalizedBucketSize < 1) {
    throw new Error("O tamanho da faixa de prenotações deve ser um número inteiro positivo.");
  }
  const bucketStart = String(Math.floor(prenotationNumber / normalizedBucketSize) * normalizedBucketSize);
  const officeProtocol = protocolContext.officeProtocol || protocolContext.office_protocol;
  const folderName = imageFilenameFromPattern(folderPattern, officeProtocol, protocolContext.prenotation, bucketStart);
  const fileBaseName = imageFilenameFromPattern(filenamePattern, officeProtocol, protocolContext.prenotation, bucketStart);
  const destinationDir = path.join(outputDir, folderName);
  const extension = normalizedFormat === "tiff" ? "TIF" : "pdf";
  const alternateExtension = normalizedFormat === "tiff" ? "pdf" : "TIF";
  const outputPath = path.join(destinationDir, `${fileBaseName}.${extension}`);
  const alternateOutputPath = path.join(destinationDir, `${fileBaseName}.${alternateExtension}`);
  const records = Object.values(autuacoesMovimentacoes || {}).filter((record) => record && Array.isArray(record.files));
  if (!records.length) {
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(alternateOutputPath, { force: true });
    removePreviousImageExport(previousOutputPath, outputDir);
    return { outputPath: "", removed: true };
  }

  fs.mkdirSync(destinationDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej_image_export_"));
  let stagedOutput = "";
  try {
    const mergedPdf = await createAutuationPreview(autuacoesMovimentacoes, protocolFolder, tempDir);
    stagedOutput = path.join(destinationDir, `.execej-${crypto.randomUUID()}.${extension}`);
    if (normalizedFormat === "pdf") {
      fs.copyFileSync(mergedPdf, stagedOutput);
    } else {
      const ghostscript = findGhostscript();
      if (!ghostscript) {
        throw new Error("Ghostscript não encontrado. Instale o Ghostscript ou escolha PDF nas configurações.");
      }
      const result = childProcess.spawnSync(ghostscript, [
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-dNOPROMPT",
        "-sDEVICE=tiff24nc",
        "-r300",
        "-sCompression=lzw",
        `-sOutputFile=${stagedOutput}`,
        mergedPdf
      ], { encoding: "utf8", timeout: 180000, windowsHide: true });
      if (result.error) throw new Error(`Não foi possível iniciar o Ghostscript: ${result.error.message}`);
      if (result.status !== 0 || !fs.existsSync(stagedOutput) || !fs.statSync(stagedOutput).size) {
        throw new Error(`Ghostscript não conseguiu gerar o TIFF multipágina: ${ghostscriptMessage(result) || `status ${result.status ?? "sem código"}`}`);
      }
    }
    fs.renameSync(stagedOutput, outputPath);
    fs.rmSync(alternateOutputPath, { force: true });
    removePreviousImageExport(previousOutputPath, outputDir, [outputPath]);
    return { outputPath, removed: false };
  } finally {
    if (stagedOutput) fs.rmSync(stagedOutput, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function addNoteFields(fields, texts) {
  addField(fields, "MATRICULA", texts.matricula);
  addField(fields, "MATRÍCULA", texts.matricula);
  addField(fields, "CABECALHO", texts.header);
  addField(fields, "CABEÇALHO", texts.header);
  addField(fields, "ITENS", texts.items || "");
  let index = 1;
  while (texts[`item_${index}`]) {
    addField(fields, `ITEM_${index}`, texts[`item_${index}`]);
    addField(fields, `ITEM ${index}`, texts[`item_${index}`]);
    addField(fields, `EXIGENCIA_${index}`, texts[`item_${index}_body`] || stripNoteItemNumber(texts[`item_${index}`]));
    index += 1;
  }
  const fallback = texts.item_3_body || texts.items || "";
  addField(fields, "EXIGENCIAS", fallback);
  addField(fields, "TEXTO_EXIGENCIA", fallback);
  addField(fields, "TEXTO_COMPLETO", texts.full_text);
}

function nextNoteNumber(outputDir) {
  if (!fs.existsSync(outputDir)) return 1;
  let highest = 0;
  for (const name of fs.readdirSync(outputDir)) {
    const match = normalizeKey(path.basename(name, path.extname(name))).match(/^NOTA_DE_EXIGENCIA_(\d+)(?:_|$)/);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

function generateNote(config, data) {
  const odsPath = data.odsPath;
  const texts = data.mode === "blank"
    ? noteTextsFromItems(data.matricula, data.items || [])
    : buildNoteRequirementTexts(data.matricula, data);
  if (data.mode !== "blank" && data.item3Body) {
    const body = stripNoteItemNumber(data.item3Body);
    texts.item_3_body = body;
    texts.item_3 = `3. ${body}`;
    texts.items = [texts.item_1, texts.item_2, texts.item_3].join("\n\n");
    texts.full_text = [texts.header, texts.items].join("\n\n");
  }
  const model = data.modelPath || config.note_requirement_model || findModelFile(config.models_folder, "Nota de Exigência");
  if (!model || !fs.existsSync(model)) throw new Error(`Modelo da Nota de Exigência não encontrado: ${model}`);
  const baseDir = data.protocolFolder || (odsPath ? path.dirname(odsPath) : "");
  const outputDir = data.outputDir || (baseDir ? path.join(baseDir, "Nota de Exigência") : "");
  if (!outputDir) throw new Error("Informe a pasta de saída da Nota de Exigência.");
  fs.mkdirSync(outputDir, { recursive: true });
  const formattedDate = formatDateForDocument(data.dateValue);
  const fileDate = fileDateFromText(formattedDate);
  const context = protocolContextFromValues(data, odsPath);
  const fields = {};
  addNoteFields(fields, texts);
  addField(fields, "DATA", formattedDate);
  addField(fields, "DATA_NOTA", formattedDate);
  addGenerationDateFields(fields);
  addProtocolFields(fields, context);
  addSignatureFields(fields, config, data);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej_note_"));
  const odt = path.join(tempDir, "nota_exigencia.odt");
  mergeOdtDocument(model, odt, fields);
  let pdf;
  try {
    pdf = convertFileToPdf(odt, tempDir);
  } catch (error) {
    throw new Error(`Falha ao converter Nota de Exigência: ${error.message}`);
  }
  const output = path.join(outputDir, `Nota de Exigência ${nextNoteNumber(outputDir)} - ${fileDate} - ${safeFilename(context.label)}.pdf`);
  fs.copyFileSync(pdf, output);
  return { output };
}

function jpegExifOrientation(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xda || marker === 0xd9) return 1;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return 1;
    const length = bytes.readUInt16BE(offset);
    offset += 2;
    const segmentStart = offset;
    const segmentEnd = segmentStart + length - 2;
    if (segmentEnd > bytes.length || length < 2) return 1;
    if (
      marker === 0xe1
      && segmentEnd - segmentStart >= 14
      && bytes.toString("ascii", segmentStart, segmentStart + 6) === "Exif\0\0"
    ) {
      const tiff = segmentStart + 6;
      const littleEndian = bytes.toString("ascii", tiff, tiff + 2) === "II";
      const bigEndian = bytes.toString("ascii", tiff, tiff + 2) === "MM";
      if (!littleEndian && !bigEndian) return 1;
      const read16 = (pos) => (littleEndian ? bytes.readUInt16LE(pos) : bytes.readUInt16BE(pos));
      const read32 = (pos) => (littleEndian ? bytes.readUInt32LE(pos) : bytes.readUInt32BE(pos));
      if (read16(tiff + 2) !== 42) return 1;
      const ifd0 = tiff + read32(tiff + 4);
      if (ifd0 + 2 > segmentEnd) return 1;
      const entries = read16(ifd0);
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd0 + 2 + index * 12;
        if (entry + 12 > segmentEnd) break;
        const tag = read16(entry);
        if (tag !== 0x0112) continue;
        const type = read16(entry + 2);
        const count = read32(entry + 4);
        if (type !== 3 || count < 1) return 1;
        return read16(entry + 8);
      }
      return 1;
    }
    offset = segmentEnd;
  }
  return 1;
}

function imageDrawPlan(image, orientation) {
  const size = typeof image.size === "function" ? image.size() : image;
  const width = Number(size.width);
  const height = Number(size.height);
  if (orientation === 3) {
    return { page: [width, height], draw: { x: width, y: height, width, height, rotate: degrees(180) } };
  }
  if (orientation === 6) {
    return { page: [height, width], draw: { x: height, y: 0, width, height, rotate: degrees(90) } };
  }
  if (orientation === 8) {
    return { page: [height, width], draw: { x: 0, y: width, width, height, rotate: degrees(270) } };
  }
  return { page: [width, height], draw: { x: 0, y: 0, width, height } };
}

async function imageToPdf(source, outputDir) {
  const ext = path.extname(source).toLowerCase();
  const bytes = fs.readFileSync(source);
  const imageBytes = new Uint8Array(bytes);
  const pdf = await PDFDocument.create();
  let image;
  if ([".jpg", ".jpeg"].includes(ext)) image = await pdf.embedJpg(imageBytes);
  else if (ext === ".png") image = await pdf.embedPng(imageBytes);
  else return convertFileToPdf(source, outputDir);
  const orientation = [".jpg", ".jpeg"].includes(ext) ? jpegExifOrientation(bytes) : 1;
  const plan = imageDrawPlan(image, orientation);
  const page = pdf.addPage([Number(plan.page[0]), Number(plan.page[1])]);
  page.drawImage(image, plan.draw);
  const output = path.join(outputDir, `${path.basename(source, ext)}.pdf`);
  fs.writeFileSync(output, await pdf.save());
  return output;
}

async function convertSourceToPdf(source, outputDir) {
  const ext = path.extname(source).toLowerCase();
  if (ext === ".pdf") return source;
  if ([".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"].includes(ext)) return imageToPdf(source, outputDir);
  return convertFileToPdf(source, outputDir);
}

async function convertAnyFileToPdfA(data, onProgress) {
  if (!String(data.sourcePath || "").trim()) throw new Error("Selecione um arquivo válido para converter em PDF/A.");
  const source = path.resolve(data.sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("Selecione um arquivo válido para converter em PDF/A.");
  const gs = findGhostscript();
  if (!gs) throw new Error("Ghostscript não encontrado. Instale o Ghostscript para usar a aba PDF/A.");
  const outputDir = path.resolve(data.outputDir || path.dirname(source));
  fs.mkdirSync(outputDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej_pdfa_"));
  try {
    onProgress?.("Preparando arquivo...");
    let sourcePdf;
    try {
      sourcePdf = await convertSourceToPdf(source, tempDir);
    } catch (error) {
      throw new Error(`Falha ao preparar o arquivo como PDF: ${error.message}`);
    }
    const output = uniquePath(path.join(outputDir, `${safeFilename(path.basename(source, path.extname(source)))} - PDF-A.pdf`));
    onProgress?.("Convertendo para PDF/A com Ghostscript...");
    const result = await convertPdfToPdfAIfPossible(sourcePdf, output);
    if (!result.pdfa) {
      throw new Error(result.warning || "O Ghostscript não conseguiu gerar um PDF/A visualizável.");
    }
    onProgress?.(`PDF/A criado: ${output}`);
    return { output, ...result };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function fixedDocumentRows(rows) {
  const result = [];
  const { entries } = movementRowsFromSheetRows(rows);
  for (const [entryIndex, { row, movement, movementIndex, layout }] of entries.entries()) {
    const documentName = getCell(row, layout.document);
    if (!documentName) continue;
    if (["MOVIMENTACAO", "PROTOCOLO"].includes(normalizeKey(movement))) continue;
    if (normalizeKey(documentName) === "NOME_ARQUIVO") continue;
    result.push([movementIndex, row, layout, entryIndex, entries]);
  }
  return result;
}

function copyFieldSet(target, source) {
  Object.assign(target, source || {});
}

function fixedDocumentOutputOrder(movementName, documentName) {
  if (isCompatibilityMovement(movementName) && isAnyExtractionCertificateDocument(documentName)) {
    return 2_000_000_000;
  }
  return 0;
}

async function generateFixedPdfs({ config, odsPath, slots, fixedRows, context, protocolFolder, pdfsDir, outputDir = pdfsDir, tempDir, onProgress, signatureData }) {
  const generated = [];
  let extractionPrenotationFields = null;
  let consolidationFields = null;
  const extractionByDate = new Map();
  const intimationByDate = new Map();
  for (const [movementIndex, row, layout, entryIndex, movementEntries] of fixedRows) {
    const movementName = getCell(row, layout?.movement ?? 1);
    const documentName = getCell(row, layout?.document ?? 6);
    onProgress?.(`Convertendo documento fixo: ${documentName}`);
    const [fileDate] = movementDateValues(row, layout);
    const source = fixedDocumentSource(config, documentName, protocolFolder, pdfsDir);
    const fields = {};
    const movementNormalDate = getCell(row, layout?.date ?? 2);
    if (isAutuacaoDocument(documentName)) {
      if (!extractionPrenotationFields) {
        extractionPrenotationFields = fieldsFromSheetByColumnValue(odsPath, "Extração de Arquivos", ["PRENOTAÇÃO?", "PRENOTACAO?"], ["SIM"]);
      }
      copyFieldSet(fields, extractionPrenotationFields);
    }
    if (isRequerimentoCertificate(documentName)) {
      const key = fileDateFromText(movementNormalDate);
      if (!extractionByDate.has(key)) {
        extractionByDate.set(key, fieldsFromSheetByDate(odsPath, "Extração de Arquivos", movementNormalDate, ["DATA EXTRAÇÃO", "DATA EXTRACAO"]));
      }
      copyFieldSet(fields, extractionByDate.get(key));
    }
    if (isExtractionCertificateDocument(documentName)) {
      const key = fileDateFromText(movementNormalDate);
      if (!extractionByDate.has(key)) {
        extractionByDate.set(key, fieldsFromSheetByDate(odsPath, "Extração de Arquivos", movementNormalDate, ["DATA EXTRAÇÃO", "DATA EXTRACAO"]));
      }
      copyFieldSet(fields, extractionByDate.get(key));
    }
    if (isConsolidationAverbacaoCertificate(documentName)) {
      if (!consolidationFields) consolidationFields = firstDataRowFields(odsPath, "Consolidação");
      copyFieldSet(fields, consolidationFields);
    }
    if (isRtdPositiveCertificate(documentName)) {
      const key = `positiva:${fileDateFromText(movementNormalDate)}`;
      if (!intimationByDate.has(key)) {
        intimationByDate.set(key, fieldsFromIntimationByDate(odsPath, movementNormalDate, "Positiva"));
      }
      copyFieldSet(fields, intimationByDate.get(key));
    }
    if (isRtdNegativeCertificate(documentName)) {
      const key = `negativa:${fileDateFromText(movementNormalDate)}`;
      if (!intimationByDate.has(key)) {
        intimationByDate.set(key, fieldsFromIntimationByDate(odsPath, movementNormalDate, "Negativa"));
      }
      copyFieldSet(fields, intimationByDate.get(key));
    }
    let convertedPdf;
    let requiresSignature = false;
    try {
      if (source.type === "model") {
        requiresSignature = modelHasSignatureFields(source.path);
        addMovementFields(fields, row, context, layout);
        addSignatureFields(fields, config, signatureData);
        const tempOdt = path.join(tempDir, `fixo_${String(movementIndex).padStart(3, "0")}_${safeFilename(documentName)}.odt`);
        mergeOdtDocument(source.path, tempOdt, fields);
        convertedPdf = convertFileToPdf(tempOdt, tempDir);
      } else {
        convertedPdf = await convertSourceToPdf(source.path, tempDir);
      }
    } catch (error) {
      throw new Error(`Falha ao converter documento fixo "${documentName}": ${error.message}`);
    }
    const outputPdf = uniquePath(path.join(outputDir, `${safeFilename(movementName)} - ${fileDate} - ${safeFilename(context.label)}.pdf`));
    fs.copyFileSync(convertedPdf, outputPdf);
    const outputRowIndex = movementIndex;
    const outputOrder = fixedDocumentOutputOrder(movementName, documentName);
    generated.push([outputRowIndex, outputOrder, outputPdf, requiresSignature]);
  }
  return generated;
}

async function copyAttachmentPdfs({ slots, context, pdfsDir, tempDir, onProgress }) {
  const copied = [];
  for (let slotPosition = 0; slotPosition < slots.length; slotPosition += 1) {
    const slot = slots[slotPosition];
    const slotName = String(slot.title || "").replace(/\s+\([^)]*\)$/, "").trim() || slot.title;
    const fileDate = slot.file_date || fileDateFromText(slot.movement_date);
    for (let fileIndex = 0; fileIndex < slot.files.length; fileIndex += 1) {
      const source = slot.files[fileIndex];
      onProgress?.(`Convertendo anexo: ${path.basename(source)}`);
      let convertedPdf;
      try {
        convertedPdf = await convertSourceToPdf(source, tempDir);
      } catch (error) {
        throw new Error(`Falha ao converter anexo "${source}": ${error.message}`);
      }
      const outputPdf = uniquePath(path.join(pdfsDir, `${safeFilename(slotName)} - ${fileDate} - ${safeFilename(context.label)}.pdf`));
      fs.copyFileSync(convertedPdf, outputPdf);
      if (slot.fixed_position === "bookend") {
        copied.push([Number.MIN_SAFE_INTEGER, 0, outputPdf]);
        copied.push([Number.MAX_SAFE_INTEGER, 0, outputPdf]);
      } else {
        copied.push([slot.row_index, 1000 + slotPosition * 100 + fileIndex + 1, outputPdf]);
      }
    }
  }
  return copied;
}

function findGhostscript() {
  const roots = ["C:\\Program Files\\gs", "C:\\Program Files (x86)\\gs"];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root).sort().reverse()) {
      const candidate = path.join(root, version, "bin", "gswin64c.exe");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const PDF_A_CANDIDATES = [
  { version: 2, label: "PDF/A-2b" },
  { version: 3, label: "PDF/A-3b" }
];

function pdfFileHasHeader(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size < 8) return false;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("ascii").startsWith("%PDF");
  } finally {
    fs.closeSync(fd);
  }
}

async function pdfFileIsViewable(filePath, gs) {
  if (!pdfFileHasHeader(filePath)) return { ok: false, reason: "arquivo ausente, vazio ou sem cabeçalho PDF" };
  try {
    const document = await PDFDocument.load(fs.readFileSync(filePath), { ignoreEncryption: true });
    if (document.getPageCount() < 1) return { ok: false, reason: "PDF sem páginas" };
  } catch (error) {
    return { ok: false, reason: `pdf-lib não conseguiu abrir: ${error.message}` };
  }
  if (gs) {
    const result = childProcess.spawnSync(gs, ["-dBATCH", "-dNOPAUSE", "-sDEVICE=nullpage", filePath], { encoding: "utf8", timeout: 120000, windowsHide: true });
    if (result.status !== 0) return { ok: false, reason: `Ghostscript não conseguiu renderizar: ${ghostscriptMessage(result) || `status ${result.status ?? "sem código"}`}` };
  }
  return { ok: true, reason: "" };
}

function ghostscriptMessage(result) {
  return [result.stderr, result.stdout, result.error?.message].filter(Boolean).join("\n").trim();
}

function plural(count, singular, pluralText) {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function summarizeGhostscriptMessage(message) {
  const lines = String(message || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  const unmatched = new Set();
  let nonPrintingAnnotations = 0;
  let interpolateImages = 0;
  let clampedCoordinates = 0;
  let repairedErrors = false;
  for (const line of lines) {
    if (/Annotation set to non-printing/i.test(line)) {
      nonPrintingAnnotations += 1;
    } else if (/PDFA doesn't allow images with Interpolate true/i.test(line)) {
      interpolateImages += 1;
    } else if (/clamping to valid range/i.test(line)) {
      clampedCoordinates += 1;
    } else if (/errors were encountered|errors that were repaired or ignored|does not conform to Adobe/i.test(line)) {
      repairedErrors = true;
    } else if (!/^(\*+|GPL Ghostscript|The file was produced by:|>>>>|Please notify the author)/i.test(line)) {
      unmatched.add(line);
    }
  }
  const summary = [];
  if (nonPrintingAnnotations) summary.push(`removeu ${plural(nonPrintingAnnotations, "anotação não imprimível", "anotações não imprimíveis")} que não são permitidas em PDF/A`);
  if (interpolateImages) summary.push(`ajustou ${plural(interpolateImages, "imagem com Interpolate=true", "imagens com Interpolate=true")}, recurso não permitido em PDF/A`);
  if (clampedCoordinates) summary.push(`corrigiu ${plural(clampedCoordinates, "coordenada fora do limite", "coordenadas fora do limite")}`);
  if (repairedErrors) summary.push("reparou ou ignorou erros internos do PDF de origem");
  if (unmatched.size) summary.push(`registrou ${plural(unmatched.size, "outro aviso", "outros avisos")} durante a conversão`);
  return summary.length ? summary.map((item) => `- ${item}`).join("\n") : `- ${plural(lines.length, "aviso do Ghostscript", "avisos do Ghostscript")} durante a conversão`;
}

function pdfALogPath(output) {
  const parsed = path.parse(output);
  return path.join(parsed.dir, `${parsed.name} - log PDF-A.txt`);
}

function writePdfALog(output, selectedLabel, attempts) {
  if (!attempts.length) return "";
  const logPath = pdfALogPath(output);
  const content = [
    `Gerado em: ${new Date().toISOString()}`,
    `PDF/A final escolhido: ${selectedLabel || "nenhum"}`,
    "",
    "Candidatos e mensagens:",
    "",
    attempts.join("\n\n")
  ].join("\n");
  fs.writeFileSync(logPath, content, "utf8");
  return logPath;
}

function ghostscriptPdfAArgs(source, output, version) {
  return [
    `-dPDFA=${version}`,
    "-dBATCH",
    "-dNOPAUSE",
    "-dNOOUTERSAVE",
    "-dAutoRotatePages=/None",
    "-sDEVICE=pdfwrite",
    "-dPDFACompatibilityPolicy=1",
    `-sOutputFile=${output}`,
    source
  ];
}

function pdfACandidatePath(output, label) {
  const parsed = path.parse(output);
  return path.join(parsed.dir, `${parsed.name} - ${label.replace("/", "-")}${parsed.ext}`);
}

function removeGeneratedPdfACandidates(generated) {
  for (const candidate of generated) {
    fs.rmSync(candidate, { force: true });
  }
}

async function stripPdfAnnotationsForPdfA(source) {
  const output = path.join(path.dirname(source), `sem_anotacoes_${crypto.randomUUID()}.pdf`);
  try {
    const pdf = await PDFDocument.load(fs.readFileSync(source), { ignoreEncryption: true });
    let removed = 0;
    for (const page of pdf.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (annots) removed += annots.size();
      page.node.delete(PDFName.of("Annots"));
    }
    if (!removed) return { source, temp: "", removed: 0, warning: "" };
    fs.writeFileSync(output, await pdf.save());
    return { source: output, temp: output, removed, warning: "" };
  } catch (error) {
    return { source, temp: "", removed: 0, warning: `Pré-processamento: não foi possível remover anotações do PDF antes do PDF/A (${error.message}).` };
  }
}

async function convertPdfToPdfAIfPossible(source, output) {
  fs.rmSync(pdfALogPath(output), { force: true });
  const gs = findGhostscript();
  if (!gs) {
    fs.copyFileSync(source, output);
    return { pdfa: false, warning: "Ghostscript não encontrado. O PDF final foi gerado sem normalização PDF/A." };
  }
  const sanitized = await stripPdfAnnotationsForPdfA(source);
  const sourceForPdfA = sanitized.source;
  const attempts = [];
  if (sanitized.removed) attempts.push(`Pré-processamento: removidas ${plural(sanitized.removed, "anotação de PDF", "anotações de PDF")} antes da conversão PDF/A.`);
  if (sanitized.warning) attempts.push(sanitized.warning);
  const generated = [];
  const viewable = [];
  for (const candidate of PDF_A_CANDIDATES) {
    const { version, label } = candidate;
    const candidateOutput = pdfACandidatePath(output, label);
    const tempOutput = path.join(path.dirname(output), `pdfa_${version}_${crypto.randomUUID()}.pdf`);
    const result = childProcess.spawnSync(gs, ghostscriptPdfAArgs(sourceForPdfA, tempOutput, version), { encoding: "utf8", timeout: 180000, windowsHide: true });
    const message = ghostscriptMessage(result);
    let validation = { ok: false, reason: "Ghostscript não gerou arquivo PDF" };
    if (pdfFileHasHeader(tempOutput)) {
      fs.copyFileSync(tempOutput, candidateOutput);
      generated.push(candidateOutput);
      validation = await pdfFileIsViewable(candidateOutput, gs);
      if (validation.ok) viewable.push({ ...candidate, output: candidateOutput, message });
    }
    attempts.push(`${label}: ${validation.ok ? "visualizável" : `não visualizável (${validation.reason})`}${message ? `\n${message}` : ""}`);
    fs.rmSync(tempOutput, { force: true });
  }
  const chosen = viewable[0];
  if (chosen) {
    fs.copyFileSync(chosen.output, output);
    removeGeneratedPdfACandidates(generated);
    fs.rmSync(pdfALogPath(output), { force: true });
    if (sanitized.temp) fs.rmSync(sanitized.temp, { force: true });
    const summary = summarizeGhostscriptMessage(chosen.message);
    const warningParts = [];
    if (chosen.label !== "PDF/A-2b") {
      warningParts.push(`O app gerou candidatos em PDF/A-2b e PDF/A-3b e manteve como final o mais rígido visualizável: ${chosen.label}.`);
    }
    if (summary) warningParts.push(`O Ghostscript fez ajustes no PDF escolhido:\n${summary}`);
    return { pdfa: true, warning: warningParts.join("\n\n"), candidates: [], selectedPdfA: chosen.label, pdfaLog: "" };
  }
  fs.copyFileSync(sourceForPdfA, output);
  removeGeneratedPdfACandidates(generated);
  if (sanitized.temp) fs.rmSync(sanitized.temp, { force: true });
  const logPath = writePdfALog(output, "", attempts);
  return {
    pdfa: false,
    candidates: [],
    pdfaLog: logPath,
    warning: `Nenhum candidato PDF/A ficou visualizável. O PDF final foi gerado como PDF comum.${logPath ? `\n\nLog completo: ${logPath}` : ""}`
  };
}

async function generateFinalPdf(config, data, onProgress) {
  const odsPath = data.odsPath;
  const sheetName = data.sheetName || config.movements_sheet;
  const slots = data.slots || [];
  if (!slots.length) throw new Error("Leia as movimentações antes de juntar o PDF.");
  const missing = slots.filter((slot) => !slot.optional && (!slot.files || !slot.files.length)).map((slot) => slot.title);
  if (missing.length) throw new Error(`Ainda há colunas sem anexo:\n\n${missing.slice(0, 12).join("\n")}`);
  const rows = readOdsSheet(odsPath, sheetName);
  const context = protocolContextFromValues(data, odsPath);
  const protocolFolder = data.protocolFolder || path.dirname(odsPath);
  const autuacaoDir = path.join(protocolFolder, "Autuação");
  const pdfsDir = path.join(autuacaoDir, "PDFs");
  const fixedRows = fixedDocumentRows(rows);
  const orderedParts = [];
  const autuacoesMovimentacoes = data.autuacoesMovimentacoes || {};
  const movimentacoesNaoAutuadas = fixedRows.filter(([, , , entryIndex, entries]) => {
    const sourceRowIndex = entries[entryIndex]?.sourceRow;
    return !autuacoesMovimentacoes[String(sourceRowIndex)];
  });
  if (movimentacoesNaoAutuadas.length) {
    const movementNames = movimentacoesNaoAutuadas.map(([, row, layout]) => getCell(row, layout.movement));
    throw new Error(`Autue cada movimentação antes de gerar o PDF final:\n\n${movementNames.slice(0, 12).join("\n")}`);
  }
  for (const [movementIndex, row, layout, entryIndex, entries] of fixedRows) {
    const movement = entries[entryIndex];
    const autuation = autuacoesMovimentacoes[String(movement.sourceRow)];
    if (!autuation.files.length) {
      throw new Error(`Os PDFs da movimentação "${movement.movement}" não foram encontrados no registro de autuação.`);
    }
    const parts = Array.isArray(autuation.parts) && autuation.parts.length
      ? autuation.parts
      : autuation.files.map((file) => ({
        file,
        order: fixedDocumentOutputOrder(getCell(row, layout.movement), getCell(row, layout.document))
      }));
    for (const part of parts) {
      const file = part.file;
      const filePath = path.resolve(String(file || ""));
      if (path.dirname(filePath) !== path.resolve(pdfsDir) || path.extname(filePath).toLowerCase() !== ".pdf") {
        throw new Error(`O PDF registrado para a movimentação "${movement.movement}" está fora da pasta Autuação\\PDFs.`);
      }
      if (!fs.existsSync(filePath)) {
        throw new Error(`O PDF autuado para a movimentação "${movement.movement}" não foi encontrado:\n${filePath}`);
      }
      orderedParts.push([movementIndex, Number(part.order) || 0, filePath]);
    }
  }
  fs.mkdirSync(pdfsDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej_pdf_"));
  const movementEntries = movementRowsFromSheetRows(rows).entries;
  const autuatedRowsWithAttachments = new Set(Object.entries(autuacoesMovimentacoes)
    .filter(([rowIndex, autuation]) => autuation.hasAttachments && movementEntries.some((entry) => entry.sourceRow === Number(rowIndex)))
    .map(([rowIndex]) => movementEntries.find((entry) => entry.sourceRow === Number(rowIndex)).movementIndex));
  const pendingAttachmentSlots = slots.filter((slot) => slot.row_index < 0 || !autuatedRowsWithAttachments.has(Number(slot.row_index)));
  orderedParts.push(...await copyAttachmentPdfs({ slots: pendingAttachmentSlots, context, pdfsDir, tempDir, onProgress }));
  orderedParts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || String(a[2]).localeCompare(String(b[2])));
  const pdfParts = orderedParts.map((item) => item[2]);
  if (!pdfParts.length) throw new Error("Nenhum PDF foi preparado para geração final.");
  const merged = path.join(tempDir, "procedimento_mesclado.pdf");
  onProgress?.("Juntando PDFs em um único arquivo...");
  await mergePdfs(pdfParts, merged);
  const output = path.join(autuacaoDir, `${safeFilename(context.label)}.pdf`);
  onProgress?.("Normalizando PDF final...");
  const pdfa = await convertPdfToPdfAIfPossible(merged, output);
  return { output, pdfsDir, ...pdfa };
}

async function autuarMovimentacao(config, data, onProgress) {
  const odsPath = data.odsPath;
  const sheetName = data.sheetName || config.movements_sheet;
  const sourceRowIndex = Number(data.sourceRowIndex);
  if (!Number.isInteger(sourceRowIndex) || sourceRowIndex < 0) throw new Error("Selecione uma movimentação válida para autuar.");
  const protocolFolder = String(data.protocolFolder || "").trim();
  if (!protocolFolder) throw new Error("A pasta do protocolo não está definida.");
  const rows = readOdsSheet(odsPath, sheetName);
  const { entries } = movementRowsFromSheetRows(rows);
  const entryIndex = entries.findIndex((entry) => entry.sourceRow === sourceRowIndex);
  if (entryIndex < 0) throw new Error("A movimentação selecionada não foi encontrada na guia.");
  const entry = entries[entryIndex];
  const previousMovements = entries.slice(0, entryIndex).map((item) => item.movement);
  const requirements = movementAttachmentRequirements(odsPath, sheetName, sourceRowIndex, config);
  const suppliedAttachments = Array.isArray(data.attachments) ? data.attachments : [];
  const attachmentSlots = requirements.map((requirement) => {
    const supplied = suppliedAttachments.find((item) => item.title === requirement.title);
    const files = Array.isArray(supplied?.files) ? supplied.files.map((file) => String(file || "").trim()).filter(Boolean) : [];
    if (!files.length) throw new Error(`Anexe pelo menos um arquivo em "${requirement.title}" antes de autuar.`);
    if (requirement.single_file && files.length > 1) throw new Error(`"${requirement.title}" aceita somente um arquivo.`);
    return { ...requirement, files };
  });
  if (suppliedAttachments.some((item) => !requirements.some((requirement) => requirement.title === item.title))) {
    throw new Error("Há anexos informados para uma movimentação diferente.");
  }
  const documentName = getCell(entry.row, entry.layout.document)
    || movementDocumentName(entry.movement, previousMovements, config);
  if (!documentName) throw new Error(`Não há documento configurado para a movimentação "${entry.movement}".`);
  const autuationRow = [...entry.row];
  ensureRowLength(autuationRow, entry.layout.document);
  autuationRow[entry.layout.document] = documentName;
  const fixedRow = [
    entry.movementIndex,
    autuationRow,
    entry.layout,
    entryIndex,
    entries
  ];
  const protocolContext = protocolContextFromValues(data, odsPath);
  const autuacaoDir = path.join(protocolFolder, "Autuação");
  const pdfsDir = path.join(autuacaoDir, "PDFs");
  fs.mkdirSync(pdfsDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej_autuacao_"));
  try {
    const generatedFixed = await generateFixedPdfs({
      config,
      odsPath,
      slots: [],
      fixedRows: [fixedRow],
      context: protocolContext,
      protocolFolder,
      pdfsDir,
      outputDir: tempDir,
      tempDir,
      onProgress
    });
    const generatedAttachments = await copyAttachmentPdfs({
      slots: attachmentSlots.map((slot) => ({
        ...slot,
        fixed_position: "",
        optional: false
      })),
      context: protocolContext,
      pdfsDir: tempDir,
      tempDir,
      onProgress
    });
    const generated = [...generatedFixed, ...generatedAttachments];
    if (!generated.length) throw new Error(`Nenhum documento foi gerado para a movimentação "${entry.movement}".`);
    const persisted = [];
    try {
      for (const [movementOrder, order, stagedFile, requiresSignature] of generated) {
        const file = uniquePath(path.join(pdfsDir, path.basename(stagedFile)));
        fs.copyFileSync(stagedFile, file);
        persisted.push([movementOrder, order, file, requiresSignature]);
        fs.unlinkSync(stagedFile);
      }
    } catch (error) {
      for (const [, , file] of persisted) fs.rmSync(file, { force: true });
      throw error;
    }
    return {
      files: persisted.map(([, , filePath]) => filePath),
      signatureFiles: persisted
        .filter(([, , , requiresSignature]) => requiresSignature)
        .map(([, , filePath]) => filePath),
      parts: persisted.map(([, order, filePath]) => ({ file: filePath, order })),
      hasAttachments: attachmentSlots.length > 0,
      movement: entry.movement,
      documentName
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function estornarAutuacaoFiles(protocolFolder, files) {
  const pdfsDir = path.resolve(protocolFolder, "Autuação", "PDFs");
  const removed = [];
  for (const file of Array.isArray(files) ? files : []) {
    const filePath = path.resolve(String(file || ""));
    if (path.dirname(filePath) !== pdfsDir || path.extname(filePath).toLowerCase() !== ".pdf") {
      throw new Error("O estorno só pode remover PDFs registrados dentro da pasta Autuação\\PDFs.");
    }
    if (!fs.existsSync(filePath)) continue;
    fs.unlinkSync(filePath);
    removed.push(filePath);
  }
  return removed;
}

function statsMonthName(month) {
  const name = MONTHS_PT[month] || "";
  return name ? `${name[0].toUpperCase()}${name.slice(1)}` : String(month);
}

function validateArispStatsPeriod(month, year) {
  const numericMonth = Number(month);
  const numericYear = Number(year);
  if (!Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) throw new Error("Selecione um mês válido.");
  if (!Number.isInteger(numericYear) || numericYear < 2026) throw new Error("Informe um ano válido.");
  if (numericYear < 2026 || (numericYear === 2026 && numericMonth < 6)) {
    throw new Error("A data mínima das estatísticas é junho de 2026.");
  }
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (numericYear > currentYear || (numericYear === currentYear && numericMonth > currentMonth)) {
    throw new Error("O mês selecionado é posterior à data atual.");
  }
  return { month: numericMonth, year: numericYear };
}

function protocolContextIsReal(context) {
  return context.office_protocol !== "INXXXXX" && context.prenotation !== "XX.XXX";
}

function walkFiles(root, onFile) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    try {
      if (entry.isDirectory()) {
        walkFiles(fullPath, onFile);
      } else if (entry.isFile()) {
        onFile(fullPath);
      }
    } catch {
      // Pastas de rede podem negar acesso a subpastas; segue com as demais.
    }
  }
}

function findProtocolOdsFiles(searchRoot) {
  const byLabel = new Map();
  walkFiles(searchRoot, (filePath) => {
    if (path.extname(filePath).toLowerCase() !== ".ods") return;
    const context = protocolContextFromPath(filePath);
    if (!protocolContextIsReal(context)) return;
    const base = normalizeKey(path.basename(filePath, ".ods"));
    if (!base.includes("PROTOCOLO") && !base.includes(context.office_protocol)) return;
    const current = byLabel.get(context.label);
    if (!current || filePath.length < current.length) byLabel.set(context.label, filePath);
  });
  return [...byLabel.values()].sort((a, b) => a.localeCompare(b));
}

function protocolContextFromText(text) {
  const content = String(text || "");
  const office = content.match(/\bIN[0-9][A-Z0-9.-]{5,}\b/i)?.[0]?.replace(/[^\w.-]/g, "").toUpperCase() || "";
  const prenotationPatterns = [
    /prenota(?:ç|c)[aã]o(?:\s+webri)?[\s\S]{0,80}?(\d{2}\.?\d{3}|\d{5})/i,
    /protocolo\s*(?:n[ºo.]*)?[\s\S]{0,40}?(\d{2}\.?\d{3}|\d{5})/i
  ];
  let prenotation = "";
  for (const pattern of prenotationPatterns) {
    const found = content.match(pattern)?.[1];
    if (found) {
      prenotation = formatPrenotation(found);
      break;
    }
  }
  if (office && prenotation) return { office_protocol: office, prenotation, label: `Protocolo ${office} - ${prenotation}` };
  return null;
}

function contextKey(context) {
  return `${context.office_protocol}|${String(context.prenotation || "").replace(/\D/g, "")}`;
}

function protocolContextFromFolder(folder) {
  return protocolContextFromPath(path.join(folder, "dummy.ods"));
}

function walkDirectories(root, onDirectory) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    try {
      onDirectory(fullPath);
      walkDirectories(fullPath, onDirectory);
    } catch {
      // segue com as demais pastas
    }
  }
}

function statsSupportedDocument(filePath) {
  return [".pdf", ".odt", ".docx", ".txt"].includes(path.extname(filePath).toLowerCase());
}

function folderHasStatsDocuments(folder) {
  let found = false;
  walkFiles(folder, (filePath) => {
    if (statsSupportedDocument(filePath)) found = true;
  });
  return found;
}

function shouldIgnoreProtocolCandidateFolder(folder) {
  const key = normalizeKey(path.basename(folder));
  return ["ENTRADA", "ANEXOS", "AUTUACAO", "PDFS", "MODELOS", "SAIDAS"].includes(key)
    || (key.includes("NAO") && key.includes("ENTRA") && key.includes("PROCESSO"));
}

function findProtocolCandidates(searchRoot, initialRoot) {
  const byFolder = new Map();
  const add = (folder, odsPath = "", context = null, source = "pasta") => {
    if (!folder || shouldIgnoreProtocolCandidateFolder(folder)) return;
    const existing = byFolder.get(folder) || {};
    byFolder.set(folder, {
      folder,
      odsPath: existing.odsPath || odsPath,
      context: existing.context || context,
      sources: [...new Set([...(existing.sources || []), source])]
    });
  };

  for (const odsPath of findProtocolOdsFiles(searchRoot)) {
    add(path.dirname(odsPath), odsPath, protocolContextFromPath(odsPath), "ods");
  }

  walkDirectories(searchRoot, (folder) => {
    const context = protocolContextFromFolder(folder);
    if (protocolContextIsReal(context)) add(folder, "", context, "nome da pasta");
  });

  if (initialRoot && fs.existsSync(initialRoot)) {
    for (const entry of fs.readdirSync(initialRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const folder = path.join(initialRoot, entry.name);
        if (folderHasStatsDocuments(folder)) {
          const context = protocolContextFromFolder(folder);
          add(folder, "", protocolContextIsReal(context) ? context : null, "pasta com documentos");
        }
      }
    }
  }

  return [...byFolder.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function guessProtocolFolderFromDocument(filePath) {
  let folder = path.dirname(filePath);
  while (shouldIgnoreProtocolCandidateFolder(folder) && path.dirname(folder) !== folder) {
    folder = path.dirname(folder);
  }
  return folder;
}

function findSheetByNormalizedName(odsPath, normalizedName) {
  return listOdsSheets(odsPath).find((sheet) => normalizeKey(sheet) === normalizedName);
}

function datePartsFromFileDate(value) {
  const match = String(value || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
}

function prenotationInfoFromProtocol(odsPath) {
  const sheet = findSheetByNormalizedName(odsPath, "MOVIMENTACOES");
  if (!sheet) return null;
  const rows = readOdsSheet(odsPath, sheet);
  const { entries } = movementRowsFromSheetRows(rows);
  const entry = entries.find(({ movement }) => movementMatches(movement, ["Prenotado", "Prenotação"]));
  if (!entry) return null;
  const [fileDate, longDate] = movementDateValues(entry.row, entry.layout);
  const parts = datePartsFromFileDate(fileDate);
  return parts ? { ...parts, fileDate, longDate, sourceDate: getCell(entry.row, entry.layout.date) || firstDateFromRow(entry.row) } : null;
}

function firstFieldFromSheet(odsPath, normalizedSheetName, headerTokens) {
  const sheet = findSheetByNormalizedName(odsPath, normalizedSheetName);
  if (!sheet) return "";
  const rows = readOdsSheet(odsPath, sheet);
  const headers = rows[0] || [];
  const indices = headerTokenIndices(headers, headerTokens);
  if (!indices.length) return "";
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!rowHasValues(row)) continue;
    for (const index of indices) {
      const value = getCell(row, index);
      if (value) return value;
    }
  }
  return "";
}

function cpfFromProtocolOds(odsPath) {
  const direct = firstFieldFromSheet(odsPath, "NOTIFICACOES", ["CPF ou CNPJ", "CPF CNPJ", "CPF"]);
  const match = direct.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  if (match) return match[0];
  const fallback = firstFieldFromSheet(odsPath, "EXTRACAO_DE_ARQUIVOS", ["CPF ou CNPJ", "CPF CNPJ", "CPF"]);
  return fallback.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/)?.[0] || "";
}

function debtFallbackFromProtocolOds(odsPath) {
  return firstFieldFromSheet(odsPath, "NOTIFICACOES", ["VALOR DÍVIDA", "VALOR DIVIDA", "VALOR_DÍVIDA", "VALOR_DIVIDA"]);
}

function directoryNameMatches(fullPath, tokens) {
  const key = normalizeKey(path.basename(fullPath));
  return tokens.every((token) => key.includes(normalizeKey(token)));
}

function findFilesUnder(root, predicate) {
  const found = [];
  walkFiles(root, (filePath) => {
    if (predicate(filePath)) found.push(filePath);
  });
  return found;
}

function scoreRequirementFile(filePath) {
  const key = normalizeKey(filePath);
  let score = 0;
  if (path.extname(filePath).toLowerCase() === ".pdf") score += 10;
  if (key.includes("REQUERIMENTO")) score += 100;
  if (key.includes("ENTRADA")) score += 20;
  if (key.includes("AUTUACAO") || key.includes("PDFS")) score -= 60;
  if (key.includes("CERTIDAO") || key.includes("NOTA_DE_EXIGENCIA")) score -= 100;
  return score;
}

function scoreContractFile(filePath) {
  const key = normalizeKey(filePath);
  let score = 0;
  if (path.extname(filePath).toLowerCase() === ".pdf") score += 10;
  if (key.includes("CONTRATO")) score += 100;
  if (key.includes("CEDULA") || key.includes("CREDITO") || key.includes("ALIENACAO")) score += 40;
  if (key.includes("REQUERIMENTO") || key.includes("PROJECAO") || key.includes("PROCURACAO")) score -= 100;
  return score;
}

function bestScoredFile(files, scorer) {
  return files
    .map((filePath) => [scorer(filePath), filePath])
    .filter(([score]) => score > 0)
    .sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))[0]?.[1] || "";
}

function findRequirementFile(protocolFolder) {
  const supported = new Set([".pdf", ".odt", ".docx", ".txt"]);
  const files = findFilesUnder(protocolFolder, (filePath) => supported.has(path.extname(filePath).toLowerCase()));
  return bestScoredFile(files, scoreRequirementFile);
}

function findContractFile(protocolFolder) {
  const supported = new Set([".pdf", ".odt", ".docx", ".txt"]);
  const contractDirs = [];
  const stack = [protocolFolder];
  while (stack.length) {
    const current = stack.pop();
    if (directoryNameMatches(current, ["NAO", "ENTRA", "PROCESSO"])) contractDirs.push(current);
    try {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      }
    } catch {
      // ignora subpastas inacessíveis
    }
  }
  const roots = contractDirs.length ? contractDirs : [protocolFolder];
  const files = roots.flatMap((root) => findFilesUnder(root, (filePath) => supported.has(path.extname(filePath).toLowerCase())));
  return bestScoredFile(files, scoreContractFile);
}

async function extractPdfText(filePath) {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

function extractXmlDocumentText(filePath, entryName) {
  try {
    return cellDisplayText(readZipText(filePath, entryName));
  } catch {
    return "";
  }
}

async function extractDocumentText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf") return await extractPdfText(filePath);
    if (ext === ".odt") return extractXmlDocumentText(filePath, "content.xml");
    if (ext === ".docx") return extractXmlDocumentText(filePath, "word/document.xml");
    if (ext === ".txt") return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
  return "";
}

async function collectProtocolDocuments(protocolFolder, onProgress) {
  const files = findFilesUnder(protocolFolder, statsSupportedDocument)
    .filter((filePath) => !normalizeKey(filePath).includes("MODELOS"))
    .sort((a, b) => a.localeCompare(b));
  const documents = [];
  for (const filePath of files) {
    onProgress?.(`Lendo documento: ${path.basename(filePath)}`);
    const text = await extractDocumentText(filePath);
    documents.push({ filePath, text, normalized: normalizeKey(text) });
  }
  return documents;
}

function scoreRequirementText(text) {
  const key = normalizeKey(text);
  if (!key) return 0;
  let score = 0;
  if (key.includes("REQUERIMENTO")) score += 90;
  if (key.includes("INTIMACAO")) score += 70;
  if (key.includes("ALIENACAO_FIDUCIARIA") || (key.includes("ALIENACAO") && key.includes("FIDUCIARIA"))) score += 70;
  if (key.includes("PURGA") && key.includes("MORA")) score += 45;
  if (key.includes("DEVEDOR")) score += 25;
  if (key.includes("CREDOR")) score += 20;
  if (key.includes("VALOR") && key.includes("DIVIDA")) score += 40;
  if (key.includes("PROJECAO_DE_VALORES")) score -= 35;
  if (key.includes("PROCURACAO")) score -= 80;
  if (key.includes("CERTIDAO")) score -= 110;
  if (key.includes("CARTA_DE_NOTIFICACAO")) score -= 110;
  return score;
}

function scoreContractText(text) {
  const key = normalizeKey(text);
  if (!key) return 0;
  let score = 0;
  if (key.includes("CONTRATO")) score += 80;
  if (key.includes("CEDULA") && key.includes("CREDITO")) score += 70;
  if (key.includes("ALIENACAO_FIDUCIARIA") || (key.includes("ALIENACAO") && key.includes("FIDUCIARIA"))) score += 50;
  if (key.includes("DESTINACAO") && key.includes("MUTUO")) score += 100;
  if (key.includes("HABITACIONAL")) score += 40;
  if (key.includes("REQUERIMENTO")) score -= 70;
  if (key.includes("PROCURACAO") || key.includes("CERTIDAO")) score -= 100;
  return score;
}

function bestDocumentByContent(documents, scorer, filter = null) {
  return documents
    .filter((document) => !filter || filter(document))
    .map((document) => ({ ...document, score: scorer(document.text) }))
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))[0] || null;
}

function documentIsUnderNoProcessFolder(document) {
  return document.filePath.split(/[\\/]+/).some((part) => {
    const key = normalizeKey(part);
    return key.includes("NAO") && key.includes("ENTRA") && key.includes("PROCESSO");
  });
}

function currencyNumber(value) {
  const digits = String(value || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const number = Number(digits);
  return Number.isFinite(number) ? number : 0;
}

function debtCandidateScore(window, amount) {
  let score = 0;
  if (window.includes("TOTAL_DA_DIVIDA") || window.includes("DIVIDA_TOTAL") || (window.includes("DIVIDA") && window.includes("TOTAL"))) score += 230;
  if (window.includes("TOTAL_DO_DEBITO") || window.includes("DEBITO_TOTAL") || (window.includes("DEBITO") && window.includes("TOTAL"))) score += 220;
  if (window.includes("VALOR_TOTAL") || window.includes("TOTAL_ATUALIZADO") || window.includes("VALOR_ATUALIZADO_TOTAL")) score += 190;
  if (window.includes("SALDO_DEVEDOR_TOTAL") || (window.includes("SALDO_DEVEDOR") && window.includes("TOTAL"))) score += 190;
  if (window.includes("SALDO_DEVEDOR") || window.includes("SALDO")) score += 90;
  if (window.includes("DIVIDA")) score += 80;
  if (window.includes("DEBITO")) score += 75;
  if (window.includes("PURGA") || window.includes("MORA")) score += 45;
  if (window.includes("VALOR_PARA_PAGAMENTO") || window.includes("PARA_PAGAMENTO")) score += 55;
  if (window.includes("ATUALIZAD")) score += 50;
  if (window.includes("MENSAL") || window.includes("PARCELA") || window.includes("PRESTACAO") || window.includes("ENCARGO_MENSAL")) score -= 210;
  if (window.includes("VALOR_DA_PARCELA") || window.includes("VALOR_MENSAL")) score -= 220;
  if (window.includes("CUSTAS") || window.includes("EMOLUMENTOS") || window.includes("INTIMACAO") || window.includes("INTIMACOES")) score -= 130;
  if (window.includes("VALOR_VENAL") || window.includes("ITBI")) score -= 140;
  if (window.includes("VALOR_DO_IMOVEL") || window.includes("IMOVEL_AVALIADO")) score -= 110;
  if (window.includes("VALOR_DO_CONTRATO") || window.includes("VALOR_FINANCIADO") || window.includes("FINANCIAMENTO")) score -= 90;
  if (amount > 0) score += Math.min(30, Math.log10(amount + 1) * 8);
  return score;
}

function extractDebtValue(text, documentScore = 0) {
  const content = String(text || "");
  const totalPatterns = [
    /(?:valor\s+)?total\s+da\s+d[íi]vida[\s\S]{0,90}?(R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /d[íi]vida\s+total[\s\S]{0,90}?(R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /(?:valor\s+)?total\s+do\s+d[ée]bito[\s\S]{0,90}?(R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /d[ée]bito\s+total[\s\S]{0,90}?(R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /saldo\s+devedor\s+total[\s\S]{0,90}?(R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})/i
  ];
  for (const pattern of totalPatterns) {
    const direct = content.match(pattern)?.[1];
    if (direct) return direct;
  }
  const matches = [...content.matchAll(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/g)];
  if (!matches.length) return "";
  const scored = matches.map((match) => {
    const start = Math.max(0, match.index - 360);
    const end = Math.min(content.length, match.index + match[0].length + 220);
    const window = normalizeKey(content.slice(start, end));
    const amount = currencyNumber(match[0]);
    const score = debtCandidateScore(window, amount) + Math.max(0, documentScore) / 5;
    return { value: match[0], score, amount };
  });
  scored.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return scored[0].score > 35 ? scored[0].value : "";
}

function extractDebtValueFromDocuments(documents) {
  const candidates = documents
    .map((document) => {
      const documentScore = scoreRequirementText(document.text);
      const value = extractDebtValue(document.text, documentScore);
      return { document, value, documentScore, amount: currencyNumber(value) };
    })
    .filter((candidate) => candidate.value);
  if (!candidates.length) return { value: "", filePath: "" };
  candidates.sort((a, b) => b.documentScore - a.documentScore || b.amount - a.amount || a.document.filePath.localeCompare(b.document.filePath));
  return { value: candidates[0].value, filePath: candidates[0].document.filePath };
}

function cleanExtractedPhrase(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.=-]+/, "")
    .replace(/[\s;,.=-]+$/, "")
    .trim()
    .toUpperCase();
}

const ARISP_DESTINATIONS = {
  COMERCIO: "COMÉRCIO",
  EXPORTACAO: "EXPORTAÇÃO",
  HAB_COMPRA_GARANTIA: "HABITACIONAL - COMPRA DE IMÓVEL DADO EM GARANTIA",
  HAB_COMPRA_OUTRO: "HABITACIONAL - COMPRA DE OUTRO IMÓVEL",
  HAB_CONSTRUCAO_AUTO: "HABITACIONAL - CONSTRUÇÃO - AUTOCONSTRUÇÃO",
  HAB_CONSTRUCAO_EMPREENDIMENTO: "HABITACIONAL - CONSTRUÇÃO - EMPREENDIMENTO",
  HAB_REFORMA: "HABITACIONAL - REFORMA E AMPLIAÇÃO",
  IMPORTACAO: "IMPORTAÇÃO",
  MICROCREDITO: "MICROCRÉDITO",
  NAO_DECLARADA: "NÃO DECLARADA",
  NAO_HAB_COMPRA_OUTRO: "NÃO HABITACIONAL - COMPRA DE OUTRO IMÓVEL",
  NAO_HAB_CONSTRUCAO_AUTO: "NÃO HABITACIONAL - CONSTRUÇÃO - AUTOCONSTRUÇÃO",
  NAO_HAB_CONSTRUCAO_EMPREENDIMENTO: "NÃO HABITACIONAL - CONSTRUÇÃO - EMPREENDIMENTO",
  NAO_HAB_COMPRA_GARANTIA: "NÃO HABITACIONAL - COMPRA DE IMÓVEL DADO EM GARANTIA",
  SOCIETARIAS: "OPERAÇÕES SOCIETÁRIAS",
  AGRICOLA: "PRODUÇÃO AGRÍCOLA",
  INDUSTRIAL: "PRODUÇÃO INDUSTRIAL",
  PECUARIA: "PRODUÇÃO PECUÁRIA",
  SERVICOS: "SERVIÇOS",
  OUTRAS: "OUTRAS DESTINAÇÕES"
};

function keyHasAny(key, tokens) {
  return tokens.some((token) => key.includes(normalizeKey(token)));
}

function classifyRealEstateDestination(key) {
  const hasRealEstateSignal = keyHasAny(key, [
    "imóvel", "imobiliário", "matrícula", "garantia imobiliária", "alienação fiduciária",
    "terreno", "construção", "reforma", "ampliação", "habitação", "habitacional", "residencial", "moradia"
  ]);
  if (!hasRealEstateSignal) return "";

  const nonHab = keyHasAny(key, [
    "não habitacional", "nao habitacional", "não residencial", "nao residencial",
    "imóvel comercial", "imovel comercial", "sala comercial", "galpão", "galpao", "loja", "escritório", "escritorio"
  ]);
  const hab = !nonHab && keyHasAny(key, [
    "habitacional", "residencial", "moradia", "casa própria", "casa propria",
    "habitação", "habitacao", "SFH", "FGTS"
  ]);
  const prefix = nonHab ? "NAO_HAB" : "HAB";

  const construction = keyHasAny(key, ["construção", "construcao", "obra", "edificação", "edificacao"]);
  const empreendimento = keyHasAny(key, [
    "empreendimento", "incorporação imobiliária", "incorporacao imobiliaria",
    "unidades autônomas", "unidades autonomas", "condomínio", "condominio", "loteamento", "construtora"
  ]);
  const reform = keyHasAny(key, ["reforma", "ampliação", "ampliacao", "melhoria", "benfeitoria"]);
  const purchase = keyHasAny(key, ["compra", "aquisição", "aquisicao"]);
  const sameCollateral = keyHasAny(key, [
    "imóvel dado em garantia", "imovel dado em garantia", "objeto da garantia",
    "imóvel garantia", "imovel garantia", "imóvel alienado", "imovel alienado",
    "garantia fiduciária", "garantia fiduciaria", "alienado fiduciariamente"
  ]);
  const anotherProperty = keyHasAny(key, ["outro imóvel", "outro imovel", "terceiro imóvel", "terceiro imovel"]);

  if (reform) return prefix === "NAO_HAB" ? ARISP_DESTINATIONS.OUTRAS : ARISP_DESTINATIONS.HAB_REFORMA;
  if (construction && empreendimento) {
    return prefix === "NAO_HAB" ? ARISP_DESTINATIONS.NAO_HAB_CONSTRUCAO_EMPREENDIMENTO : ARISP_DESTINATIONS.HAB_CONSTRUCAO_EMPREENDIMENTO;
  }
  if (construction) {
    return prefix === "NAO_HAB" ? ARISP_DESTINATIONS.NAO_HAB_CONSTRUCAO_AUTO : ARISP_DESTINATIONS.HAB_CONSTRUCAO_AUTO;
  }
  if (purchase || anotherProperty) {
    if (!anotherProperty && (sameCollateral || keyHasAny(key, ["garantia", "alienação fiduciária", "alienacao fiduciaria"]))) {
      return prefix === "NAO_HAB" ? ARISP_DESTINATIONS.NAO_HAB_COMPRA_GARANTIA : ARISP_DESTINATIONS.HAB_COMPRA_GARANTIA;
    }
    return prefix === "NAO_HAB" ? ARISP_DESTINATIONS.NAO_HAB_COMPRA_OUTRO : ARISP_DESTINATIONS.HAB_COMPRA_OUTRO;
  }
  if (hab) return ARISP_DESTINATIONS.HAB_COMPRA_GARANTIA;
  if (nonHab) return ARISP_DESTINATIONS.NAO_HAB_COMPRA_GARANTIA;
  return "";
}

function extractMutuoDestination(text) {
  const content = String(text || "").replace(/\r/g, "\n");
  if (!content.trim()) return "";
  const explicit = content.match(/destina(?:ç|c)[aã]o\s+do\s+m[uú]tuo[\s:.-]{0,20}([^\n.;]{8,220})/i);
  const targetText = explicit ? `${explicit[1]}\n${content}` : content;
  const key = normalizeKey(targetText);
  if (keyHasAny(key, ["não declarada", "nao declarada", "não informada", "nao informada", "sem destinação", "sem destinacao"])) return ARISP_DESTINATIONS.NAO_DECLARADA;

  const realEstate = classifyRealEstateDestination(key);
  if (realEstate) return realEstate;

  if (keyHasAny(key, ["exportação", "exportacao", "exportar", "mercado externo"])) return ARISP_DESTINATIONS.EXPORTACAO;
  if (keyHasAny(key, ["importação", "importacao", "importar", "mercadoria importada"])) return ARISP_DESTINATIONS.IMPORTACAO;
  if (keyHasAny(key, ["microcrédito", "microcredito", "microempreendedor", "capital de giro popular"])) return ARISP_DESTINATIONS.MICROCREDITO;
  if (keyHasAny(key, ["operação societária", "operacao societaria", "quotas sociais", "ações", "acoes", "participação societária", "participacao societaria", "capital social", "fusão", "fusao", "cisão", "cisao"])) return ARISP_DESTINATIONS.SOCIETARIAS;
  if (keyHasAny(key, ["produção agrícola", "producao agricola", "atividade agrícola", "atividade agricola", "safra", "lavoura", "plantio", "sementes", "fertilizantes", "defensivos agrícolas", "defensivos agricolas"])) return ARISP_DESTINATIONS.AGRICOLA;
  if (keyHasAny(key, ["produção pecuária", "producao pecuaria", "pecuária", "pecuaria", "rebanho", "gado", "bovino", "suíno", "suino", "aves"])) return ARISP_DESTINATIONS.PECUARIA;
  if (keyHasAny(key, ["produção industrial", "producao industrial", "indústria", "industria", "fábrica", "fabrica", "maquinário", "maquinario", "linha de produção", "linha de producao"])) return ARISP_DESTINATIONS.INDUSTRIAL;
  if (keyHasAny(key, ["prestação de serviços", "prestacao de servicos", "serviços", "servicos", "consultoria", "transporte", "clínica", "clinica", "hotelaria"])) return ARISP_DESTINATIONS.SERVICOS;
  if (keyHasAny(key, ["comércio", "comercio", "mercadorias", "estoque", "loja", "varejo", "atacado", "capital de giro"])) return ARISP_DESTINATIONS.COMERCIO;
  return ARISP_DESTINATIONS.OUTRAS;
}

function extractMutuoDestinationFromDocuments(documents) {
  const preferred = bestDocumentByContent(documents, scoreContractText, documentIsUnderNoProcessFolder)
    || bestDocumentByContent(documents, scoreContractText);
  const ordered = preferred ? [preferred, ...documents.filter((document) => document.filePath !== preferred.filePath)] : documents;
  for (const document of ordered) {
    const value = extractMutuoDestination(document.text);
    if (value) return { value, filePath: document.filePath };
  }
  return { value: "", filePath: "" };
}

function cpfFromText(text) {
  return String(text || "").match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/)?.[0] || "";
}

function cpfFromDocuments(documents) {
  const preferred = bestDocumentByContent(documents, scoreRequirementText);
  const ordered = preferred ? [preferred, ...documents.filter((document) => document.filePath !== preferred.filePath)] : documents;
  for (const document of ordered) {
    const cpf = cpfFromText(document.text);
    if (cpf) return cpf;
  }
  return "";
}

function allDateMatches(text) {
  const content = String(text || "");
  const matches = [];
  const numeric = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;
  for (const match of content.matchAll(numeric)) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    matches.push({ index: match.index, text: match[0], day: Number(match[1]), month: Number(match[2]), year });
  }
  const long = /\b(\d{1,2})\s+de\s+([\p{L}]+)\s+de\s+(\d{2,4})\b/giu;
  for (const match of content.matchAll(long)) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    try {
      matches.push({ index: match.index, text: match[0], day: Number(match[1]), month: monthNumber(match[2]), year });
    } catch {
      // ignora mês não reconhecido
    }
  }
  return matches;
}

function extractPrenotationInfoFromText(text) {
  const content = String(text || "");
  const matches = allDateMatches(content);
  if (!matches.length) return null;
  const scored = matches.map((match) => {
    const start = Math.max(0, match.index - 180);
    const end = Math.min(content.length, match.index + match.text.length + 120);
    const window = normalizeKey(content.slice(start, end));
    let score = 0;
    if (window.includes("PRENOTACAO") || window.includes("PRENOTADO")) score += 160;
    if (window.includes("PROTOCOLO")) score += 40;
    if (window.includes("AUTUACAO")) score += 30;
    if (window.includes("DATA")) score += 10;
    if (window.includes("CONTRATO") || window.includes("VENCIMENTO") || window.includes("PARCELA")) score -= 70;
    return { ...match, score };
  }).filter((match) => match.score > 0);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  if (!scored.length) return null;
  const selected = scored[0];
  const fileDate = `${String(selected.day).padStart(2, "0")}.${String(selected.month).padStart(2, "0")}.${selected.year}`;
  return { day: selected.day, month: selected.month, year: selected.year, fileDate, longDate: formatDateForDocument(selected.text), sourceDate: selected.text };
}

function extractPrenotationInfoFromDocuments(documents) {
  const ordered = [...documents].sort((a, b) => scoreRequirementText(b.text) - scoreRequirementText(a.text));
  for (const document of ordered) {
    const info = extractPrenotationInfoFromText(document.text);
    if (info) return { ...info, filePath: document.filePath };
  }
  return null;
}

function protocolContextFromCandidate(candidate, documents) {
  if (candidate.context && protocolContextIsReal(candidate.context)) return candidate.context;
  for (const document of documents) {
    const context = protocolContextFromText(document.text);
    if (context) return context;
  }
  const folderContext = protocolContextFromFolder(candidate.folder);
  return protocolContextIsReal(folderContext) ? folderContext : null;
}

function odsCell(value) {
  return `<table:table-cell office:value-type="string"><text:p>${xmlEscape(value)}</text:p></table:table-cell>`;
}

function odsRow(values) {
  return `<table:table-row>${values.map(odsCell).join("")}</table:table-row>`;
}

function writeWorkbookOds(outputPath, workbook) {
  const normalized = normalizeWorkbookData(workbook);
  const zip = new AdmZip();
  const tables = normalized.sheetOrder.map((sheetName) => {
    const rows = normalized.sheets[sheetName] || [[]];
    return `<table:table table:name="${xmlEscape(sheetName)}">
        ${rows.map(odsRow).join("\n        ")}
      </table:table>`;
  }).join("\n      ");
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body>
    <office:spreadsheet>
      ${tables}
    </office:spreadsheet>
  </office:body>
</office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  zip.addFile("mimetype", Buffer.from("application/vnd.oasis.opendocument.spreadsheet", "utf8"));
  zip.addFile("content.xml", Buffer.from(content, "utf8"));
  zip.addFile("META-INF/manifest.xml", Buffer.from(manifest, "utf8"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  zip.writeZip(outputPath);
}

function writeSimpleOds(outputPath, rows) {
  writeWorkbookOds(outputPath, { sheetOrder: ["Planilha1"], sheets: { Planilha1: rows } });
}

async function arispStatsRecordFromCandidate(candidate, documents, onProgress) {
  const context = protocolContextFromCandidate(candidate, documents);
  if (!context) throw new Error("Não consegui identificar o protocolo pelo conteúdo dos documentos.");
  onProgress?.(`Lendo protocolo ${context.office_protocol} - ${context.prenotation}`);
  const debt = extractDebtValueFromDocuments(documents);
  const mutuo = extractMutuoDestinationFromDocuments(documents);
  const cpf = (candidate.odsPath ? cpfFromProtocolOds(candidate.odsPath) : "") || cpfFromDocuments(documents);
  return {
    officeProtocol: context.office_protocol,
    prenotation: context.prenotation.replace(/\D/g, "") || context.prenotation,
    debtValue: debt.value || (candidate.odsPath ? debtFallbackFromProtocolOds(candidate.odsPath) : ""),
    mutuoDestination: mutuo.value,
    cpf,
    odsPath: candidate.odsPath || "",
    protocolFolder: candidate.folder,
    debtSourceFile: debt.filePath,
    mutuoSourceFile: mutuo.filePath
  };
}

async function generateArispStats(config, data, onProgress) {
  const { month, year } = validateArispStatsPeriod(data.month, data.year);
  const root = path.resolve(config.initial_folder_root || "");
  if (!config.initial_folder_root || !fs.existsSync(root)) throw new Error("Configure uma pasta raiz inicial válida.");
  const searchRoot = path.dirname(root);
  onProgress?.(`Procurando protocolos em ${searchRoot}...`);
  const candidates = findProtocolCandidates(searchRoot, root);
  const rows = [];
  const warnings = [];
  const seen = new Set();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      const documents = await collectProtocolDocuments(candidate.folder, onProgress);
      const prenotation = candidate.odsPath
        ? prenotationInfoFromProtocol(candidate.odsPath) || extractPrenotationInfoFromDocuments(documents)
        : extractPrenotationInfoFromDocuments(documents);
      if (!prenotation || prenotation.month !== month || prenotation.year !== year) continue;
      const record = await arispStatsRecordFromCandidate(candidate, documents, onProgress);
      const key = contextKey({ office_protocol: record.officeProtocol, prenotation: record.prenotation });
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(record);
      }
    } catch (error) {
      warnings.push(`${candidate.folder}: ${error.message || error}`);
    }
  }

  const candidateFolders = candidates.map((candidate) => candidate.folder);
  const contentDocuments = [];
  walkFiles(searchRoot, (filePath) => {
    if (!statsSupportedDocument(filePath)) return;
    if (candidateFolders.some((folder) => filePath === folder || isPathInside(filePath, folder))) return;
    contentDocuments.push(filePath);
  });
  for (const filePath of contentDocuments) {
    try {
      onProgress?.(`Lendo documento avulso: ${path.basename(filePath)}`);
      const text = await extractDocumentText(filePath);
      const context = protocolContextFromText(text);
      const prenotation = extractPrenotationInfoFromText(text);
      if (!context || !prenotation || prenotation.month !== month || prenotation.year !== year) continue;
      const key = contextKey(context);
      if (seen.has(key)) continue;
      const folder = guessProtocolFolderFromDocument(filePath);
      const documents = await collectProtocolDocuments(folder, onProgress);
      const record = await arispStatsRecordFromCandidate({ folder, context, odsPath: "", sources: ["conteúdo"] }, documents, onProgress);
      seen.add(key);
      rows.push(record);
    } catch (error) {
      warnings.push(`${filePath}: ${error.message || error}`);
    }
  }
  rows.sort((a, b) => a.prenotation.localeCompare(b.prenotation, undefined, { numeric: true }) || a.officeProtocol.localeCompare(b.officeProtocol));
  const outputRows = [
    ["PROTOCOLO INTIMAÇÃO", "PRENOTAÇÃO", "VALOR DÍVIDA", "DESTINAÇÃO DO MÚTUO", "CPF"],
    ...rows.map((row) => [row.officeProtocol, row.prenotation, row.debtValue, row.mutuoDestination, row.cpf])
  ];
  const output = path.join(searchRoot, `${statsMonthName(month)} ${year}.ods`);
  writeSimpleOds(output, outputRows);
  return { searchRoot, output, rows, warnings, scanned: candidates.length, month, year };
}

module.exports = {
  APP_TITLE,
  DEFAULT_CONFIG,
  DEFAULT_MOVEMENT_ATTACHMENT_RULES,
  MOVEMENT_PREFILL_OPTIONS,
  normalizeKey,
  normalizeConfig,
  normalizeMovementDocumentRules,
  normalizeMovementAttachmentRules,
  normalizeMovementPrefillOptions,
  normalizeRtdCostTable,
  rtdCostTableFromWorkbook,
  normalizeWorkbookData,
  readOdsWorkbook,
  protocolSheetsFromOds,
  applyProtocolWorkbookCalculations,
  writeWorkbookOds,
  safeFilename,
  formatDateLong,
  formatDateForDocument,
  fileDateFromText,
  formatPrenotation,
  listOdsSheets,
  readOdsSheet,
  extractRecords,
  analyzeMovements,
  movementAttachmentRequirements,
  movementRequiresOnrSignature,
  createInitialFolder,
  findModelFile,
  modelHasSignatureFields,
  mergeOdtDocument,
  convertFileToPdf,
  convertSourceToPdf,
  convertPdfToPdfAIfPossible,
  convertAnyFileToPdfA,
  mergePdfs,
  createAutuationPreview,
  imageFilenameFromPattern,
  exportAutuationImage,
  buildNoteRequirementTexts,
  noteTextsFromItems,
  generateNote,
  autuarMovimentacao,
  estornarAutuacaoFiles,
  generateFinalPdf,
  generateArispStats,
  addField,
  addProtocolFields,
  normalizeSigners,
  resolveSignature,
  addSignatureFields,
  addGenerationDateFields,
  protocolContextFromPath,
  protocolContextFromValues
};
