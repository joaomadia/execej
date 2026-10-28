const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../src/core");

const normalize = (value) => String(value)
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .replace(/[^0-9A-Za-z]+/g, "")
  .toUpperCase();

function sheetByName(workbook, name) {
  const sheetName = workbook.sheetOrder.find((candidate) => normalize(candidate) === normalize(name));
  assert.ok(sheetName, `expected sheet ${name}`);
  return workbook.sheets[sheetName];
}

test("protocol workbook has app-owned headers for every guide", () => {
  const workbook = core.applyProtocolWorkbookCalculations({ sheetOrder: [], sheets: {} });

  assert.equal(workbook.sheetOrder.length, 8);
  for (const name of ["Extração de Arquivos", "Notificações", "Intimação", "Transcurso de Prazo", "Consolidação", "Tabela de Custas RTD"]) {
    assert.ok(sheetByName(workbook, name)[0].every((header) => String(header).trim()), `all ${name} headings should be populated`);
  }
  assert.deepEqual(sheetByName(workbook, "Extração de Arquivos")[0], [
    "ASSINOU DIGITALMENTE", "DOC_TIPO", "CPF ou CNPJ", "DATA EXTRAÇÃO", "PRENOTAÇÃO?",
    "DATA EXTENSO", "PRENOTAÇÃO", "PREN_FORMATADA", "ID"
  ]);
  assert.deepEqual(sheetByName(workbook, "Consolidação")[0], [
    "Nº AVERBAÇÃO", "AVERBAÇÃO_FORMATADO", "MATRÍCULA", "MATRÍCULA_FORMATADA"
  ]);
  assert.deepEqual(sheetByName(workbook, "Tabela de Custas RTD")[0], [
    "CIDADE", "FATOR", "ACEITA PROCURAÇÃO", "ADICIONA ANEXO?"
  ]);
  assert.deepEqual(sheetByName(workbook, "Movimentações")[1].slice(1, 7), [
    "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"
  ]);
});

test("reordered and incomplete headers migrate values and preserve extra columns", () => {
  const workbook = core.applyProtocolWorkbookCalculations({
    sheetOrder: ["Notificações"],
    sheets: {
      "Notificações": [
        ["NOME", "SEXO", "CPF/CNPJ", "CIDADE/ESTADO", "MATRÍCULA", "OBS"],
        ["Joana Exemplo", "F", "123.456.789-00", "Taubaté/SP", "12345", "Manter este dado"]
      ]
    }
  });
  const rows = sheetByName(workbook, "Notificações");
  assert.equal(rows[0][4], "NOME");
  assert.equal(rows[1][4], "Joana Exemplo");
  assert.equal(rows[1][0], "F");
  assert.equal(rows[1][5], "123.456.789-00");
  assert.equal(rows[1][11], "Taubaté/SP");
  assert.equal(rows[1][18], "12345");
  assert.equal(rows[1][6], "CPF/MF");
  assert.equal(rows[0][30], "Campo adicional 1");
  assert.equal(rows[1][30], "Manter este dado");
});

test("headerless data uses app columns and generated calculations", () => {
  const workbook = core.applyProtocolWorkbookCalculations({
    sheetOrder: ["Consolidação"],
    sheets: {
      "Consolidação": [["07", "", "12345", ""]]
    }
  });
  const rows = sheetByName(workbook, "Consolidação");
  assert.equal(rows[0][0], "Nº AVERBAÇÃO");
  assert.equal(rows[1][0], "07");
  assert.equal(rows[1][1], "07");
  assert.equal(rows[1][2], "12345");
  assert.equal(rows[1][3], "12.345");
});

test("intimation certificate date variants keep their semantic headings", () => {
  const workbook = core.applyProtocolWorkbookCalculations({
    sheetOrder: ["Intimação"],
    sheets: {
      "Intimação": [
        ["NOME", "DATA CERTIDÃO NEGATIVA", "RESULTADO"],
        ["Joana Exemplo", "28/10/2026", "Negativa"]
      ]
    }
  });
  const rows = sheetByName(workbook, "Intimação");
  assert.equal(rows[0][15], "DATA DA CERTIDÃO NEGATIVA");
  assert.equal(rows[1][12], "Joana Exemplo");
  assert.equal(rows[1][15], "28/10/2026");
});

test("RTD source aliases are mapped to the internal schema", () => {
  const workbook = core.applyProtocolWorkbookCalculations({
    sheetOrder: ["Tabela de Custas RTD"],
    sheets: {
      "Tabela de Custas RTD": [
        ["CIDADE/ESTADO", "ALÍQUOTA", "ACEITA PROCURAÇÃO?"],
        ["Taubaté/SP", "1,062", "SIM"]
      ]
    }
  });
  assert.deepEqual(sheetByName(workbook, "Tabela de Custas RTD")[0], [
    "CIDADE", "FATOR", "ACEITA PROCURAÇÃO", "ADICIONA ANEXO?"
  ]);
  assert.deepEqual(core.rtdCostTableFromWorkbook(workbook), [{
    city: "Taubaté/SP",
    rate: "1,062",
    acceptsPower: "SIM",
    addsAnnex: "SIM"
  }]);
});

test("ODS imports use canonical fields while preserving user-created extra headers", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-sheet-schema-"));
  try {
    const odsPath = path.join(tempDir, "protocol.ods");
    core.writeWorkbookOds(odsPath, {
      sheetOrder: ["Consolidação"],
      sheets: {
        "Consolidação": [
          ["MATRÍCULA", "Nº AVERBAÇÃO", "Nova coluna E"],
          ["12345", "9", "Observação preservada"]
        ]
      }
    });
    const imported = core.applyProtocolWorkbookCalculations(core.protocolSheetsFromOds(odsPath));
    const rows = sheetByName(imported, "Consolidação");
    assert.deepEqual(rows[0].slice(0, 4), [
      "Nº AVERBAÇÃO", "AVERBAÇÃO_FORMATADO", "MATRÍCULA", "MATRÍCULA_FORMATADA"
    ]);
    assert.equal(rows[1][0], "9");
    assert.equal(rows[1][1], "09");
    assert.equal(rows[1][2], "12345");
    assert.equal(rows[1][3], "12.345");
    assert.equal(rows[0][4], "Nova coluna E");
    assert.equal(rows[1][4], "Observação preservada");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Custas keeps its specialized calculation layout", () => {
  const workbook = core.applyProtocolWorkbookCalculations({ sheetOrder: [], sheets: {} });
  const rows = sheetByName(workbook, "Custas Intimação");
  assert.ok(rows.length >= 9);
  assert.equal(rows[1][9], "CUSTAS TOTAIS");
});
