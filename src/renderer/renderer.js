let config = {};
let currentProtocol = "";
let protocols = [];
let selectedProtocolId = "";
let selectedProtocolSheetName = "";
let selectedProtocolSheetRow = -1;
let selectedProtocolSheetColumn = -1;
let slots = [];
let selectedSlotIndex = -1;
let protocolAutosaveTimer = null;
let protocolAutosaveInFlight = false;
let protocolAutosaveQueued = false;
let protocolAutosavePromise = Promise.resolve();
let protocolFileRefreshTimer = null;
let activeAutuationPreviewId = "";
let autuationPreviewRequestId = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const protocolPanelIds = ["protocolData", "protocolSheets", "initial", "note", "letters", "certificate", "attachments", "pdfa"];

const letterModels = {
  "Carta de Notificação": ["Carta de Notificação", "Primeira Carta de Notificação", "Segunda Carta de Notificação", "Primeira Carta", "Segunda Carta"],
  "Edital": ["Edital"]
};
const certificateModels = {
  "Gerar Certidão": ["Certidão Transcurso de Prazo", "Certidão de Transcurso de Prazo", "Certidão"]
};
const arispMonths = [
  ["1", "Janeiro"],
  ["2", "Fevereiro"],
  ["3", "Março"],
  ["4", "Abril"],
  ["5", "Maio"],
  ["6", "Junho"],
  ["7", "Julho"],
  ["8", "Agosto"],
  ["9", "Setembro"],
  ["10", "Outubro"],
  ["11", "Novembro"],
  ["12", "Dezembro"]
];
const defaultExtractionAttachmentRules = [
  { movement: "Arquivos Compatíveis", document: "Arquivos Compatíveis (DATA)", quantity: "1+" },
  { movement: "Arquivos Incompatíveis", document: "Arquivos Incompatíveis (DATA)", quantity: "1+" }
];

const defaultMovementAttachmentRules = [
  { movement: "Não Intimado", document: "Intimação Negativa (DATA)", quantity: "1+" },
  { movement: "Intimado", document: "Intimação Positiva (DATA)", quantity: "1+" },
  { movement: "Prenotado; Prenotação", document: "Prenotação (DATA)", quantity: "1+" },
  { movement: "Exigência Cumprida", document: "Reentrada (DATA)", quantity: "1+" },
  { movement: "Exigência", document: "Exigência", quantity: "1" },
  ...defaultExtractionAttachmentRules,
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

const defaultMovementDocumentRules = [
  { movement: "Prenotado", file: "Autuação" },
  { movement: "Arquivos Compatíveis", file: "Certidão Extração de Arquivos" },
  { movement: "Arquivos Incompatíveis", file: "Certidão Extração de Arquivos Incompletos" },
  { movement: "Exigência Cumprida", file: "Certidão Extração de Arquivos" },
  { movement: "Intimado", file: "Certidão Notificações RTD Positivas" },
  { movement: "Não Intimado", file: "Certidão Notificações RTD Negativas" },
  { movement: "Edital de Publicação", file: "Certidão Edital de Publicação" },
  { movement: "Transcurso de Prazo (Consolidação)", file: "Certidão Prazo Consolidação" },
  { movement: "Requerimento Consolidação", file: "Certidão Requerimento Consolidação" },
  { movement: "Consolidação", file: "Certidão Averbação da Consolidação" },
  { movement: "Valor Venal", file: "Certidão Valor Venal" },
  { movement: "Averbado", file: "Certidão Averbação da Consolidação" },
  { movement: "Desistência", file: "Certidão Requerimento Desistência" },
  { movement: "Notificação Enviada", file: "Certidão Carta de Notificação" },
  { movement: "Decurso de Prazo da Prenotação", file: "Certidão Decurso de Prazo da Prenotação" }
];

const calculatedProtocolColumns = {
  MOVIMENTACOES: ["DIA", "MÊS", "MES", "ANO", "NOME ARQUIVO", "NOME_ARQUIVO"],
  EXTRACAO_DE_ARQUIVOS: ["DOC_TIPO", "DATA EXTENSO", "PREN_FORMATADA"],
  NOTIFICACOES: [
    "(AouO)",
    "Ao Senhor(a)",
    "Senhor(a)",
    "AUXILIAR_DOC",
    "AUX CEP",
    "CEP_FORMATADO",
    "MAT_FORMATADA",
    "VALOR_ENC_FORMATADO",
    "PRENOTAÇÃO",
    "VALOR TOTAL",
    "VALOR_INT_FORMATADO",
    "PROTOCOLO",
    "PROT_FORMATADO"
  ],
  INTIMACAO: [
    "SEXO",
    "dAs_notificações",
    "(os_as)",
    "(nºs_)",
    "(devedore_s)",
    "AUXILIAR COMARCA RTD",
    "AUXILIAR Nº REGISTRO",
    "Nº REGISTRO FORMATADO",
    "AUXILIAR NOMES"
  ],
  TRANSCURSO_DE_PRAZO: [
    "AUX_ASOS",
    "AUX_OOS",
    "AUX_DEVEDORES",
    "AUX_DAS",
    "NOMES",
    "CREDORA",
    "MATRÍCULA",
    "MAT_FORMATADA",
    "TEXTO INTIMAÇÃO",
    "PRENOTAÇÃO",
    "PROT_FORMATADO",
    "DATA PRENOTAÇÃO",
    "DATA JUNTADA",
    "PROT_CERT_FORMATADO"
  ],
  CONSOLIDACAO: ["AVERBAÇÃO_FORMATADO", "AVERBACAO_FORMATADO", "MATRÍCULA_FORMATADA", "MATRICULA_FORMATADA"]
};

const calculatedProtocolColumnKeys = Object.fromEntries(
  Object.entries(calculatedProtocolColumns).map(([sheet, headers]) => [sheet, new Set(headers.map(normalizeUiKey))])
);

const movementValidationOptions = [
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
const yesNoOptions = ["SIM", "NÃO"];
const noYesOptions = ["NÃO", "SIM"];
const sexOptions = ["F", "M"];
const intimationResultOptions = ["Positiva", "Negativa"];
const intimationTypeOptions = ["RTD", "Edital de Intimação"];

function normalizeUiKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeSheetMatch(value) {
  return normalizeUiKey(value).replace(/_/g, "");
}

function log(message) {
  const box = $("#log");
  box.textContent += `${message}\n`;
  box.scrollTop = box.scrollHeight;
}

async function run(label, fn) {
  try {
    const result = await fn();
    if (label) log(label);
    return result;
  } catch (error) {
    log(error.message || String(error));
    alert(error.message || String(error));
    throw error;
  }
}

function configKeys() {
  return [
    "initial_folder_root",
    "base_protocol_template",
    "models_folder",
    "note_requirement_model",
    "image_output_folder",
    "image_output_bucket_size",
    "image_output_folder_pattern",
    "image_output_filename",
    "notifications_sheet",
    "notifications_name_col",
    "base_prenotation_value",
    "certificate_sheet",
    "certificate_name_col",
    "movements_sheet"
  ];
}

function cloneDefaultMovementRules() {
  return defaultMovementAttachmentRules.map((rule) => ({ ...rule }));
}

function cloneDefaultMovementDocumentRules() {
  return defaultMovementDocumentRules.map((rule) => ({ ...rule }));
}

function movementDocumentRulesFromConfig(rules) {
  const source = Array.isArray(rules) ? rules : cloneDefaultMovementDocumentRules();
  return source
    .map((rule) => ({
      movement: String(rule?.movement || rule?.movimentacao || rule?.movimentacoes || "").trim(),
      file: String(rule?.file || rule?.arquivo || rule?.document || rule?.arquivo_modelo || "").trim()
    }))
    .filter((rule) => rule.movement || rule.file);
}

function movementRulesFromConfig(rules) {
  const source = Array.isArray(rules) ? rules : cloneDefaultMovementRules();
  return source
    .map((rule) => ({
      movement: String(rule?.movement || "").trim(),
      document: String(rule?.document || "").trim(),
      quantity: String(rule?.quantity || "").trim() === "1" ? "1" : "1+"
    }))
    .filter((rule) => rule.movement || rule.document);
}

function movementPrefillOptionsFromConfig(options) {
  return uniqueNonEmpty(Array.isArray(options) ? options : movementValidationOptions);
}

function movementRowsFromConfig(source = config) {
  const rows = [];

  for (const rule of movementDocumentRulesFromConfig(source?.movement_document_rules)) {
    rows.push({ movement: rule.movement, file: rule.file, isAttachment: false, quantity: "1+" });
  }
  for (const rule of movementRulesFromConfig(source?.movement_attachment_rules)) {
    rows.push({ movement: rule.movement, file: rule.document, isAttachment: true, quantity: rule.quantity });
  }
  return rows;
}

function cloneDefaultMovementRows() {
  return movementRowsFromConfig({
    movement_document_rules: cloneDefaultMovementDocumentRules(),
    movement_attachment_rules: cloneDefaultMovementRules()
  });
}

function cloneDefaultMovementPrefillOptions() {
  return movementValidationOptions.map((item) => item);
}

function addMovementPrefillRow(value = "") {
  const body = $("#movementPrefillTable tbody");
  if (!body) return;
  const row = document.createElement("tr");
  const movementCell = document.createElement("td");
  const actionCell = document.createElement("td");
  const movementInput = document.createElement("input");
  const removeButton = document.createElement("button");
  movementInput.value = String(value || "");
  removeButton.type = "button";
  removeButton.textContent = "Remover";
  removeButton.addEventListener("click", () => row.remove());
  movementCell.appendChild(movementInput);
  actionCell.appendChild(removeButton);
  row.append(movementCell, actionCell);
  body.appendChild(row);
}

function renderMovementPrefillOptions(options = config.movement_prefill_options) {
  const body = $("#movementPrefillTable tbody");
  if (!body) return;
  body.innerHTML = "";
  for (const movement of movementPrefillOptionsFromConfig(options)) addMovementPrefillRow(movement);
}

function readMovementPrefillOptions() {
  return uniqueNonEmpty($$("#movementPrefillTable tbody input").map((input) => input.value.trim()));
}

function addMovementRuleRow(rule = {}) {
  const body = $("#movementRulesTable tbody");
  if (!body) return;
  const row = document.createElement("tr");
  const movementCell = document.createElement("td");
  const fileCell = document.createElement("td");
  const attachmentCell = document.createElement("td");
  const actionCell = document.createElement("td");
  const movementInput = document.createElement("input");
  const fileInput = document.createElement("input");
  const attachmentLabel = document.createElement("label");
  const attachmentCheckbox = document.createElement("input");
  const quantityWrap = document.createElement("span");
  const quantitySelect = document.createElement("select");
  const removeButton = document.createElement("button");

  movementInput.value = rule.movement || "";
  movementInput.dataset.field = "movement";
  fileInput.value = rule.file || rule.document || "";
  fileInput.dataset.field = "file";
  attachmentCheckbox.type = "checkbox";
  attachmentCheckbox.checked = Boolean(rule.isAttachment || rule.attachment || rule.acceptsAttachment);
  attachmentCheckbox.dataset.field = "attachment";
  quantitySelect.add(new Option("1", "1"));
  quantitySelect.add(new Option("1+", "1+"));
  quantitySelect.value = rule.quantity === "1" ? "1" : "1+";
  quantitySelect.dataset.field = "quantity";
  quantityWrap.className = "movement-quantity";
  quantityWrap.append("Quantidade: ", quantitySelect);
  attachmentLabel.className = "check movement-attachment-check";
  attachmentLabel.append(attachmentCheckbox, " Anexo");
  const syncAttachment = () => {
    quantityWrap.hidden = !attachmentCheckbox.checked;
  };
  attachmentCheckbox.addEventListener("change", syncAttachment);
  removeButton.type = "button";
  removeButton.textContent = "Remover";
  removeButton.addEventListener("click", () => row.remove());
  syncAttachment();

  movementCell.appendChild(movementInput);
  fileCell.appendChild(fileInput);
  attachmentCell.append(attachmentLabel, quantityWrap);
  actionCell.appendChild(removeButton);
  row.append(movementCell, fileCell, attachmentCell, actionCell);
  body.appendChild(row);
}

function renderMovementRules(source = config) {
  const body = $("#movementRulesTable tbody");
  if (!body) return;
  body.innerHTML = "";
  const rows = Array.isArray(source) ? source : movementRowsFromConfig(source);
  for (const rule of rows) addMovementRuleRow(rule);
}

function readMovementRows() {
  return $$("#movementRulesTable tbody tr")
    .map((row) => ({
      movement: row.querySelector('[data-field="movement"]')?.value.trim() || "",
      file: row.querySelector('[data-field="file"]')?.value.trim() || "",
      isAttachment: row.querySelector('[data-field="attachment"]')?.checked || false,
      quantity: row.querySelector('[data-field="quantity"]')?.value === "1" ? "1" : "1+"
    }))
    .filter((rule) => rule.movement || rule.file);
}

function readMovementDocumentRules() {
  return readMovementRows()
    .filter((rule) => !rule.isAttachment && rule.movement && rule.file)
    .map((rule) => ({ movement: rule.movement, file: rule.file }));
}

function readMovementRules() {
  return readMovementRows()
    .filter((rule) => rule.isAttachment && rule.movement && rule.file)
    .map((rule) => ({ movement: rule.movement, document: rule.file, quantity: rule.quantity }));
}

function splitMovementNames(value) {
  return String(value || "")
    .split(/[;|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function movementSuggestionOptions() {
  return movementPrefillOptionsFromConfig(config.movement_prefill_options);
}

function rtdCostRowsFromConfig(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const addsKey = normalizeUiKey(row?.addsAnnex ?? row?.adds_annex ?? row?.adicionaAnexo ?? row?.adiciona_anexo);
      return {
        city: String(row?.city || row?.cidade || "").trim(),
        rate: String(row?.rate || row?.fator || "").trim(),
        acceptsPower: String(row?.acceptsPower || row?.accepts_power || row?.aceitaProcuracao || row?.aceita_procuracao || "").trim(),
        addsAnnex: ["NAO", "N", "NO", "FALSE", "0"].includes(addsKey) ? "NÃO" : "SIM"
      };
    })
    .filter((row) => row.city || row.rate || row.acceptsPower);
}

function addRtdCostRow(data = {}) {
  const body = $("#rtdCostsTable tbody");
  if (!body) return;
  const row = document.createElement("tr");
  const cityCell = document.createElement("td");
  const rateCell = document.createElement("td");
  const powerCell = document.createElement("td");
  const annexCell = document.createElement("td");
  const actionCell = document.createElement("td");
  const cityInput = document.createElement("input");
  const rateInput = document.createElement("input");
  const powerSelect = document.createElement("select");
  const annexSelect = document.createElement("select");
  const removeButton = document.createElement("button");

  cityInput.value = data.city || "";
  rateInput.value = data.rate || "";
  fillSelectOptions(powerSelect, yesNoOptions, data.acceptsPower || "");
  fillSelectOptions(annexSelect, yesNoOptions, data.addsAnnex || "SIM");
  removeButton.type = "button";
  removeButton.textContent = "Remover";
  removeButton.addEventListener("click", () => row.remove());

  cityCell.appendChild(cityInput);
  rateCell.appendChild(rateInput);
  powerCell.appendChild(powerSelect);
  annexCell.appendChild(annexSelect);
  actionCell.appendChild(removeButton);
  row.append(cityCell, rateCell, powerCell, annexCell, actionCell);
  body.appendChild(row);
}

function renderRtdCostTable(rows) {
  const body = $("#rtdCostsTable tbody");
  if (!body) return;
  body.innerHTML = "";
  for (const row of rtdCostRowsFromConfig(rows)) addRtdCostRow(row);
}

function readRtdCostTable() {
  return $$("#rtdCostsTable tbody tr")
    .map((row) => {
      const inputs = row.querySelectorAll("input");
      const selects = row.querySelectorAll("select");
      return {
        city: inputs[0]?.value.trim() || "",
        rate: inputs[1]?.value.trim() || "",
        acceptsPower: selects[0]?.value || "",
        addsAnnex: selects[1]?.value || "SIM"
      };
    })
    .filter((row) => row.city);
}

function initConfigSubtabs() {
  $$(".config-subtabs button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".config-subtabs button").forEach((item) => item.classList.remove("active"));
      $$(".config-panel").forEach((panel) => {
        panel.hidden = true;
        panel.classList.remove("active");
      });
      button.classList.add("active");
      const panel = document.getElementById(button.dataset.configPanel);
      if (panel) {
        panel.hidden = false;
        panel.classList.add("active");
      }
    });
  });
}

function parseSignersText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const [name, ...cargo] = line.split("|");
      return { name: String(name || "").trim(), cargo: cargo.join("|").trim() };
    })
    .filter((signer) => signer.name || signer.cargo);
}

function signersToText(signers) {
  return (Array.isArray(signers) ? signers : [])
    .map((signer) => {
      const name = String(signer?.name || "").trim();
      const cargo = String(signer?.cargo || "").trim();
      return cargo ? `${name} | ${cargo}` : name;
    })
    .filter(Boolean)
    .join("\n");
}

function configuredSigners() {
  return Array.isArray(config.signers) ? config.signers.filter((signer) => signer.name || signer.cargo) : [];
}

function signerByName(name) {
  const key = String(name || "").trim().toLocaleUpperCase("pt-BR");
  return configuredSigners().find((signer) => String(signer.name || "").trim().toLocaleUpperCase("pt-BR") === key);
}

function updateDefaultSignerOptions(selectedName = "") {
  const select = $("#default_signature_name");
  if (!select) return;
  const previous = selectedName || select.value || config.default_signature_name || "";
  const signers = parseSignersText($("#signers_text")?.value || signersToText(config.signers));
  select.innerHTML = "";
  select.add(new Option("(sem assinatura padrão)", ""));
  for (const signer of signers) {
    if (signer.name) select.add(new Option(signer.name, signer.name));
  }
  const hasPrevious = Array.from(select.options).some((option) => option.value === previous);
  select.value = hasPrevious ? previous : "";
}

function fillSignerSelect(select, selectedName = "") {
  if (!select) return;
  const preferred = selectedName || select.value || config.default_signature_name || "";
  const signers = configuredSigners();
  select.innerHTML = "";
  select.add(new Option("(sem assinatura)", ""));
  for (const signer of signers) {
    if (signer.name) select.add(new Option(signer.name, signer.name));
  }
  const hasPreferred = Array.from(select.options).some((option) => option.value === preferred);
  select.value = hasPreferred ? preferred : "";
}

function syncSignerCargo(select, input, force = true) {
  if (!select || !input) return;
  const signer = signerByName(select.value);
  if (force || !input.value.trim()) input.value = signer?.cargo || "";
}

function setupSignatureControl(select, input) {
  if (!select || !input) return;
  if (!select.dataset.signatureReady) {
    select.addEventListener("change", () => syncSignerCargo(select, input, true));
    select.dataset.signatureReady = "1";
  }
  fillSignerSelect(select);
  syncSignerCargo(select, input, true);
}

function refreshSignatureControls() {
  setupSignatureControl($("#noteSigner"), $("#noteSignerCargo"));
  setupSignatureControl($("#finalSigner"), $("#finalSignerCargo"));
  $$('[data-field="signerName"]').forEach((select) => {
    const host = select.closest("[data-merge]");
    setupSignatureControl(select, host?.querySelector('[data-field="signerCargo"]'));
  });
}

function signaturePayload(select, input) {
  return {
    signerName: select?.value?.trim() || "",
    signerCargo: input?.value?.trim() || ""
  };
}

function onrCertificateLabel(certificate) {
  const brazil = certificate.pkiBrazil || {};
  const identifier = brazil.cpf || brazil.cnpj || "";
  const expiration = certificate.validityEnd
    ? new Date(certificate.validityEnd).toLocaleDateString("pt-BR")
    : "";
  return [certificate.subjectName || certificate.subjectDN || "Certificado", identifier, expiration ? `válido até ${expiration}` : ""]
    .filter(Boolean)
    .join(" - ");
}

function isUsableOnrCertificate(certificate) {
  const expiration = certificate.validityEnd ? new Date(certificate.validityEnd) : null;
  if (expiration && expiration < new Date()) return false;
  const type = certificate.pkiBrazil?.certificateType || "";
  if (type && type !== "A3") return false;
  if (!type || type === "Unknown") return false;
  const usage = certificate.keyUsage || {};
  if (usage.digitalSignature || usage.nonRepudiation) return true;
  return Object.keys(usage).length === 0;
}

function showOnrCertificateDialog() {
  const dialog = $("#onrCertificateDialog");
  const select = $("#onrCertificateSelect");
  const status = $("#onrCertificateStatus");
  const refreshButton = $("#refreshOnrCertificates");
  const confirmButton = $("#confirmOnrCertificateDialog");
  if (dialog.open) return Promise.resolve(null);

  select.replaceChildren();
  confirmButton.disabled = true;
  status.textContent = "Carregando certificados instalados...";
  dialog.showModal();

  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      dialog.removeEventListener("cancel", handleCancel);
      $("#closeOnrCertificateDialog").removeEventListener("click", handleCancel);
      $("#cancelOnrCertificateDialog").removeEventListener("click", handleCancel);
      confirmButton.removeEventListener("click", handleConfirm);
      select.removeEventListener("change", updateConfirmButton);
      refreshButton.removeEventListener("click", refreshCertificates);
    };
    const finish = (thumbprint) => {
      if (settled) return;
      settled = true;
      cleanup();
      dialog.close();
      resolve(thumbprint);
    };
    const handleCancel = (event) => {
      event?.preventDefault();
      finish(null);
    };
    const updateConfirmButton = () => {
      confirmButton.disabled = !select.value || refreshButton.disabled;
    };
    const handleConfirm = () => {
      if (select.value) finish(select.value);
    };
    const refreshCertificates = async () => {
      refreshButton.disabled = true;
      confirmButton.disabled = true;
      status.textContent = "Carregando certificados instalados...";
      select.replaceChildren();
      try {
        const certificates = (await window.execej.listOnrCertificates()).filter(isUsableOnrCertificate);
        select.add(new Option(certificates.length ? "Selecione um certificado" : "Nenhum certificado válido encontrado", ""));
        for (const certificate of certificates) {
          if (certificate.thumbprint) select.add(new Option(onrCertificateLabel(certificate), certificate.thumbprint));
        }
        status.textContent = certificates.length
          ? `${certificates.length} certificado(s) disponível(is).`
          : "Conecte ou instale um certificado A3 válido e atualize a lista.";
      } catch (error) {
        const message = error.message || String(error);
        status.textContent = message;
        log(message);
        select.add(new Option("Não foi possível carregar os certificados", ""));
      } finally {
        refreshButton.disabled = false;
        updateConfirmButton();
      }
    };
    dialog.addEventListener("cancel", handleCancel);
    $("#closeOnrCertificateDialog").addEventListener("click", handleCancel);
    $("#cancelOnrCertificateDialog").addEventListener("click", handleCancel);
    confirmButton.addEventListener("click", handleConfirm);
    select.addEventListener("change", updateConfirmButton);
    refreshButton.addEventListener("click", refreshCertificates);
    refreshCertificates();
  });
}

async function addOnrCertificateForSignature(payload) {
  if (!config.onr_signature_enabled || !payload.signerName) return payload;
  if (!String(config.onr_api_key || "").trim()) {
    alert("Informe a X-Api-Key da ONR nas configurações.");
    return null;
  }
  const certificateThumbprint = await showOnrCertificateDialog();
  return certificateThumbprint ? { ...payload, certificateThumbprint } : null;
}

function fillConfig() {
  for (const key of configKeys()) {
    const input = document.getElementById(key);
    if (input) input.value = config[key] || "";
  }
  renderMovementRules(config);
  renderMovementPrefillOptions(config.movement_prefill_options);
  renderRtdCostTable(config.rtd_cost_table);
  if ($("#signers_text")) $("#signers_text").value = signersToText(config.signers);
  updateDefaultSignerOptions(config.default_signature_name);
  $("#onr_signature_enabled").checked = Boolean(config.onr_signature_enabled);
  $("#onr_api_key").value = config.onr_api_key || "";
  $("#onrApiKeySetting").hidden = !config.onr_signature_enabled;
  $("#image_autuation_enabled").checked = Boolean(config.image_autuation_enabled);
  $("#imageExportSettings").hidden = !config.image_autuation_enabled;
  const imageFormat = config.image_output_format === "pdf" ? "pdf" : "tiff";
  $(`input[name="image_output_format"][value="${imageFormat}"]`).checked = true;
  $("#image_output_bucket_size").value = config.image_output_bucket_size || 1000;
  $("#image_output_folder_pattern").value = config.image_output_folder_pattern || "{<0^8}.{FAIXA}";
  $("#image_output_filename").value = config.image_output_filename || "{<0^8}.{PRENOT}";
  $("#noteModel").value = config.note_requirement_model || "";
  $("#attachSheet").value = config.movements_sheet || "Movimentações";
  updateArispSearchRoot();
  refreshSignatureControls();
}

function readConfig() {
  const data = {};
  for (const key of configKeys()) data[key] = document.getElementById(key).value.trim();
  data.notifications_name_col = data.notifications_name_col.toUpperCase();
  data.certificate_name_col = data.certificate_name_col.toUpperCase();
  data.movement_document_rules = readMovementDocumentRules();
  data.movement_attachment_rules = readMovementRules();
  data.movement_prefill_options = readMovementPrefillOptions();
  data.rtd_cost_table = readRtdCostTable();
  data.signers = parseSignersText($("#signers_text")?.value || "");
  data.default_signature_name = $("#default_signature_name")?.value?.trim() || "";
  data.onr_signature_enabled = $("#onr_signature_enabled").checked;
  data.onr_api_key = $("#onr_api_key").value.trim();
  data.image_autuation_enabled = $("#image_autuation_enabled").checked;
  data.image_output_format = $('input[name="image_output_format"]:checked')?.value || "tiff";
  data.image_output_bucket_size = Number($("#image_output_bucket_size").value);
  data.image_output_folder_pattern = $("#image_output_folder_pattern").value.trim();
  data.image_output_filename = $("#image_output_filename").value.trim();
  const defaultSigner = data.signers.find((signer) => signer.name === data.default_signature_name);
  data.default_signature_cargo = defaultSigner?.cargo || "";
  return data;
}

function selectedProtocol() {
  return protocols.find((protocol) => protocol.id === selectedProtocolId) || null;
}

function protocolBaseDir(protocol) {
  return protocol?.folderPath || (protocol?.odsPath ? protocol.odsPath.replace(/[\\/][^\\/]+$/, "") : "");
}

function cloneSheetRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => trimSheetRowCells((Array.isArray(row) ? row : []).map((cell) => String(cell ?? ""))));
}

function trimSheetRowCells(row, minCols = 1) {
  const cloned = Array.isArray(row) ? [...row] : [];
  while (cloned.length > minCols && !String(cloned[cloned.length - 1] ?? "").trim()) cloned.pop();
  return cloned.length ? cloned : [""];
}

function effectiveSheetColumnCount(rows, minCols = 1) {
  let count = 0;
  for (const row of rows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (String(row[index] ?? "").trim()) {
        count = Math.max(count, index + 1);
        break;
      }
    }
  }
  return Math.max(count, minCols);
}

function protocolSheetKey(sheetName) {
  const normalized = normalizeSheetMatch(sheetName);
  const match = Object.keys(calculatedProtocolColumnKeys).find((key) => normalizeSheetMatch(key) === normalized);
  return match || normalizeUiKey(sheetName);
}

function isCustasSheet(sheetName) {
  return normalizeSheetMatch(sheetName) === normalizeSheetMatch("Custas Intimação");
}

function sheetHeaderRowIndex(sheetName, rows) {
  if (protocolSheetKey(sheetName) === "MOVIMENTACOES") {
    const completeHeaderIndex = rows.findIndex((row) => {
      const keys = row.map(normalizeUiKey);
      return keys.includes("MOVIMENTACAO") && (keys.includes("DATA") || keys.includes("NOME_ARQUIVO"));
    });
    if (completeHeaderIndex >= 0) return completeHeaderIndex;
    const movementHeaderIndex = rows.findIndex((row) => row.some((cell) => normalizeUiKey(cell) === "MOVIMENTACAO"));
    return movementHeaderIndex >= 0 ? movementHeaderIndex : 1;
  }
  return 0;
}

function editableProtocolSheetColumns(sheetName, rows) {
  const colCount = effectiveSheetColumnCount(rows, 1);
  const headers = rows[sheetHeaderRowIndex(sheetName, rows)] || [];
  const hidden = calculatedProtocolColumnKeys[protocolSheetKey(sheetName)] || new Set();
  const sheetKey = protocolSheetKey(sheetName);
  const columns = [];
  for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
    const header = headers[colIndex] || "";
    const headerKey = normalizeUiKey(header);
    if (sheetKey === "EXTRACAO_DE_ARQUIVOS" && headerKey === "PRENOTACAO" && !String(header).includes("?")) continue;
    if (header && hidden.has(normalizeUiKey(header))) continue;
    columns.push(colIndex);
  }
  return columns.length ? columns : [0];
}

function isProtocolSheetStructureRow(sheetName, rowIndex, headerRowIndex = -1) {
  const headerIndex = headerRowIndex >= 0 ? headerRowIndex : sheetHeaderRowIndex(sheetName, []);
  if (protocolSheetKey(sheetName) === "MOVIMENTACOES") return rowIndex <= headerIndex;
  return rowIndex === headerIndex;
}

function removeBlankHeaderColumns(sheetName, rows) {
  const cloned = cloneSheetRows(rows);
  const headerRowIndex = sheetHeaderRowIndex(sheetName, cloned);
  const headers = cloned[headerRowIndex] || [];
  if (!headers.some((header) => String(header || "").trim())) return cloned;
  const colCount = effectiveSheetColumnCount(cloned, 1);
  const remove = [];
  for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
    if (String(headers[colIndex] || "").trim()) continue;
    const hasContent = cloned.some((row) => String(row[colIndex] || "").trim());
    if (!hasContent) remove.push(colIndex);
  }
  if (!remove.length) return cloned;
  const removeSet = new Set(remove);
  return cloned.map((row) => trimSheetRowCells(row.filter((_, colIndex) => !removeSet.has(colIndex))));
}

function sheetColumnHeader(rows, headerRowIndex, colIndex) {
  return String(rows[headerRowIndex]?.[colIndex] || "").trim();
}

function sheetHeaderColumnIndex(rows, headerRowIndex, names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(normalizeUiKey);
  const headers = rows[headerRowIndex] || [];
  return headers.findIndex((header) => wanted.includes(normalizeUiKey(header)));
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    const key = normalizeUiKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function parsePtNumber(value) {
  const text = String(value || "").replace(/R\$/gi, "").replace(/\s+/g, "").trim();
  if (!text) return 0;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrency(value) {
  return `R$ ${roundCurrency(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function notificationNameOptions(protocol = selectedProtocol()) {
  const sheetName = protocolSheetNames(protocol).find((name) => protocolSheetKey(name) === "NOTIFICACOES");
  if (!sheetName) return [];
  const rows = removeBlankHeaderColumns(sheetName, protocol?.sheets?.[sheetName] || [[]]);
  const headerIndex = sheetHeaderRowIndex(sheetName, rows);
  const nameIndex = sheetHeaderColumnIndex(rows, headerIndex, ["NOME"]);
  if (nameIndex < 0) return [];
  return uniqueNonEmpty(rows.slice(headerIndex + 1).map((row) => row[nameIndex]));
}

function isMovementCell(sheetName, rows, rowIndex, colIndex) {
  const headerIndex = sheetHeaderRowIndex(sheetName, rows);
  if (rowIndex <= headerIndex) return false;
  if (protocolSheetKey(sheetName) !== "MOVIMENTACOES") return false;
  return normalizeUiKey(sheetColumnHeader(rows, headerIndex, colIndex)) === "MOVIMENTACAO";
}

function ensureMovementDatalist() {
  let list = document.getElementById("movementOptionsList");
  if (!list) {
    list = document.createElement("datalist");
    list.id = "movementOptionsList";
    document.body.appendChild(list);
  }
  list.innerHTML = "";
  for (const option of movementSuggestionOptions()) {
    const item = document.createElement("option");
    item.value = option;
    list.appendChild(item);
  }
  return list.id;
}

function protocolSheetCellOptions(sheetName, rows, rowIndex, colIndex, protocol = selectedProtocol()) {
  const headerIndex = sheetHeaderRowIndex(sheetName, rows);
  if (rowIndex <= headerIndex) return null;
  const sheetKey = protocolSheetKey(sheetName);
  const headerText = sheetColumnHeader(rows, headerIndex, colIndex);
  const headerKey = normalizeUiKey(headerText);
  if (sheetKey === "EXTRACAO_DE_ARQUIVOS" && headerKey === "PRENOTACAO" && headerText.includes("?")) return yesNoOptions;
  if (["NOTIFICACOES", "INTIMACAO"].includes(sheetKey) && headerKey === "SEXO") return sexOptions;
  if (sheetKey === "INTIMACAO" && ["TIPO_NOTIFICACAO", "TIPO_DE_NOTIFICACAO", "TIPO_INTIMACAO", "TIPO_DE_INTIMACAO"].includes(headerKey)) return intimationTypeOptions;
  if (sheetKey === "INTIMACAO" && headerKey === "NOME") return notificationNameOptions(protocol);
  if (sheetKey === "INTIMACAO" && headerKey === "RESULTADO") return intimationResultOptions;
  if (["TRANSCURSO_DE_PRAZO", "CONSOLIDACAO"].includes(sheetKey) && headerKey === "TIPO_DE_INTIMACAO") return intimationTypeOptions;
  if (sheetKey === "TABELA_DE_CUSTAS_RTD" && headerKey === "ACEITA_PROCURACAO") return noYesOptions;
  if (sheetKey === "CUSTAS_INTIMACAO" && ((rowIndex === 4 && colIndex === 7) || (rowIndex === 5 && colIndex === 6))) return yesNoOptions;
  return null;
}

function fillSelectOptions(select, options, value) {
  select.innerHTML = "";
  select.add(new Option("", ""));
  const optionValues = uniqueNonEmpty(options);
  const current = String(value || "").trim();
  if (current && !optionValues.some((option) => normalizeUiKey(option) === normalizeUiKey(current))) optionValues.unshift(current);
  for (const option of optionValues) select.add(new Option(option, option));
  select.value = current;
}

function createProtocolSheetCellEditor(sheetName, rows, rowIndex, colIndex) {
  const value = rows[rowIndex]?.[colIndex] || "";
  const options = protocolSheetCellOptions(sheetName, rows, rowIndex, colIndex);
  const editor = options ? document.createElement("select") : document.createElement("input");
  editor.dataset.rowIndex = String(rowIndex);
  editor.dataset.colIndex = String(colIndex);
  if (options) fillSelectOptions(editor, options, value);
  else editor.value = value;
  if (!options && isMovementCell(sheetName, rows, rowIndex, colIndex)) {
    editor.setAttribute("list", ensureMovementDatalist());
    editor.placeholder = "Digite ou selecione a movimentacao";
  }
  editor.addEventListener("focus", () => setProtocolSheetSelection(rowIndex, colIndex));
  editor.addEventListener("click", () => setProtocolSheetSelection(rowIndex, colIndex));
  editor.addEventListener("input", () => scheduleProtocolAutosave());
  editor.addEventListener("change", () => scheduleProtocolAutosave());
  return editor;
}

function ensureSheetCell(rows, rowIndex, colIndex, value = "") {
  while (rows.length <= rowIndex) rows.push([]);
  while (rows[rowIndex].length <= colIndex) rows[rowIndex].push("");
  if (value !== undefined && !rows[rowIndex][colIndex]) rows[rowIndex][colIndex] = value;
}

function custasRowsWithStructure(sourceRows) {
  const rows = cloneSheetRows(sourceRows);
  const cells = [
    [1, 1, "PLANILHA DE CUSTAS PARA NOTIFICAÇÃO DA LEI Nº 9.514/97"],
    [2, 1, "DILIGÊNCIA"], [2, 2, "RTD"], [2, 4, "ANEXOS"], [2, 5, "QTD ANEXOS"], [2, 6, "DESMATERIALIZAÇÃO"], [2, 7, "PROCURAÇÃO"],
    [3, 2, "REGISTRO"], [3, 3, "MICROFILME"],
    [6, 1, "NOME"], [6, 3, "ENDEREÇO"], [6, 7, "PROCURAÇÃO"],
    [7, 3, "ENDEREÇO"], [7, 6, "CIDADE/ESTADO"]
  ];
  for (const [row, col, value] of cells) ensureSheetCell(rows, row, col, value);
  return rows;
}

function custasEditorField(rowIndex, colIndex, value, options = null) {
  const field = options ? document.createElement("select") : document.createElement("input");
  field.dataset.rowIndex = String(rowIndex);
  field.dataset.colIndex = String(colIndex);
  field.className = "custas-field";
  if (options) fillSelectOptions(field, options, value);
  else field.value = value || "";
  field.addEventListener("focus", () => setProtocolSheetSelection(rowIndex, colIndex));
  field.addEventListener("click", () => setProtocolSheetSelection(rowIndex, colIndex));
  field.addEventListener("input", () => scheduleProtocolAutosave());
  field.addEventListener("change", () => scheduleProtocolAutosave());
  return field;
}

function renderCustasSheet(rows) {
  const host = $("#protocolSheetCustom");
  const table = $("#protocolSheetTable");
  if (!host || !table) return;
  table.hidden = true;
  host.hidden = false;
  host.innerHTML = "";
  const structured = custasRowsWithStructure(rows);

  const baseTitle = document.createElement("div");
  baseTitle.className = "section-title";
  baseTitle.textContent = "Bases de cálculo";
  host.appendChild(baseTitle);

  const baseTable = document.createElement("table");
  baseTable.className = "sheet-table custas-table";
  baseTable.innerHTML = `
    <thead>
      <tr>
        <th>Diligência</th>
        <th>RTD Registro</th>
        <th>RTD Microfilme</th>
        <th>Anexos</th>
        <th>Qtd. Anexos</th>
        <th>Desmaterialização</th>
        <th>Procuração</th>
      </tr>
    </thead>
  `;
  const baseBody = document.createElement("tbody");
  const baseRow = document.createElement("tr");
  [
    [4, 1, null],
    [4, 2, null],
    [4, 3, null],
    [4, 4, null],
    [4, 5, null],
    [4, 6, null],
    [4, 7, yesNoOptions]
  ].forEach(([rowIndex, colIndex, options]) => {
    const td = document.createElement("td");
    td.appendChild(custasEditorField(rowIndex, colIndex, structured[rowIndex]?.[colIndex] || "", options));
    baseRow.appendChild(td);
  });
  baseBody.appendChild(baseRow);
  baseTable.appendChild(baseBody);
  host.appendChild(baseTable);

  const entriesTitle = document.createElement("div");
  entriesTitle.className = "section-title custas-section-title";
  entriesTitle.textContent = "Intimações";
  host.appendChild(entriesTitle);

  const entryTable = document.createElement("table");
  entryTable.className = "sheet-table custas-table";
  entryTable.innerHTML = `
    <thead>
      <tr>
        <th>Nome</th>
        <th>Endereço</th>
        <th>Cidade/Estado</th>
        <th>Procuração</th>
      </tr>
    </thead>
  `;
  const entryBody = document.createElement("tbody");
  let lastRow = structured.length - 1;
  while (lastRow >= 8 && ![1, 2, 3, 4, 5, 6, 7].some((col) => String(structured[lastRow]?.[col] || "").trim())) lastRow -= 1;
  const endRow = Math.max(lastRow + 1, 8);
  for (let rowIndex = 8; rowIndex <= endRow; rowIndex += 1) {
    const tr = document.createElement("tr");
    [1, 3, 6].forEach((colIndex) => {
      const td = document.createElement("td");
      td.appendChild(custasEditorField(rowIndex, colIndex, structured[rowIndex]?.[colIndex] || ""));
      tr.appendChild(td);
    });
    const procuraTd = document.createElement("td");
    const procuraField = custasEditorField(rowIndex, 7, structured[rowIndex]?.[7] || "", yesNoOptions);
    procuraField.disabled = true;
    procuraTd.appendChild(procuraField);
    tr.appendChild(procuraTd);
    entryBody.appendChild(tr);
  }
  entryTable.appendChild(entryBody);
  host.appendChild(entryTable);
  const totalsHost = document.createElement("div");
  totalsHost.id = "custasTotals";
  host.appendChild(totalsHost);
  host.querySelectorAll(".custas-field").forEach((field) => {
    field.addEventListener("input", updateCustasPreview);
    field.addEventListener("change", updateCustasPreview);
  });
  updateCustasPreview();
  updateProtocolSheetSelection();
}

function readCustasEditor(sourceRows) {
  const rows = custasRowsWithStructure(sourceRows);
  $("#protocolSheetCustom")?.querySelectorAll("input[data-col-index], select[data-col-index]").forEach((field) => {
    const rowIndex = Number(field.dataset.rowIndex);
    const colIndex = Number(field.dataset.colIndex);
    ensureSheetCell(rows, rowIndex, colIndex, "");
    rows[rowIndex][colIndex] = field.value;
  });
  for (let rowIndex = 8; rowIndex < rows.length; rowIndex += 1) {
    ensureSheetCell(rows, rowIndex, 7, "");
    rows[rowIndex][2] = "";
    rows[rowIndex][4] = "";
    rows[rowIndex][5] = "";
  }
  while (rows.length > 9 && ![1, 2, 3, 4, 5, 6, 7].some((col) => String(rows[rows.length - 1]?.[col] || "").trim())) rows.pop();
  return rows.map((row) => trimSheetRowCells(row));
}

function protocolSheetByKey(key, protocol = selectedProtocol()) {
  const name = protocolSheetNames(protocol).find((sheetName) => protocolSheetKey(sheetName) === key);
  return name ? cloneSheetRows(protocol?.sheets?.[name] || [[]]) : [[]];
}

function custasCityLookup(protocol = selectedProtocol()) {
  const configuredRows = rtdCostRowsFromConfig(config.rtd_cost_table);
  const protocolRows = protocolSheetByKey("TABELA_DE_CUSTAS_RTD", protocol);
  const rows = configuredRows.length
    ? [["Cidade", "Fator", "Aceita Procuração", "Adiciona Anexo?"], ...configuredRows.map((row) => [row.city, row.rate, row.acceptsPower, row.addsAnnex])]
    : protocolRows;
  const lookup = new Map();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const city = String(rows[rowIndex]?.[0] || "").trim();
    if (!city) continue;
    lookup.set(normalizeUiKey(city), {
      city,
      rate: parsePtNumber(rows[rowIndex]?.[1]),
      acceptsPower: String(rows[rowIndex]?.[2] || "").trim(),
      addsAnnex: yesNoToBoolean(rows[rowIndex]?.[3], !isCityWithoutExtraAnnex(city))
    });
  }
  return lookup;
}

function custasCityInfo(lookup, city) {
  return lookup.get(normalizeUiKey(city)) || { city, rate: 0, acceptsPower: "", addsAnnex: !isCityWithoutExtraAnnex(city) };
}

function isTremembeCity(city) {
  return ["TREMEMBE_SP", "TREMEMBE"].includes(normalizeUiKey(city));
}

function isCityWithoutExtraAnnex(city) {
  return [
    "TREMEMBE_SP",
    "TREMEMBE",
    "SAO_JOSE_DOS_CAMPOS_SP",
    "SAO_JOSE_DOS_CAMPOS"
  ].includes(normalizeUiKey(city));
}

function yesNoToBoolean(value, fallback = true) {
  const key = normalizeUiKey(value);
  if (["SIM", "S", "YES", "TRUE", "1"].includes(key)) return true;
  if (["NAO", "N", "NO", "FALSE", "0"].includes(key)) return false;
  return fallback;
}

function calculateCustasSummary(rows, protocol = selectedProtocol()) {
  const lookup = custasCityLookup(protocol);
  const diligenceValue = parsePtNumber(rows[4]?.[1]);
  const registrationValue = parsePtNumber(rows[4]?.[2]);
  const microfilmValue = parsePtNumber(rows[4]?.[3]);
  const annexValue = parsePtNumber(rows[4]?.[4]);
  const annexCount = parsePtNumber(rows[4]?.[5]);
  const dematerializationValue = parsePtNumber(rows[4]?.[6]);
  const powerDeductionEnabled = normalizeUiKey(rows[4]?.[7]) === "SIM";
  const seenAddresses = new Set();
  const entries = [];
  for (let rowIndex = 8; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const name = String(row[1] || "").trim();
    const address = String(row[3] || "").trim();
    const city = String(row[6] || "").trim();
    if (!name && !address && !city) continue;
    const cityInfo = custasCityInfo(lookup, city);
    const addressKey = normalizeUiKey(address || `${name}-${city}`);
    const firstAddress = addressKey && !seenAddresses.has(addressKey);
    if (addressKey) seenAddresses.add(addressKey);
    entries.push({ rowIndex, name, address, city, firstAddress, rate: cityInfo.rate, acceptsPower: cityInfo.acceptsPower, addsAnnex: cityInfo.addsAnnex });
  }
  const countedDiligence = entries.filter((entry) => !(
    powerDeductionEnabled && !entry.firstAddress && normalizeUiKey(entry.acceptsPower) === "SIM"
  ));
  const general = {
    diligence: countedDiligence.length * diligenceValue,
    rtd: entries.reduce((sum, entry) => sum + roundCurrency(registrationValue * entry.rate) + roundCurrency(microfilmValue * entry.rate), 0),
    annex: entries.reduce((sum, entry) => sum + roundCurrency((entry.addsAnnex ? annexCount + 1 : annexCount) * annexValue * entry.rate), 0),
    dematerialization: entries.filter((entry) => !isTremembeCity(entry.city)).length * dematerializationValue
  };
  general.total = general.diligence + general.rtd + general.annex + general.dematerialization;
  const cities = uniqueNonEmpty(entries.map((entry) => entry.city));
  const byCity = cities.map((city) => {
    const cityEntries = entries.filter((entry) => normalizeUiKey(entry.city) === normalizeUiKey(city));
    const cityInfo = custasCityInfo(lookup, city);
    const cityDiligenceEntries = cityEntries.filter((entry) => !(
      powerDeductionEnabled && !entry.firstAddress && normalizeUiKey(entry.acceptsPower) === "SIM"
    ));
    const summary = {
      city,
      diligence: cityDiligenceEntries.length * diligenceValue,
      rtd: cityEntries.length * (roundCurrency(registrationValue * cityInfo.rate) + roundCurrency(microfilmValue * cityInfo.rate)),
      annex: cityEntries.length * roundCurrency((cityInfo.addsAnnex ? annexCount + 1 : annexCount) * annexValue * cityInfo.rate),
      dematerialization: isTremembeCity(city) ? 0 : cityEntries.length * dematerializationValue
    };
    summary.total = summary.diligence + summary.rtd + summary.annex + summary.dematerialization;
    return summary;
  });
  return { entries, general, byCity };
}

function appendCustasSummaryTable(host, title, columns, rows) {
  const sectionTitle = document.createElement("div");
  sectionTitle.className = "section-title custas-section-title";
  sectionTitle.textContent = title;
  host.appendChild(sectionTitle);
  const table = document.createElement("table");
  table.className = "sheet-table custas-table custas-summary-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  host.appendChild(table);
}

function renderCustasSummaries(summary) {
  const host = $("#custasTotals");
  if (!host) return;
  host.innerHTML = "";
  const labels = [
    ["Diligências", summary.general.diligence],
    ["RTD", summary.general.rtd],
    ["Anexos", summary.general.annex],
    ["Desmaterialização", summary.general.dematerialization],
    ["Total", summary.general.total]
  ];
  appendCustasSummaryTable(host, "Totais gerais", ["Item", "Valor"], labels.map(([label, value]) => [label, formatCurrency(value)]));
  appendCustasSummaryTable(
    host,
    "Totais por cidade",
    ["Cidade", "Diligências", "RTD", "Anexos", "Desmaterialização", "Total"],
    summary.byCity.map((item) => [
      item.city,
      formatCurrency(item.diligence),
      formatCurrency(item.rtd),
      formatCurrency(item.annex),
      formatCurrency(item.dematerialization),
      formatCurrency(item.total)
    ])
  );
}

function updateCustasPreview() {
  if (!isCustasSheet(selectedProtocolSheetName) || $("#protocolSheetCustom")?.hidden) return;
  const protocol = selectedProtocol();
  const rows = readCustasEditor(protocol?.sheets?.[selectedProtocolSheetName] || [[]]);
  const summary = calculateCustasSummary(rows, protocol);
  for (const entry of summary.entries) {
    const field = $(`#protocolSheetCustom [data-row-index="${entry.rowIndex}"][data-col-index="7"]`);
    if (field) {
      fillSelectOptions(field, yesNoOptions, entry.acceptsPower || "");
      field.disabled = true;
    }
  }
  renderCustasSummaries(summary);
}

function setProtocolSheetSelection(rowIndex = -1, colIndex = -1) {
  selectedProtocolSheetRow = Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : -1;
  selectedProtocolSheetColumn = Number.isFinite(Number(colIndex)) ? Number(colIndex) : -1;
  updateProtocolSheetSelection();
}

function updateProtocolSheetSelection() {
  const root = isCustasSheet(selectedProtocolSheetName) ? $("#protocolSheetCustom") : $("#protocolSheetTable");
  if (!root) return;
  root.querySelectorAll(".selected-row, .selected-column, .selected-cell").forEach((node) => {
    node.classList.remove("selected-row", "selected-column", "selected-cell");
  });
  root.querySelectorAll(`[data-row-index="${selectedProtocolSheetRow}"]`).forEach((node) => node.classList.add("selected-row"));
  root.querySelectorAll(`[data-col-index="${selectedProtocolSheetColumn}"]`).forEach((node) => node.classList.add("selected-column"));
  root.querySelectorAll(`[data-row-index="${selectedProtocolSheetRow}"][data-col-index="${selectedProtocolSheetColumn}"]`).forEach((node) => node.classList.add("selected-cell"));
  const rowButton = $("#deleteSheetRow");
  const columnButton = $("#deleteSheetColumn");
  const custas = isCustasSheet(selectedProtocolSheetName);
  const movementSheet = protocolSheetKey(selectedProtocolSheetName) === "MOVIMENTACOES";
  const addColumnButton = $("#addSheetColumn");
  if (rowButton) rowButton.disabled = selectedProtocolSheetRow < 0 || (custas && selectedProtocolSheetRow < 8);
  if (columnButton) columnButton.disabled = selectedProtocolSheetColumn < 0 || custas || movementSheet;
  if (addColumnButton) addColumnButton.disabled = custas || movementSheet;
}

function protocolSheetNames(protocol = selectedProtocol()) {
  const order = Array.isArray(protocol?.sheetOrder) ? protocol.sheetOrder : [];
  const sheets = protocol?.sheets && typeof protocol.sheets === "object" ? protocol.sheets : {};
  return [...new Set([...order, ...Object.keys(sheets)])].filter(Boolean);
}

function currentProtocolWorkbook() {
  const protocol = selectedProtocol();
  const sheetOrder = protocolSheetNames(protocol);
  const sheets = {};
  for (const name of sheetOrder) sheets[name] = removeBlankHeaderColumns(name, protocol?.sheets?.[name] || [[]]);
  return { sheetOrder, sheets };
}

function readSheetTable() {
  const protocol = selectedProtocol();
  if (isCustasSheet(selectedProtocolSheetName) && !$("#protocolSheetCustom")?.hidden) {
    return readCustasEditor(protocol?.sheets?.[selectedProtocolSheetName] || [[]]);
  }
  const sourceRows = removeBlankHeaderColumns(selectedProtocolSheetName, protocol?.sheets?.[selectedProtocolSheetName] || [[]]);
  const rows = cloneSheetRows(sourceRows.length ? sourceRows : [[]]);
  $$("#protocolSheetTable tbody tr").forEach((tr, renderedRowIndex) => {
    const rowIndex = Number(tr.dataset.rowIndex || renderedRowIndex);
    while (rows.length <= rowIndex) rows.push([""]);
    const row = rows[rowIndex];
    tr.querySelectorAll("input[data-col-index], select[data-col-index]").forEach((field) => {
      const colIndex = Number(field.dataset.colIndex);
      while (row.length <= colIndex) row.push("");
      row[colIndex] = field.value;
    });
  });
  const compacted = rows.map((row) => trimSheetRowCells(row));
  while (compacted.length > 1 && !compacted[compacted.length - 1].some((cell) => cell.trim())) compacted.pop();
  return removeBlankHeaderColumns(selectedProtocolSheetName, compacted.length ? compacted : [[]]);
}

function persistVisibleSheetToMemory() {
  const protocol = selectedProtocol();
  if (!protocol || !selectedProtocolSheetName || !$("#protocolSheetTable tbody")) return;
  protocol.sheets ||= {};
  protocol.sheetOrder ||= protocolSheetNames(protocol);
  protocol.sheets[selectedProtocolSheetName] = readSheetTable();
  if (!protocol.sheetOrder.includes(selectedProtocolSheetName)) protocol.sheetOrder.push(selectedProtocolSheetName);
}

function protocolDisplayLabel(protocol) {
  if (!protocol) return "";
  const name = String(protocol.name || "").trim();
  if (name && !(name === "Rascunho" && (protocol.officeProtocol || protocol.prenotation))) return name;
  if (protocol.officeProtocol && protocol.prenotation) return `Protocolo ${protocol.officeProtocol} - ${protocol.prenotation}`;
  if (protocol.officeProtocol) return `Rascunho ${protocol.officeProtocol}`;
  if (protocol.label) return protocol.label;
  return "Rascunho";
}

function protocolPayload() {
  const protocol = selectedProtocol();
  return {
    protocolId: protocol?.id || "",
    protocolName: $("#protocolName")?.value?.trim() || protocol?.name || "",
    officeProtocol: $("#protocolOffice")?.value?.trim() || protocol?.officeProtocol || "",
    prenotation: $("#protocolPrenotation")?.value?.trim() || protocol?.prenotation || "",
    protocolFolder: $("#protocolFolder")?.value?.trim() || protocolBaseDir(protocol)
  };
}

function readProtocolForm() {
  const current = selectedProtocol();
  persistVisibleSheetToMemory();
  const workbook = currentProtocolWorkbook();
  return {
    id: current?.id || "",
    name: $("#protocolName").value.trim(),
    officeProtocol: $("#protocolOffice").value.trim(),
    prenotation: $("#protocolPrenotation").value.trim(),
    odsPath: $("#protocolOds").value.trim(),
    folderPath: $("#protocolFolder").value.trim(),
    autuacoesMovimentacoes: current?.autuacoesMovimentacoes || {},
    sheetOrder: workbook.sheetOrder,
    sheets: workbook.sheets
  };
}

function setProtocolAutosaveStatus(text, state = "") {
  const status = $("#protocolAutosaveStatus");
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state;
}

function performProtocolAutosave() {
  if (!selectedProtocol()) return Promise.resolve();
  if (protocolAutosaveInFlight) {
    protocolAutosaveQueued = true;
    return protocolAutosavePromise;
  }
  protocolAutosaveInFlight = true;
  protocolAutosaveQueued = false;
  setProtocolAutosaveStatus("Salvando...", "saving");
  protocolAutosavePromise = (async () => {
    try {
      const saved = await window.execej.saveProtocol(readProtocolForm());
      const index = protocols.findIndex((protocol) => protocol.id === saved.id);
      if (index >= 0) protocols[index] = saved;
      else protocols.unshift(saved);
      selectedProtocolId = saved.id;
      setProtocolAutosaveStatus("Salvo automaticamente", "saved");
      renderProtocols();
    } catch (error) {
      setProtocolAutosaveStatus("Falha ao salvar automaticamente", "error");
      log(error.message || String(error));
    } finally {
      protocolAutosaveInFlight = false;
      if (protocolAutosaveQueued) scheduleProtocolAutosave(150);
    }
  })();
  return protocolAutosavePromise;
}

function scheduleProtocolAutosave(delay = 650) {
  if (!selectedProtocol()) return;
  clearTimeout(protocolAutosaveTimer);
  setProtocolAutosaveStatus("Alterações pendentes...", "pending");
  protocolAutosaveTimer = setTimeout(() => {
    performProtocolAutosave();
  }, delay);
}

function scheduleProtocolFileRefresh(delay = 300) {
  clearTimeout(protocolFileRefreshTimer);
  protocolFileRefreshTimer = setTimeout(() => refreshProtocolFiles(), delay);
}

function applyProtocol(protocol) {
  const path = protocol?.odsPath || "";
  const baseDir = protocolBaseDir(protocol);
  currentProtocol = path;
  if ($("#noteOds")) $("#noteOds").value = path;
  if ($("#noteOutput")) $("#noteOutput").value = baseDir ? `${baseDir}\\Nota de Exigência` : "";
  if ($("#attachOds")) $("#attachOds").value = path;
  if ($("#initialOfficeProtocol")) $("#initialOfficeProtocol").value = protocol?.officeProtocol || "";
  if ($("#initialPrenotation")) $("#initialPrenotation").value = protocol?.prenotation || "";
  initMerge("letters", {
    odsPath: path,
    outputDir: baseDir ? `${baseDir}\\intimacoes` : ""
  });
  initMerge("certificate", {
    odsPath: path,
    outputDir: baseDir ? `${baseDir}\\certidoes_transcurso` : ""
  });
  scheduleProtocolFileRefresh();
}

function protocolFolderForSidebar() {
  return $("#protocolFolder")?.value?.trim() || selectedProtocol()?.folderPath || protocolBaseDir(selectedProtocol());
}

function fileExtension(filePath) {
  const name = String(filePath || "").split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function localFileUrl(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return `file:///${normalized.split("/").map((part, index) => {
    if (index === 0 && /^[A-Za-z]:$/.test(part)) return part;
    return encodeURIComponent(part);
  }).join("/")}`;
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function closeProtocolFilePreview() {
  const host = $("#protocolFilePreview");
  const content = $("#protocolContentArea");
  if (host) {
    host.hidden = true;
    host.innerHTML = "Selecione um arquivo para visualizar.";
    host.className = "file-preview file-preview-main empty-state";
  }
  if (content) content.hidden = false;
}

function toggleProtocolFileSidebar() {
  const workspace = $(".protocol-workspace");
  const toggle = $("#toggleProtocolFiles");
  if (!workspace || !toggle) return;
  const isExpanded = workspace.classList.toggle("files-collapsed") === false;
  const label = isExpanded ? "Recolher arquivos do protocolo" : "Expandir arquivos do protocolo";
  toggle.setAttribute("aria-expanded", String(isExpanded));
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
}

function previewProtocolFile(item) {
  const host = $("#protocolFilePreview");
  if (!host || !item || item.type !== "file") return;
  const content = $("#protocolContentArea");
  const ext = fileExtension(item.name);
  const url = localFileUrl(item.path);
  const previewableImages = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
  const previewableVideos = ["mp4", "webm", "ogg", "mov"];
  const previewableAudio = ["mp3", "wav", "ogg", "m4a"];
  const previewableText = ["txt", "csv", "log", "json", "xml", "html", "htm"];
  if (content) content.hidden = true;
  host.hidden = false;
  host.className = "file-preview file-preview-main";
  host.innerHTML = "";

  const header = document.createElement("div");
  header.className = "file-preview-header";
  const title = document.createElement("div");
  title.innerHTML = `<strong>${item.name}</strong><span>${formatFileSize(item.size)}</span>`;
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "Voltar às abas";
  backButton.addEventListener("click", closeProtocolFilePreview);
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.textContent = "Abrir";
  openButton.addEventListener("click", () => window.execej.openPath(item.path));
  const actions = document.createElement("div");
  actions.className = "file-preview-actions";
  actions.append(backButton, openButton);
  header.append(title, actions);
  host.appendChild(header);

  if (ext === "pdf") {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = item.name;
    host.appendChild(frame);
  } else if (previewableImages.includes(ext)) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.name;
    host.appendChild(image);
  } else if (previewableVideos.includes(ext)) {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    host.appendChild(video);
  } else if (previewableAudio.includes(ext)) {
    const audio = document.createElement("audio");
    audio.src = url;
    audio.controls = true;
    host.appendChild(audio);
  } else if (previewableText.includes(ext)) {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = item.name;
    host.appendChild(frame);
  } else {
    const message = document.createElement("div");
    message.className = "empty-state";
    message.textContent = "Pré-visualização indisponível para este tipo de arquivo.";
    host.appendChild(message);
  }
}

function appendProtocolFileEntry(host, item, depth = 0) {
  const row = document.createElement("div");
  row.className = `file-row ${item.type === "folder" ? "folder" : "file"}`;
  row.style.setProperty("--depth", String(depth));
  const button = document.createElement("button");
  button.type = "button";
  button.title = item.path;
  const icon = item.type === "folder" ? "▸" : "•";
  button.innerHTML = `<span class="file-icon">${icon}</span><span class="file-name">${item.name}</span>`;
  if (item.type === "file") button.addEventListener("click", () => previewProtocolFile(item));
  else button.addEventListener("click", () => {
    closeProtocolFilePreview();
  });
  row.appendChild(button);
  host.appendChild(row);
  if (item.type === "folder" && Array.isArray(item.children)) {
    for (const child of item.children) appendProtocolFileEntry(host, child, depth + 1);
  }
}

async function refreshProtocolFiles() {
  const tree = $("#protocolFileTree");
  const label = $("#protocolFolderPathLabel");
  if (!tree) return;
  const folder = protocolFolderForSidebar();
  if (label) label.textContent = folder || "Nenhuma pasta selecionada";
  if (!folder) {
    tree.className = "file-tree empty-state";
    tree.textContent = "Selecione a pasta do protocolo.";
    closeProtocolFilePreview();
    return;
  }
  tree.className = "file-tree empty-state";
  tree.textContent = "Carregando arquivos...";
  try {
    const result = await window.execej.listProtocolFiles(folder);
    if (folder !== protocolFolderForSidebar()) return;
    tree.className = "file-tree";
    tree.innerHTML = "";
    if (!result.exists) {
      tree.className = "file-tree empty-state";
      tree.textContent = "Pasta não encontrada.";
      return;
    }
    if (!result.entries.length) {
      tree.className = "file-tree empty-state";
      tree.textContent = "A pasta está vazia.";
      return;
    }
    for (const item of result.entries) appendProtocolFileEntry(tree, item);
    if (result.truncated) {
      const warning = document.createElement("div");
      warning.className = "muted file-warning";
      warning.textContent = "Lista limitada para manter o app rápido.";
      tree.appendChild(warning);
    }
  } catch (error) {
    tree.className = "file-tree empty-state";
    tree.textContent = error.message || String(error);
  }
}

function mountProtocolPanels() {
  const host = $("#protocolPanels");
  if (!host) return;
  for (const id of protocolPanelIds) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    panel.classList.remove("tab", "active");
    panel.classList.add("protocol-panel");
    host.appendChild(panel);
  }
}

function protocolTabNeedsPrenotation(id) {
  return ["attachments", "letters", "certificate"].includes(id);
}

function updateProtocolPrenotationWarning(id) {
  const warning = $("#protocolNeedsPrenotation");
  if (!warning) return;
  const protocol = selectedProtocol();
  warning.hidden = !protocol || !protocolTabNeedsPrenotation(id) || Boolean($("#protocolPrenotation").value.trim());
}

function showProtocolPanel(id) {
  $$(".protocol-subtabs button").forEach((button) => button.classList.toggle("active", button.dataset.protocolTab === id));
  $$(".protocol-panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
  updateProtocolPrenotationWarning(id);
}

function showProtocolList() {
  closeProtocolFilePreview();
  $("#protocolListView").hidden = false;
  $("#protocolDetailView").hidden = true;
  renderProtocols();
}

function showProtocolDetail() {
  $("#protocolListView").hidden = true;
  $("#protocolDetailView").hidden = false;
}

async function showAutuationPreview() {
  const protocol = selectedProtocol();
  const dialog = $("#autuationPreviewDialog");
  const content = $("#autuationPreviewContent");
  if (!protocol || dialog.open) return;

  $("#autuationPreviewTitle").textContent = protocolDisplayLabel(protocol);
  dialog.showModal();
  const requestId = ++autuationPreviewRequestId;
  if (!Object.keys(protocol.autuacoesMovimentacoes || {}).length) {
    content.innerHTML = '<div class="autuation-preview-empty">Nenhuma movimentação foi autuada ainda.</div>';
    return;
  }
  content.innerHTML = '<div class="autuation-preview-empty">Preparando PDF parcial...</div>';
  try {
    const preview = await window.execej.createAutuationPreview(protocol.id);
    if (!dialog.open || requestId !== autuationPreviewRequestId) {
      await window.execej.closeAutuationPreview(preview.id);
      return;
    }
    activeAutuationPreviewId = preview.id;
    const frame = document.createElement("iframe");
    frame.src = localFileUrl(preview.filePath);
    frame.title = "PDF parcial das movimentações autuadas";
    content.replaceChildren(frame);
  } catch (error) {
    const message = error.message || String(error);
    log(message);
    if (dialog.open && requestId === autuationPreviewRequestId) {
      const errorMessage = document.createElement("div");
      errorMessage.className = "autuation-preview-empty";
      errorMessage.textContent = `Não foi possível preparar a visualização: ${message}`;
      content.replaceChildren(errorMessage);
    }
  }
}

function cleanupAutuationPreview() {
  autuationPreviewRequestId += 1;
  const previewId = activeAutuationPreviewId;
  activeAutuationPreviewId = "";
  $("#autuationPreviewContent").replaceChildren();
  if (previewId) {
    window.execej.closeAutuationPreview(previewId).catch((error) => log(error.message || String(error)));
  }
}

function requirePrenotation() {
  if (!selectedProtocol()) return true;
  if ($("#protocolPrenotation").value.trim()) return true;
  alert("Vincule este protocolo a uma prenotação antes de continuar.");
  updateProtocolPrenotationWarning($(".protocol-subtabs button.active")?.dataset.protocolTab || "attachments");
  return false;
}

function fileFilters(ext) {
  if (ext === "ods") return [{ name: "Planilhas OpenDocument", extensions: ["ods"] }];
  if (ext === "odt") return [{ name: "Textos OpenDocument", extensions: ["odt"] }];
  return [{ name: "Todos os arquivos", extensions: ["*"] }];
}

async function pickFileFor(id, ext) {
  const path = await window.execej.pickFile({ title: "Selecionar arquivo", filters: fileFilters(ext) });
  if (path) document.getElementById(id).value = path;
}

async function pickFolderFor(id) {
  const path = await window.execej.pickFolder({ title: "Selecionar pasta" });
  if (path) document.getElementById(id).value = path;
}

function initTabs() {
  $$(".tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".tabs button").forEach((item) => item.classList.remove("active"));
      $$(".tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });
}

function renderProtocols() {
  const body = $("#protocolsTable tbody");
  if (!body) return;
  const filter = ($("#protocolSearch")?.value || "").trim().toLocaleUpperCase("pt-BR");
  body.innerHTML = "";
  for (const protocol of protocols) {
    const label = protocolDisplayLabel(protocol);
    const haystack = `${label} ${protocol.officeProtocol || ""} ${protocol.prenotation || ""}`.toLocaleUpperCase("pt-BR");
    if (filter && !haystack.includes(filter)) continue;
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const actionsCell = document.createElement("td");
    const unlinkButton = document.createElement("button");
    labelCell.textContent = label;
    statusCell.textContent = protocol.status || "Rascunho";
    unlinkButton.type = "button";
    unlinkButton.textContent = "Desvincular";
    unlinkButton.addEventListener("click", (event) => {
      event.stopPropagation();
      unlinkProtocol(protocol.id).catch((error) => log(error.message || String(error)));
    });
    actionsCell.appendChild(unlinkButton);
    row.append(labelCell, statusCell, actionsCell);
    row.classList.toggle("selected", protocol.id === selectedProtocolId);
    row.addEventListener("click", () => selectProtocol(protocol.id));
    body.appendChild(row);
  }
}

async function reloadProtocols(selectId = selectedProtocolId) {
  protocols = await window.execej.listProtocols();
  renderProtocols();
  if (selectId && protocols.some((protocol) => protocol.id === selectId)) selectProtocol(selectId);
  else if (selectedProtocolId && !protocols.some((protocol) => protocol.id === selectedProtocolId)) clearSelectedProtocol();
}

function clearSelectedProtocol() {
  selectedProtocolId = "";
  updateProtocolAutuationLocks(null);
  showProtocolList();
  $$(".protocol-panel").forEach((panel) => panel.classList.remove("active"));
  renderProtocols();
}

function populateProtocolForm(protocol) {
  $("#protocolName").value = protocol.name || "";
  $("#protocolOffice").value = protocol.officeProtocol || "";
  $("#protocolPrenotation").value = protocol.prenotation || "";
  $("#protocolOds").value = protocol.odsPath || "";
  $("#protocolFolder").value = protocol.folderPath || protocolBaseDir(protocol);
  $("#activeProtocolTitle").textContent = protocolDisplayLabel(protocol);
}

function updateProtocolAutuationLocks(protocol) {
  const locked = Object.keys(protocol?.autuacoesMovimentacoes || {}).length > 0;
  const message = locked ? "Estorne todas as autuações antes de alterar estes dados." : "";
  for (const id of ["protocolOffice", "protocolPrenotation", "protocolOds", "protocolFolder"]) {
    const input = $(`#${id}`);
    if (!input) continue;
    input.readOnly = locked;
    input.title = message;
  }
}

function showMovementAttachmentsDialog(requirements) {
  const dialog = $("#movementAttachmentsDialog");
  const content = $("#movementAttachmentsContent");
  if (!requirements.length) return Promise.resolve([]);

  const groups = requirements.map((requirement) => ({ requirement, files: [] }));
  const renderGroups = () => {
    content.innerHTML = "";
    groups.forEach(({ requirement, files }, groupIndex) => {
      const section = document.createElement("section");
      section.className = "movement-attachment-group";
      const heading = document.createElement("div");
      heading.className = "movement-attachment-group-heading";
      const title = document.createElement("strong");
      title.textContent = requirement.title;
      const count = document.createElement("span");
      count.textContent = `${files.length} arquivo(s)${requirement.single_file ? " · somente 1" : ""}`;
      heading.append(title, count);

      const list = document.createElement("select");
      list.className = "movement-attachment-file-list";
      list.size = Math.min(Math.max(files.length, 3), 6);
      list.setAttribute("aria-label", `Ordem dos arquivos para ${requirement.title}`);
      files.forEach((file, fileIndex) => {
        const option = new Option(`${fileIndex + 1}. ${file.split(/[\\/]/).pop()}`, file);
        list.add(option);
      });
      if (!files.length) {
        const option = new Option("Nenhum arquivo selecionado", "");
        option.disabled = true;
        list.add(option);
      }

      const actions = document.createElement("div");
      actions.className = "movement-attachment-actions";
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.textContent = "Adicionar arquivos";
      addButton.disabled = Boolean(requirement.single_file && files.length);
      addButton.addEventListener("click", async () => {
        try {
          const selectedFiles = await window.execej.pickFiles({
            title: `Anexar ${requirement.title}`,
            filters: [{ name: "Arquivos suportados", extensions: ["pdf", "odt", "ods", "jpg", "jpeg", "png", "bmp", "tif", "tiff"] }]
          });
          if (!selectedFiles.length) return;
          if (requirement.single_file && files.length + selectedFiles.length > 1) {
            alert(`"${requirement.title}" aceita somente um arquivo.`);
            return;
          }
          files.push(...selectedFiles);
          renderGroups();
        } catch (error) {
          const message = error.message || String(error);
          log(message);
          alert(message);
        }
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "Remover";
      removeButton.disabled = !files.length;
      removeButton.addEventListener("click", () => {
        if (list.selectedIndex < 0) return;
        files.splice(list.selectedIndex, 1);
        renderGroups();
      });

      const moveUpButton = document.createElement("button");
      moveUpButton.type = "button";
      moveUpButton.textContent = "Subir";
      moveUpButton.disabled = !files.length;
      moveUpButton.addEventListener("click", () => {
        const index = list.selectedIndex;
        if (index <= 0) return;
        [files[index - 1], files[index]] = [files[index], files[index - 1]];
        renderGroups();
        const updatedList = content.querySelectorAll(".movement-attachment-file-list")[groupIndex];
        updatedList.selectedIndex = index - 1;
      });

      const moveDownButton = document.createElement("button");
      moveDownButton.type = "button";
      moveDownButton.textContent = "Descer";
      moveDownButton.disabled = !files.length;
      moveDownButton.addEventListener("click", () => {
        const index = list.selectedIndex;
        if (index < 0 || index >= files.length - 1) return;
        [files[index + 1], files[index]] = [files[index], files[index + 1]];
        renderGroups();
        const updatedList = content.querySelectorAll(".movement-attachment-file-list")[groupIndex];
        updatedList.selectedIndex = index + 1;
      });

      actions.append(addButton, removeButton, moveUpButton, moveDownButton);
      section.append(heading, list, actions);
      content.appendChild(section);
    });
  };

  renderGroups();
  dialog.showModal();
  return new Promise((resolve) => {
    const cleanup = () => {
      dialog.removeEventListener("cancel", handleCancel);
      $("#cancelMovementAttachments").removeEventListener("click", handleCancel);
      $("#cancelMovementAttachmentsFooter").removeEventListener("click", handleCancel);
      $("#confirmMovementAttachments").removeEventListener("click", handleConfirm);
    };
    const finish = (value) => {
      cleanup();
      dialog.close();
      resolve(value);
    };
    const handleCancel = (event) => {
      event?.preventDefault();
      finish(null);
    };
    const handleConfirm = () => {
      const missing = groups.find(({ files }) => !files.length);
      if (missing) {
        alert(`Adicione pelo menos um arquivo em "${missing.requirement.title}".`);
        return;
      }
      finish(groups.map(({ requirement, files }) => ({ title: requirement.title, files: [...files] })));
    };
    dialog.addEventListener("cancel", handleCancel);
    $("#cancelMovementAttachments").addEventListener("click", handleCancel);
    $("#cancelMovementAttachmentsFooter").addEventListener("click", handleCancel);
    $("#confirmMovementAttachments").addEventListener("click", handleConfirm);
  });
}

function setProtocolAutuationBusy(busy) {
  for (const selector of ["#protocolData", "#protocolSheets", ".protocol-subtabs"]) {
    const panel = $(selector);
    if (panel) panel.inert = busy;
  }
}

function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function renderProtocolSheetTabs() {
  const host = $("#protocolSheetTabs");
  if (!host) return;
  const protocol = selectedProtocol();
  const names = protocolSheetNames(protocol)
    .filter((name) => normalizeUiKey(name) !== normalizeUiKey("TABELA DE CUSTAS RTD"));
  host.innerHTML = "";
  if (!names.length) {
    selectedProtocolSheetName = "";
    $("#protocolSheetTable").innerHTML = "";
    setProtocolSheetSelection();
    return;
  }
  if (!selectedProtocolSheetName || !names.includes(selectedProtocolSheetName)) selectedProtocolSheetName = names[0];
  for (const name of names) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", name === selectedProtocolSheetName);
    button.addEventListener("click", () => {
      persistVisibleSheetToMemory();
      selectedProtocolSheetName = name;
      scheduleProtocolAutosave();
      setProtocolSheetSelection();
      renderProtocolSheetTabs();
      renderProtocolSheetTable();
    });
    host.appendChild(button);
  }
}

function renderProtocolSheetTable() {
  const table = $("#protocolSheetTable");
  const customHost = $("#protocolSheetCustom");
  const protocol = selectedProtocol();
  if (!table || !protocol || !selectedProtocolSheetName) return;
  if (isCustasSheet(selectedProtocolSheetName)) {
    const rows = custasRowsWithStructure(protocol.sheets?.[selectedProtocolSheetName] || [[]]);
    protocol.sheets ||= {};
    protocol.sheets[selectedProtocolSheetName] = cloneSheetRows(rows);
    renderCustasSheet(rows);
    return;
  }
  if (customHost) {
    customHost.hidden = true;
    customHost.innerHTML = "";
  }
  table.hidden = false;
  const rows = removeBlankHeaderColumns(selectedProtocolSheetName, protocol.sheets?.[selectedProtocolSheetName] || [[]]);
  protocol.sheets ||= {};
  protocol.sheets[selectedProtocolSheetName] = cloneSheetRows(rows);
  const visibleColumns = editableProtocolSheetColumns(selectedProtocolSheetName, rows);
  const headerRowIndex = sheetHeaderRowIndex(selectedProtocolSheetName, rows);
  const isMovementSheet = protocolSheetKey(selectedProtocolSheetName) === "MOVIMENTACOES";
  const movementColumnIndex = isMovementSheet
    ? Math.max(0, (rows[headerRowIndex] || []).findIndex((header) => normalizeUiKey(header) === "MOVIMENTACAO"))
    : -1;
  const movementDateColumnIndex = isMovementSheet
    ? Math.max(movementColumnIndex + 1, (rows[headerRowIndex] || []).findIndex((header) => normalizeUiKey(header) === "DATA"))
    : -1;
  const displayedColumns = isMovementSheet
    ? [movementColumnIndex, movementDateColumnIndex]
    : visibleColumns;
  table.classList.toggle("movement-sheet-table", isMovementSheet);
  const rowCount = Math.max(rows.length, headerRowIndex + 2);
  table.innerHTML = "";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "row-head";
  headRow.appendChild(corner);
  for (const colIndex of displayedColumns) {
    const th = document.createElement("th");
    const headerText = isMovementSheet
      ? (colIndex === movementColumnIndex ? "Movimentação" : "Data")
      : sheetColumnHeader(rows, headerRowIndex, colIndex);
    th.textContent = headerText;
    th.title = headerText || columnLabel(colIndex);
    th.dataset.colIndex = String(colIndex);
    if (isMovementSheet && colIndex === movementColumnIndex) th.classList.add("movement-name-column");
    else if (isMovementSheet) th.classList.add("movement-date-column");
    th.addEventListener("click", () => setProtocolSheetSelection(-1, colIndex));
    headRow.appendChild(th);
  }
  if (isMovementSheet) {
    const autuationHeading = document.createElement("th");
    autuationHeading.className = "movement-autuation-heading";
    autuationHeading.textContent = "Autuação";
    headRow.appendChild(autuationHeading);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  let visibleRowNumber = 0;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    if (isProtocolSheetStructureRow(selectedProtocolSheetName, rowIndex, headerRowIndex)) continue;
    visibleRowNumber += 1;
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(rowIndex);
    const rowHead = document.createElement("td");
    rowHead.className = "row-head";
    rowHead.textContent = String(visibleRowNumber);
    rowHead.dataset.rowIndex = String(rowIndex);
    rowHead.addEventListener("click", () => setProtocolSheetSelection(rowIndex, -1));
    tr.appendChild(rowHead);
    let movementEditor = null;
    for (const colIndex of displayedColumns) {
      const td = document.createElement("td");
      td.dataset.rowIndex = String(rowIndex);
      td.dataset.colIndex = String(colIndex);
      const editor = createProtocolSheetCellEditor(selectedProtocolSheetName, rows, rowIndex, colIndex);
      if (isMovementSheet && colIndex === movementColumnIndex) movementEditor = editor;
      if (isMovementSheet && colIndex === movementColumnIndex) td.classList.add("movement-name-column");
      else if (isMovementSheet) td.classList.add("movement-date-column");
      if (isMovementSheet && protocol.autuacoesMovimentacoes?.[String(rowIndex)]) {
        editor.disabled = true;
        editor.title = "Estorne a autuação para editar esta movimentação.";
      }
      td.appendChild(editor);
      tr.appendChild(td);
    }
    if (isMovementSheet) {
      const autuationCell = document.createElement("td");
      autuationCell.className = "movement-autuation-cell";
      const movementName = String(rows[rowIndex]?.[movementColumnIndex] || "").trim();
      const autuation = protocol.autuacoesMovimentacoes?.[String(rowIndex)];
      if (autuation) {
        const completedButton = document.createElement("button");
        completedButton.type = "button";
        completedButton.className = "movement-autuated";
        completedButton.textContent = "Autuado";
        completedButton.disabled = true;

        const undoButton = document.createElement("button");
        undoButton.type = "button";
        undoButton.className = "movement-autuation-undo";
        undoButton.setAttribute("aria-label", "Estornar Autuação");
        undoButton.title = "Estornar Autuação";
        undoButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-4L3 10"/><path d="M3 4v6h6"/><path d="M4 13a8 8 0 0 0 14.9 4L21 14"/><path d="M21 20v-6h-6"/></svg>';
        undoButton.addEventListener("click", () => handleMovementAutuation(rowIndex, true, undoButton));
        autuationCell.append(completedButton, undoButton);
      } else {
        const autuateButton = document.createElement("button");
        autuateButton.type = "button";
        autuateButton.className = "movement-autuation-start";
        autuateButton.textContent = "Autuar";
        autuateButton.disabled = !movementName;
        autuateButton.title = movementName ? "" : "Preencha a movimentação antes de autuar.";
        autuateButton.addEventListener("click", () => handleMovementAutuation(rowIndex, false, autuateButton));
        movementEditor?.addEventListener("input", () => {
          autuateButton.disabled = !movementEditor.value.trim();
          autuateButton.title = autuateButton.disabled ? "Preencha a movimentação antes de autuar." : "";
        });
        autuationCell.appendChild(autuateButton);
      }
      tr.appendChild(autuationCell);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  updateProtocolSheetSelection();
}

async function handleMovementAutuation(sourceRowIndex, undo, button) {
  if (undo && !confirm("Estornar esta autuação? Os PDFs gerados para ela serão removidos da pasta Autuação\\PDFs.")) return;
  if (!undo && !requirePrenotation()) return;
  const protocol = selectedProtocol();
  if (!protocol) return;
  button.disabled = true;
  if (!undo) button.textContent = "Autuando...";
  setProtocolAutuationBusy(true);
  clearTimeout(protocolAutosaveTimer);
  try {
    await saveCurrentProtocolSilently();
    let attachments = [];
    let signature = signaturePayload($("#finalSigner"), $("#finalSignerCargo"));
    if (!undo) {
      const { requirements: attachmentRequirements, requiresSignature } = await window.execej.movementAttachmentRequirements({
        ...protocolPayload(),
        sheetName: selectedProtocolSheetName,
        sourceRowIndex
      });
      const selectedAttachments = await showMovementAttachmentsDialog(attachmentRequirements);
      if (selectedAttachments === null) {
        button.disabled = false;
        button.textContent = "Autuar";
        return;
      }
      attachments = selectedAttachments;
      if (requiresSignature) {
        signature = await addOnrCertificateForSignature(signature);
        if (!signature) {
          button.disabled = false;
          button.textContent = "Autuar";
          return;
        }
      }
    }
    const action = undo ? window.execej.estornarAutuacao : window.execej.autuarMovimentacao;
    const result = await action({
      ...protocolPayload(),
      ...signature,
      sheetName: selectedProtocolSheetName,
      sourceRowIndex,
      attachments
    });
    const index = protocols.findIndex((item) => item.id === result.protocol.id);
    if (index >= 0) protocols[index] = result.protocol;
    else protocols.unshift(result.protocol);
    selectedProtocolId = result.protocol.id;
    updateProtocolAutuationLocks(result.protocol);
    setProtocolAutosaveStatus("Salvo automaticamente", "saved");
    renderProtocols();
    renderProtocolSheetTable();
    scheduleProtocolFileRefresh();
    if (result.imageExportWarning) {
      log(result.imageExportWarning);
      alert(result.imageExportWarning);
    }
  } catch (error) {
    const message = error.message || String(error);
    log(message);
    alert(message);
    button.disabled = false;
    if (!undo) button.textContent = "Autuar";
  } finally {
    setProtocolAutuationBusy(false);
  }
}

function renderProtocolSheets() {
  renderProtocolSheetTabs();
  renderProtocolSheetTable();
}

function addProtocolSheetRow() {
  persistVisibleSheetToMemory();
  const protocol = selectedProtocol();
  if (!protocol || !selectedProtocolSheetName) return;
  protocol.sheets ||= {};
  const rows = protocol.sheets[selectedProtocolSheetName] ||= [[""]];
  const colCount = Math.max(effectiveSheetColumnCount(rows, 1), ...editableProtocolSheetColumns(selectedProtocolSheetName, rows).map((index) => index + 1));
  rows.push(Array.from({ length: colCount }, () => ""));
  renderProtocolSheetTable();
  scheduleProtocolAutosave();
}

function addProtocolSheetColumn() {
  persistVisibleSheetToMemory();
  const protocol = selectedProtocol();
  if (!protocol || !selectedProtocolSheetName) return;
  if (protocolSheetKey(selectedProtocolSheetName) === "MOVIMENTACOES") return;
  protocol.sheets ||= {};
  const rows = protocol.sheets[selectedProtocolSheetName] ||= [[""]];
  const colIndex = Math.max(effectiveSheetColumnCount(rows, 1), ...editableProtocolSheetColumns(selectedProtocolSheetName, rows).map((index) => index + 1));
  for (const row of rows) {
    while (row.length <= colIndex) row.push("");
  }
  const headerIndex = sheetHeaderRowIndex(selectedProtocolSheetName, rows);
  while (rows.length <= headerIndex) rows.push(Array.from({ length: colIndex + 1 }, () => ""));
  rows[headerIndex][colIndex] = `Nova coluna ${columnLabel(colIndex)}`;
  renderProtocolSheetTable();
  scheduleProtocolAutosave();
}

function deleteProtocolSheetRow() {
  persistVisibleSheetToMemory();
  const protocol = selectedProtocol();
  if (!protocol || !selectedProtocolSheetName || selectedProtocolSheetRow < 0) return;
  const rows = protocol.sheets?.[selectedProtocolSheetName] || [[]];
  const headerIndex = sheetHeaderRowIndex(selectedProtocolSheetName, rows);
  if (isProtocolSheetStructureRow(selectedProtocolSheetName, selectedProtocolSheetRow, headerIndex)) {
    alert("Essa linha faz parte da estrutura da guia.");
    return;
  }
  const isMovementSheet = protocolSheetKey(selectedProtocolSheetName) === "MOVIMENTACOES";
  const autuacoesMovimentacoes = protocol.autuacoesMovimentacoes || {};
  if (isMovementSheet && autuacoesMovimentacoes[String(selectedProtocolSheetRow)]) {
    alert("Estorne a autuação antes de apagar esta movimentação.");
    return;
  }
  if (!confirm(`Apagar a linha ${selectedProtocolSheetRow + 1}?`)) return;
  if (isMovementSheet) {
    const updatedAutuacoes = {};
    for (const [rowKey, record] of Object.entries(autuacoesMovimentacoes)) {
      const rowIndex = Number(rowKey);
      updatedAutuacoes[String(rowIndex > selectedProtocolSheetRow ? rowIndex - 1 : rowIndex)] = record;
    }
    protocol.autuacoesMovimentacoes = updatedAutuacoes;
  }
  rows.splice(selectedProtocolSheetRow, 1);
  if (!rows.length) rows.push([""]);
  setProtocolSheetSelection();
  renderProtocolSheetTable();
  scheduleProtocolAutosave();
}

function deleteProtocolSheetColumn() {
  persistVisibleSheetToMemory();
  const protocol = selectedProtocol();
  if (!protocol || !selectedProtocolSheetName || selectedProtocolSheetColumn < 0) return;
  if (protocolSheetKey(selectedProtocolSheetName) === "MOVIMENTACOES") return;
  if (protocolSheetKey(selectedProtocolSheetName) === "MOVIMENTACOES" && Object.keys(protocol.autuacoesMovimentacoes || {}).length) {
    alert("Estorne as autuações da guia antes de apagar uma coluna.");
    return;
  }
  const rows = protocol.sheets?.[selectedProtocolSheetName] || [[]];
  const visibleColumns = editableProtocolSheetColumns(selectedProtocolSheetName, rows);
  if (!visibleColumns.includes(selectedProtocolSheetColumn)) return;
  const headerIndex = sheetHeaderRowIndex(selectedProtocolSheetName, rows);
  const header = sheetColumnHeader(rows, headerIndex, selectedProtocolSheetColumn) || columnLabel(selectedProtocolSheetColumn);
  if (!confirm(`Apagar a coluna "${header}"?`)) return;
  for (const row of rows) {
    if (selectedProtocolSheetColumn < row.length) row.splice(selectedProtocolSheetColumn, 1);
    if (!row.length) row.push("");
  }
  setProtocolSheetSelection();
  renderProtocolSheetTable();
  scheduleProtocolAutosave();
}

function syncProtocolFormToWorkAreas() {
  if (!selectedProtocol()) return;
  const protocol = { ...selectedProtocol(), ...readProtocolForm() };
  $("#activeProtocolTitle").textContent = protocolDisplayLabel(protocol);
  applyProtocol(protocol);
}

function selectProtocol(id) {
  const protocol = protocols.find((item) => item.id === id);
  if (!protocol) return;
  closeProtocolFilePreview();
  selectedProtocolId = id;
  updateProtocolAutuationLocks(protocol);
  setProtocolSheetSelection();
  showProtocolDetail();
  populateProtocolForm(protocol);
  applyProtocol(protocol);
  renderProtocolSheets();
  renderProtocols();
  showProtocolPanel($(".protocol-subtabs button.active")?.dataset.protocolTab || "protocolData");
}

async function saveSelectedProtocol() {
  const saved = await run("Protocolo salvo.", () => window.execej.saveProtocol(readProtocolForm()));
  await reloadProtocols(saved.id);
}

async function saveCurrentProtocolSilently() {
  if (!selectedProtocol()) return;
  clearTimeout(protocolAutosaveTimer);
  if (protocolAutosaveInFlight) await protocolAutosavePromise;
  clearTimeout(protocolAutosaveTimer);
  protocolAutosaveQueued = false;
  setProtocolAutosaveStatus("Salvando...", "saving");
  const saved = await window.execej.saveProtocol(readProtocolForm());
  const index = protocols.findIndex((protocol) => protocol.id === saved.id);
  if (index >= 0) protocols[index] = saved;
  else protocols.unshift(saved);
  selectedProtocolId = saved.id;
  setProtocolAutosaveStatus("Salvo automaticamente", "saved");
}

async function createDraftProtocol() {
  const saved = await run("Rascunho criado.", () => window.execej.saveProtocol({}));
  await reloadProtocols(saved.id);
  showProtocolPanel("protocolData");
}

async function importProtocolOds() {
  const path = await window.execej.pickFile({ title: "Selecionar protocolo ODS", filters: fileFilters("ods") });
  if (!path) return;
  const protocol = await window.execej.inspectProtocolOds(path);
  const saved = await run("Protocolo importado.", () => window.execej.saveProtocol(protocol));
  await reloadProtocols(saved.id);
  showProtocolPanel("protocolData");
}

async function pickProtocolOds() {
  const path = await window.execej.pickFile({ title: "Selecionar protocolo ODS", filters: fileFilters("ods") });
  if (!path) return;
  const current = selectedProtocol();
  if (Object.keys(current?.autuacoesMovimentacoes || {}).length) {
    alert("Estorne as autuações antes de substituir a planilha do protocolo.");
    return;
  }
  const inspected = await window.execej.inspectProtocolOds(path);
  $("#protocolOds").value = inspected.odsPath || path;
  if (inspected.sheetOrder && inspected.sheets) {
    if (current) {
      current.sheetOrder = inspected.sheetOrder;
      current.sheets = inspected.sheets;
      selectedProtocolSheetName = inspected.sheetOrder[0] || "";
      setProtocolSheetSelection();
      renderProtocolSheets();
    }
  }
  if (!$("#protocolFolder").value.trim()) $("#protocolFolder").value = inspected.folderPath || fileParent(path);
  if (!$("#protocolOffice").value.trim()) $("#protocolOffice").value = inspected.officeProtocol || "";
  if (!$("#protocolPrenotation").value.trim()) $("#protocolPrenotation").value = inspected.prenotation || "";
  syncProtocolFormToWorkAreas();
  scheduleProtocolAutosave();
}

async function unlinkProtocol(id = selectedProtocolId) {
  const protocol = protocols.find((item) => item.id === id);
  if (!protocol) return;
  if (!confirm(`Desvincular "${protocolDisplayLabel(protocol)}" e excluir este cadastro da lista?`)) return;
  await run("Protocolo desvinculado.", () => window.execej.deleteProtocol(protocol.id));
  await reloadProtocols("");
  showProtocolList();
}

function initProtocols() {
  mountProtocolPanels();
  $("#toggleProtocolFiles").addEventListener("click", toggleProtocolFileSidebar);
  $("#newDraftProtocol").addEventListener("click", createDraftProtocol);
  $("#importProtocolOds").addEventListener("click", importProtocolOds);
  $("#protocolSearch").addEventListener("input", renderProtocols);
  $("#backToProtocolList").addEventListener("click", showProtocolList);
  $("#previewAutuations").addEventListener("click", showAutuationPreview);
  $("#closeAutuationPreview").addEventListener("click", () => $("#autuationPreviewDialog").close());
  $("#autuationPreviewDialog").addEventListener("close", cleanupAutuationPreview);
  $("#saveProtocol").addEventListener("click", saveSelectedProtocol);
  $("#saveProtocolSheets").addEventListener("click", saveSelectedProtocol);
  $("#addSheetRow").addEventListener("click", addProtocolSheetRow);
  $("#addSheetColumn").addEventListener("click", addProtocolSheetColumn);
  $("#deleteSheetRow").addEventListener("click", deleteProtocolSheetRow);
  $("#deleteSheetColumn").addEventListener("click", deleteProtocolSheetColumn);
  $("#unlinkProtocol").addEventListener("click", () => unlinkProtocol(selectedProtocolId).catch((error) => log(error.message || String(error))));
  $("#pickProtocolOds").addEventListener("click", pickProtocolOds);
  $("#pickProtocolFolder").addEventListener("click", async () => {
    const path = await window.execej.pickFolder({ title: "Selecionar pasta do protocolo" });
    if (path) {
      $("#protocolFolder").value = path;
      syncProtocolFormToWorkAreas();
      refreshProtocolFiles();
      scheduleProtocolAutosave();
    }
  });
  ["protocolName", "protocolOffice", "protocolPrenotation"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      $("#activeProtocolTitle").textContent = protocolDisplayLabel({ ...selectedProtocol(), ...readProtocolForm() });
      if ($("#initialOfficeProtocol")) $("#initialOfficeProtocol").value = $("#protocolOffice").value.trim();
      if ($("#initialPrenotation")) $("#initialPrenotation").value = $("#protocolPrenotation").value.trim();
      updateProtocolPrenotationWarning($(".protocol-subtabs button.active")?.dataset.protocolTab || "initial");
      scheduleProtocolAutosave();
    });
  });
  ["protocolOds", "protocolFolder"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      syncProtocolFormToWorkAreas();
      if (id === "protocolFolder") refreshProtocolFiles();
      scheduleProtocolAutosave();
    });
  });
  $("#refreshProtocolFiles").addEventListener("click", refreshProtocolFiles);
  $$(".protocol-subtabs button").forEach((button) => {
    button.addEventListener("click", () => showProtocolPanel(button.dataset.protocolTab));
  });
  reloadProtocols().catch((error) => log(error.message || String(error)));
}

function initPickers() {
  $$("[data-pick-file]").forEach((button) => {
    button.addEventListener("click", () => pickFileFor(button.dataset.pickFile, button.dataset.ext));
  });
  $$("[data-pick-folder]").forEach((button) => {
    button.addEventListener("click", () => pickFolderFor(button.dataset.pickFolder));
  });
}

function initMerge(kind, defaults = {}) {
  const host = document.querySelector(`[data-merge="${kind}"]`);
  if (!host) return;
  const isCertificate = kind === "certificate";
  if (!host.dataset.ready) {
    host.innerHTML = `
      <div class="grid">
        <label class="ods-source-control">Planilha ODS<input data-field="odsPath" /></label>
        <button class="ods-source-control" data-action="pickOds">Escolher</button>
        <label>Modelo ODT<input data-field="templatePath" /></label>
        <button data-action="pickTemplate">Escolher</button>
        <label>Pasta de saída<input data-field="outputDir" /></label>
        <button data-action="pickOutput">Escolher</button>
      </div>
      <div class="grid compact">
        <label>Data<input data-field="dateValue" /></label>
        <label>Tipo<select data-field="kind"></select></label>
        <label>Guia<input data-field="sheetName" /></label>
        <label>Coluna dos nomes<input data-field="nameCol" /></label>
      </div>
      <div class="grid compact signature-grid">
        <label>Assina:<select data-field="signerName"></select></label>
        <label>Cargo:<input data-field="signerCargo" /></label>
      </div>
      <label class="check"><input data-field="firstRowHeader" type="checkbox" checked /> Primeira linha da guia é cabeçalho</label>
      <div class="actions">
        <button data-action="loadNames">Carregar nomes</button>
        <button data-action="selectAll">Selecionar todos</button>
        <button data-action="generate">${isCertificate ? "Gerar Certidão" : "Gerar documentos"}</button>
      </div>
      <select data-field="names" multiple size="14"></select>
    `;
    const kindSelect = host.querySelector('[data-field="kind"]');
    for (const option of Object.keys(isCertificate ? certificateModels : letterModels)) {
      kindSelect.add(new Option(option, option));
    }
    host.querySelector('[data-action="pickOds"]').addEventListener("click", async () => {
      const path = await window.execej.pickFile({ title: "Selecionar ODS", filters: fileFilters("ods") });
      if (path) host.querySelector('[data-field="odsPath"]').value = path;
    });
    host.querySelector('[data-action="pickTemplate"]').addEventListener("click", async () => {
      const path = await window.execej.pickFile({ title: "Selecionar ODT", filters: fileFilters("odt") });
      if (path) host.querySelector('[data-field="templatePath"]').value = path;
    });
    host.querySelector('[data-action="pickOutput"]').addEventListener("click", async () => {
      const path = await window.execej.pickFolder({ title: "Selecionar pasta de saída" });
      if (path) host.querySelector('[data-field="outputDir"]').value = path;
    });
    host.querySelector('[data-action="loadNames"]').addEventListener("click", () => loadMergeNames(kind));
    host.querySelector('[data-action="selectAll"]').addEventListener("click", () => {
      const names = host.querySelector('[data-field="names"]');
      Array.from(names.options).forEach((option) => option.selected = true);
    });
    host.querySelector('[data-action="generate"]').addEventListener("click", () => generateMergeDocs(kind));
    host.dataset.ready = "1";
  }
  setupSignatureControl(host.querySelector('[data-field="signerName"]'), host.querySelector('[data-field="signerCargo"]'));
  if (defaults.odsPath !== undefined) host.querySelector('[data-field="odsPath"]').value = defaults.odsPath;
  if (defaults.outputDir !== undefined) host.querySelector('[data-field="outputDir"]').value = defaults.outputDir;
  host.querySelector('[data-field="sheetName"]').value = isCertificate ? config.certificate_sheet : config.notifications_sheet;
  host.querySelector('[data-field="nameCol"]').value = isCertificate ? config.certificate_name_col : config.notifications_name_col;
  host.querySelector('[data-field="dateValue"]').value = new Date().toLocaleDateString("pt-BR");
}

async function loadMergeNames(kind) {
  await saveCurrentProtocolSilently();
  const host = document.querySelector(`[data-merge="${kind}"]`);
  const payload = mergePayload(kind);
  const records = await run("", () => window.execej.loadNames(payload));
  const names = host.querySelector('[data-field="names"]');
  names.innerHTML = "";
  for (const record of records) {
    const option = new Option(`${record.displayName} (linha ${record.rowNumber})`, record.rowNumber);
    names.add(option);
  }
  log(`${records.length} nome(s) carregado(s).`);
}

function mergePayload(kind) {
  const host = document.querySelector(`[data-merge="${kind}"]`);
  return {
    odsPath: host.querySelector('[data-field="odsPath"]').value.trim(),
    templatePath: host.querySelector('[data-field="templatePath"]').value.trim(),
    outputDir: host.querySelector('[data-field="outputDir"]').value.trim(),
    dateValue: host.querySelector('[data-field="dateValue"]').value.trim(),
    kind: host.querySelector('[data-field="kind"]').value,
    mergeKind: kind,
    sheetName: host.querySelector('[data-field="sheetName"]').value.trim(),
    nameCol: host.querySelector('[data-field="nameCol"]').value.trim(),
    firstRowHeader: host.querySelector('[data-field="firstRowHeader"]').checked,
    ...protocolPayload(),
    ...signaturePayload(host.querySelector('[data-field="signerName"]'), host.querySelector('[data-field="signerCargo"]')),
    modelsByKind: kind === "certificate" ? certificateModels : letterModels
  };
}

async function generateMergeDocs(kind) {
  await saveCurrentProtocolSilently();
  const host = document.querySelector(`[data-merge="${kind}"]`);
  const names = host.querySelector('[data-field="names"]');
  const payload = mergePayload(kind);
  payload.selectedRows = Array.from(names.selectedOptions).map((option) => Number(option.value));
  const result = await run("Documentos gerados.", () => window.execej.generateDocuments(payload));
  scheduleProtocolFileRefresh();
  alert(`${result.outputs.length} documento(s) gerado(s).\n${result.outputDir}`);
}

function noteMode() {
  return document.querySelector('input[name="noteMode"]:checked').value;
}

function notePayload() {
  const missing = $$('[data-issue="missing"]:checked').map((item) => item.value);
  const not_pdfa = $$('[data-issue="not_pdfa"]:checked').map((item) => item.value);
  const unsigned = $$('[data-issue="unsigned"]:checked').map((item) => item.value);
  return {
    mode: noteMode(),
    odsPath: $("#noteOds").value.trim(),
    modelPath: $("#noteModel").value.trim(),
    outputDir: $("#noteOutput").value.trim(),
    matricula: $("#noteMatricula").value.trim(),
    dateValue: $("#noteDate").value.trim(),
    item3Body: $("#noteItem3").value.trim(),
    ...protocolPayload(),
    ...signaturePayload($("#noteSigner"), $("#noteSignerCargo")),
    missing,
    not_pdfa,
    unsigned,
    items: $$("#blankItems textarea").map((textarea) => textarea.value.trim())
  };
}

async function refreshNotePreview() {
  if (noteMode() !== "standard") return;
  try {
    const payload = notePayload();
    payload.matricula ||= "XX.XXX";
    const texts = await window.execej.notePreview(payload);
    $("#noteItem3").value = texts.item_3.replace(/^\s*3\.\s*/, "");
  } catch {
    $("#noteItem3").value = "";
  }
}

function addBlankItem(text = "") {
  const index = $$("#blankItems textarea").length + 1;
  const row = document.createElement("div");
  row.className = "blank-row";
  row.innerHTML = `<div class="number">${index}.</div><textarea>${text}</textarea><button>Remover</button>`;
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    renumberBlankItems();
  });
  $("#blankItems").appendChild(row);
}

function renumberBlankItems() {
  $$("#blankItems .number").forEach((item, index) => item.textContent = `${index + 1}.`);
  if (!$$("#blankItems textarea").length) addBlankItem();
}

function initNote() {
  $("#noteDate").value = new Date().toLocaleDateString("pt-BR");
  setupSignatureControl($("#noteSigner"), $("#noteSignerCargo"));
  addBlankItem();
  $$('input[name="noteMode"]').forEach((radio) => radio.addEventListener("change", () => {
    $("#noteStandard").hidden = noteMode() !== "standard";
    $("#noteBlank").hidden = noteMode() !== "blank";
  }));
  $$("[data-issue]").forEach((input) => input.addEventListener("change", refreshNotePreview));
  $("#noteMatricula").addEventListener("input", refreshNotePreview);
  $("#addBlankItem").addEventListener("click", () => addBlankItem());
  $("#generateNote").addEventListener("click", async () => {
    const payload = await addOnrCertificateForSignature(notePayload());
    if (!payload) return;
    await saveCurrentProtocolSilently();
    const result = await run("Nota de Exigência criada.", () => window.execej.generateNote(payload));
    scheduleProtocolFileRefresh();
    alert(`Nota de Exigência criada:\n${result.output}`);
  });
}

function initAttachments() {
  setupSignatureControl($("#finalSigner"), $("#finalSignerCargo"));
  $("#analyzeMovements").addEventListener("click", async () => {
    if (!requirePrenotation()) return;
    await saveCurrentProtocolSilently();
    const result = await run("", () => window.execej.analyzeMovements({
      odsPath: $("#attachOds").value.trim(),
      sheetName: $("#attachSheet").value.trim(),
      ...protocolPayload()
    }));
    slots = result.slots;
    selectedSlotIndex = -1;
    const body = $("#slotsTable tbody");
    body.innerHTML = "";
    for (const [index, slot] of slots.entries()) {
      const row = document.createElement("tr");
      const movementCell = document.createElement("td");
      const titleCell = document.createElement("td");
      const filesCell = document.createElement("td");
      movementCell.textContent = slot.movement;
      titleCell.textContent = `${slot.title}${slot.optional ? " (opcional)" : ""}`;
      filesCell.textContent = slotFilesLabel(slot);
      row.append(movementCell, titleCell, filesCell);
      row.addEventListener("click", () => selectSlot(index));
      row.addEventListener("dblclick", () => addFilesToSelectedSlot());
      body.appendChild(row);
    }
    refreshSlotFiles();
    log(result.status);
  });
  $("#addSlotFiles").addEventListener("click", addFilesToSelectedSlot);
  $("#removeSlotFile").addEventListener("click", removeSelectedSlotFile);
  $("#moveSlotFileUp").addEventListener("click", () => moveSelectedSlotFile(-1));
  $("#moveSlotFileDown").addEventListener("click", () => moveSelectedSlotFile(1));
  $("#generateFinalPdf").addEventListener("click", generateFinalPdf);
  window.execej.onFinalPdfProgress((message) => log(message));
  window.execej.onOnrSigningProgress((message) => log(message));
}

function selectSlot(index) {
  selectedSlotIndex = index;
  $$("#slotsTable tbody tr").forEach((row, rowIndex) => row.classList.toggle("selected", rowIndex === index));
  refreshSlotFiles();
}

function slotFilesLabel(slot) {
  return `${slot?.files?.length || 0}${slot?.optional ? " opcional" : ""}`;
}

function refreshSlotsTableCounts() {
  $$("#slotsTable tbody tr").forEach((row, index) => {
    if (slots[index]) row.children[2].textContent = slotFilesLabel(slots[index]);
  });
}

function refreshSlotFiles() {
  const list = $("#slotFiles");
  list.innerHTML = "";
  const slot = slots[selectedSlotIndex];
  $("#selectedSlotTitle").textContent = slot ? `${slot.title}${slot.optional ? " (opcional)" : ""}` : "Selecione uma coluna";
  if (!slot) return;
  for (const file of slot.files) list.add(new Option(file.split(/[\\/]/).pop(), file));
  refreshSlotsTableCounts();
}

async function addFilesToSelectedSlot() {
  const slot = slots[selectedSlotIndex];
  if (!slot) {
    alert("Selecione uma coluna para anexar.");
    return;
  }
  const files = await window.execej.pickFiles({
    title: `Anexar em ${slot.title}`,
    filters: [{ name: "Arquivos suportados", extensions: ["pdf", "odt", "ods", "jpg", "jpeg", "png", "bmp", "tif", "tiff"] }]
  });
  if (!files.length) return;
  if (slot.single_file && slot.files.length + files.length > 1) {
    alert(`"${slot.title}" aceita somente um arquivo.`);
    return;
  }
  slot.files.push(...files);
  refreshSlotFiles();
}

function removeSelectedSlotFile() {
  const slot = slots[selectedSlotIndex];
  const list = $("#slotFiles");
  if (!slot || list.selectedIndex < 0) return;
  slot.files.splice(list.selectedIndex, 1);
  refreshSlotFiles();
}

function moveSelectedSlotFile(direction) {
  const slot = slots[selectedSlotIndex];
  const list = $("#slotFiles");
  if (!slot || list.selectedIndex < 0) return;
  const index = list.selectedIndex;
  const next = index + direction;
  if (next < 0 || next >= slot.files.length) return;
  const [item] = slot.files.splice(index, 1);
  slot.files.splice(next, 0, item);
  refreshSlotFiles();
  $("#slotFiles").selectedIndex = next;
}

async function generateFinalPdf() {
  if (!requirePrenotation()) return;
  const payload = await addOnrCertificateForSignature({
    odsPath: $("#attachOds").value.trim(),
    sheetName: $("#attachSheet").value.trim(),
    ...protocolPayload(),
    ...signaturePayload($("#finalSigner"), $("#finalSignerCargo")),
    slots
  });
  if (!payload) return;
  await saveCurrentProtocolSilently();
  const result = await run("PDF final gerado.", () => window.execej.generateFinalPdf(payload));
  scheduleProtocolFileRefresh();
  if (result.warning) alert(`${result.warning}\n\nPDF criado:\n${result.output}`);
  else alert(`PDF/A final criado:\n${result.output}`);
}

function fileParent(path) {
  return String(path || "").replace(/[\\/][^\\/]+$/, "");
}

function initPdfA() {
  $("#pickPdfaSource").addEventListener("click", async () => {
    const path = await window.execej.pickFile({ title: "Selecionar arquivo", filters: fileFilters() });
    if (!path) return;
    $("#pdfaSource").value = path;
    if (!$("#pdfaOutputDir").value.trim()) $("#pdfaOutputDir").value = fileParent(path);
  });
  $("#pickPdfaOutputDir").addEventListener("click", async () => {
    const path = await window.execej.pickFolder({ title: "Selecionar pasta de saída" });
    if (path) $("#pdfaOutputDir").value = path;
  });
  $("#convertPdfa").addEventListener("click", async () => {
    const result = await run("PDF/A criado.", () => window.execej.convertToPdfA({
      sourcePath: $("#pdfaSource").value.trim(),
      outputDir: $("#pdfaOutputDir").value.trim()
    }));
    $("#pdfaOutput").value = result.output || "";
    scheduleProtocolFileRefresh();
    const detail = result.warning ? `\n\n${result.warning}` : "";
    alert(`PDF/A criado:\n${result.output}${detail}`);
  });
  $("#openPdfaOutput").addEventListener("click", () => {
    const output = $("#pdfaOutput").value.trim();
    if (output) window.execej.openPath(output);
  });
  window.execej.onPdfAProgress((message) => log(message));
}

function parentFolder(path) {
  return String(path || "").replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "");
}

function updateArispSearchRoot() {
  const input = $("#arispSearchRoot");
  if (input) input.value = parentFolder(config.initial_folder_root || "");
}

function renderArispRows(rows) {
  const body = $("#arispTable tbody");
  body.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.officeProtocol || ""}</td>
      <td>${row.prenotation || ""}</td>
      <td>${row.debtValue || ""}</td>
      <td>${row.mutuoDestination || ""}</td>
      <td>${row.cpf || ""}</td>
    `;
    body.appendChild(tr);
  }
}

function initArispStats() {
  const monthSelect = $("#arispMonth");
  monthSelect.innerHTML = "";
  for (const [value, label] of arispMonths) monthSelect.add(new Option(label, value));
  const now = new Date();
  monthSelect.value = String(now.getMonth() + 1);
  $("#arispYear").value = String(now.getFullYear());
  $("#openArispOutput").addEventListener("click", () => {
    const output = $("#arispOutput").value.trim();
    if (output) window.execej.openPath(output);
  });
  $("#generateArispStats").addEventListener("click", async () => {
    const result = await run("Estatísticas ARISP geradas.", () => window.execej.generateArispStats({
      month: Number($("#arispMonth").value),
      year: Number($("#arispYear").value)
    }));
    $("#arispOutput").value = result.output || "";
    $("#arispSearchRoot").value = result.searchRoot || "";
    renderArispRows(result.rows || []);
    const warningText = result.warnings?.length ? ` ${result.warnings.length} aviso(s) no processamento.` : "";
    $("#arispSummary").textContent = `${result.rows.length} protocolo(s) encontrado(s) em ${result.scanned} planilha(s) analisada(s).${warningText}`;
    if (result.warnings?.length) log(result.warnings.join("\n"));
  });
  window.execej.onArispStatsProgress((message) => log(message));
}

function initConfig() {
  initConfigSubtabs();
  $("#signers_text").addEventListener("input", () => updateDefaultSignerOptions());
  $("#onr_signature_enabled").addEventListener("change", (event) => {
    $("#onrApiKeySetting").hidden = !event.currentTarget.checked;
  });
  $("#image_autuation_enabled").addEventListener("change", (event) => {
    $("#imageExportSettings").hidden = !event.currentTarget.checked;
  });
  $("#addMovementRule").addEventListener("click", () => addMovementRuleRow({ quantity: "1+" }));
  $("#resetMovementRules").addEventListener("click", () => renderMovementRules(cloneDefaultMovementRows()));
  $("#addMovementPrefill").addEventListener("click", () => addMovementPrefillRow(""));
  $("#resetMovementPrefill").addEventListener("click", () => renderMovementPrefillOptions(cloneDefaultMovementPrefillOptions()));
  $("#addRtdCostRow").addEventListener("click", () => addRtdCostRow({ addsAnnex: "SIM" }));
  $("#clearRtdCostRows").addEventListener("click", () => {
    if (confirm("Limpar toda a Tabela de Custas RTD das configurações?")) renderRtdCostTable([]);
  });
  $("#saveConfig").addEventListener("click", async () => {
    const data = readConfig();
    if (data.onr_signature_enabled && !data.onr_api_key) {
      alert("Informe a X-Api-Key da ONR antes de ativar a assinatura.");
      $("#onr_api_key").focus();
      return;
    }
    if (data.image_autuation_enabled) {
      if (!data.image_output_folder) {
        alert("Escolha a pasta para salvar as imagens geradas pelo vínculo com o IMAGE.");
        $("#image_output_folder").focus();
        return;
      }
      if (!data.image_output_filename) {
        alert("Informe o padrão do nome do arquivo do IMAGE.");
        $("#image_output_filename").focus();
        return;
      }
      if (!Number.isSafeInteger(data.image_output_bucket_size) || data.image_output_bucket_size < 1) {
        alert("Informe uma faixa de prenotações válida, usando um número inteiro positivo.");
        $("#image_output_bucket_size").focus();
        return;
      }
      if (!data.image_output_folder_pattern) {
        alert("Informe o padrão das subpastas do IMAGE.");
        $("#image_output_folder_pattern").focus();
        return;
      }
    }
    config = await run("Configurações salvas.", () => window.execej.saveConfig(data));
    fillConfig();
  });
}

function initInitialFolder() {
  $("#createInitial").addEventListener("click", async () => {
    const result = await run("Pasta inicial criada.", () => window.execej.createInitialFolder({
      officeProtocol: $("#initialOfficeProtocol").value.trim(),
      prenotation: $("#initialPrenotation").value.trim(),
      overwrite: $("#initialOverwrite").checked
    }));
    $("#initialCreatedFolder").value = result.folder;
    $("#initialCreatedProtocol").value = result.protocolFile;
    if (selectedProtocol()) {
      const saved = await window.execej.saveProtocol({
        ...readProtocolForm(),
        officeProtocol: $("#initialOfficeProtocol").value.trim(),
        prenotation: $("#initialPrenotation").value.trim(),
        folderPath: result.folder,
        odsPath: result.protocolFile
      });
      await reloadProtocols(saved.id);
      scheduleProtocolFileRefresh();
    } else {
      applyProtocol({ odsPath: result.protocolFile, folderPath: result.folder, officeProtocol: $("#initialOfficeProtocol").value.trim(), prenotation: $("#initialPrenotation").value.trim() });
    }
  });
}

function initUpdates() {
  $("#checkUpdates").addEventListener("click", () => window.execej.checkUpdates());
  window.execej.onUpdateAvailable((info) => {
    if (confirm(`Atualização disponível: ${info.version || info.tagName}\n\nBaixar agora?`)) {
      window.execej.downloadUpdate();
    }
  });
  window.execej.onUpdateNotAvailable(() => alert("Nenhuma atualização disponível."));
  window.execej.onUpdateProgress((progress) => log(`Baixando atualização: ${Math.round(progress.percent)}%`));
  window.execej.onUpdateDownloaded(() => {
    if (confirm("Atualização baixada. Instalar e reiniciar agora?")) window.execej.installUpdate();
  });
}

async function main() {
  $("#version").textContent = `v${await window.execej.version()}`;
  config = await window.execej.loadConfig();
  initProtocols();
  fillConfig();
  initTabs();
  initPickers();
  initConfig();
  initInitialFolder();
  initNote();
  initMerge("letters");
  initMerge("certificate");
  initArispStats();
  initAttachments();
  initPdfA();
  initUpdates();
  refreshSignatureControls();
}

main().catch((error) => {
  log(error.message || String(error));
});
