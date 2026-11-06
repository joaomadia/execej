const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const core = require("../src/core");

test("a protocol is closed only when an archived movement is autuated", () => {
  assert.equal(core.protocolIsClosed({}), false);
  assert.equal(core.protocolIsClosed({
    autuacoesMovimentacoes: { 1: { movement: "Consolidação" } }
  }), false);
  assert.equal(core.protocolIsClosed({
    autuacoesMovimentacoes: { 1: { movement: "arquivamento" } }
  }), true);
});

test("existing autuation PDFs recover matching movement states including archiving", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-autuations-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const files = [
    "Prenotado - 27.10.2026 - IN12345678 - 12345.pdf",
    "Arquivamento - 28.10.2026 - IN12345678 - 12345.pdf",
    "Intimação Positiva - 29.10.2026 - IN12345678 - 12345.pdf",
    "unrelated.pdf"
  ].map((name) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, "pdf");
    return filePath;
  });
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "27/10/2026", "27", "outubro", "2026", "Autuação"],
    ["", "Arquivamento", "28/10/2026", "28", "outubro", "2026", "Certidão Arquivamento por Consolidação"],
    ["", "Intimado", "29/10/2026", "29", "outubro", "2026", "Certidão Notificações RTD Positivas"]
  ];

  const recovered = core.recoverAutuationsFromPdfs(movements, files, {
    movement_document_rules: [{ movement: "Prenotado", file: "Autuação" }],
    movement_attachment_rules: [{ movement: "Intimado", document: "Intimação Positiva (DATA)", quantity: "1+" }]
  });

  assert.deepEqual(Object.keys(recovered), ["1", "2", "3"]);
  assert.equal(recovered["1"].movement, "Prenotado");
  assert.equal(recovered["2"].movement, "Arquivamento");
  assert.equal(recovered["2"].files[0], files[1]);
  assert.equal(recovered["3"].movement, "Intimado");
  assert.equal(recovered["3"].hasAttachments, true);
  assert.equal(core.protocolIsClosed({ autuacoesMovimentacoes: recovered }), true);
});

test("archiving recovery matches a shorter PDF label than the movement description", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-archive-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPath = path.join(tempDir, "Arquivamento - 03.11.2026 - Protocolo IN01676188C - 40.828.pdf");
  fs.writeFileSync(pdfPath, "pdf");
  const recovered = core.recoverAutuationsFromPdfs([
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Arquivamento por Consolidação", "03/11/2026", "03", "novembro", "2026", "Certidão Arquivamento por Consolidação"]
  ], [pdfPath]);

  assert.deepEqual(Object.keys(recovered), ["1"]);
  assert.equal(recovered["1"].movement, "Arquivamento por Consolidação");
  assert.equal(recovered["1"].files[0], pdfPath);
});

test("archiving PDFs add missing movements to an imported workbook and are marked autuated", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-movement-row-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPath = path.join(tempDir, "Arquivamento - 03.11.2026 - Protocolo IN01676188C - 40.828.pdf");
  fs.writeFileSync(pdfPath, "pdf");
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "20/10/2026", "20", "outubro", "2026", "Autuação"]
  ];

  core.recoverMovementsFromPdfs(movements, [pdfPath]);
  const recovered = core.recoverAutuationsFromPdfs(movements, [pdfPath]);

  assert.equal(movements[2][1], "Arquivamento");
  assert.equal(movements[2][2], "03/11/2026");
  assert.deepEqual(Object.keys(recovered), ["2"]);
  assert.equal(recovered["2"].movement, "Arquivamento");
  assert.equal(core.protocolIsClosed({ autuacoesMovimentacoes: recovered }), true);
});

test("saldo a devolver certificates recover the missing movement and autuation", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-saldo-devolver-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPath = path.join(tempDir, "Certidão de Saldo a Devolver - 06.11.2026 - Protocolo IN01676188C - 40.828.pdf");
  fs.writeFileSync(pdfPath, "pdf");
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "27/08/2026", "27", "agosto", "2026", "Autuação"]
  ];

  core.recoverMovementsFromPdfs(movements, [pdfPath]);
  const recovered = core.recoverAutuationsFromPdfs(movements, [pdfPath]);

  assert.equal(movements[2][1], "Saldo a Devolver");
  assert.equal(movements[2][2], "06/11/2026");
  assert.deepEqual(Object.keys(recovered), ["2"]);
  assert.equal(recovered["2"].movement, "Saldo a Devolver");
  assert.equal(recovered["2"].files[0], pdfPath);
});

test("configured fixed and attachment rules recover their movements in reverse", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-configured-rules-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const config = {
    movement_document_rules: [{ movement: "Inspeção Especial", file: "Certidão Inspeção Especial" }],
    movement_attachment_rules: [{ movement: "Anexo Especial", document: "Documento Técnico (DATA)", quantity: "1+" }],
    movement_input_rules: []
  };
  const pdfPaths = [
    "Inspeção Especial - 04.11.2026 - Protocolo IN12345678 - 12345.pdf",
    "Documento Técnico - 05.11.2026 - Protocolo IN12345678 - 12345.pdf"
  ].map((name) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, "pdf");
    return filePath;
  });
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "27/08/2026", "27", "agosto", "2026", "Autuação"]
  ];

  core.recoverMovementsFromPdfs(movements, pdfPaths, config);
  const recovered = core.recoverAutuationsFromPdfs(movements, pdfPaths, config);

  assert.equal(movements[2][1], "Inspeção Especial");
  assert.equal(movements[2][6], "Certidão Inspeção Especial");
  assert.equal(movements[3][1], "Anexo Especial");
  assert.deepEqual(Object.keys(recovered), ["2", "3"]);
  assert.equal(recovered["2"].files[0], pdfPaths[0]);
  assert.equal(recovered["3"].files[0], pdfPaths[1]);
  assert.equal(recovered["3"].hasAttachments, true);
});

test("movement-prefixed attachments disambiguate rules with the same document label", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-ambiguous-attachments-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const config = {
    movement_document_rules: [],
    movement_attachment_rules: [
      { movement: "Ato Alfa", document: "Documento Compartilhado (DATA)", quantity: "1+" },
      { movement: "Ato Beta", document: "Documento Compartilhado (DATA)", quantity: "1+" }
    ],
    movement_input_rules: []
  };
  const pdfPath = path.join(tempDir, "Ato Beta - Documento Compartilhado - 06.11.2026 - Protocolo IN12345678 - 12345.pdf");
  fs.writeFileSync(pdfPath, "pdf");
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "27/08/2026", "27", "agosto", "2026", "Autuação"]
  ];

  core.recoverMovementsFromPdfs(movements, [pdfPath], config);
  const recovered = core.recoverAutuationsFromPdfs(movements, [pdfPath], config);

  assert.equal(movements[2][1], "Ato Beta");
  assert.deepEqual(Object.keys(recovered), ["2"]);
  assert.equal(recovered["2"].files[0], pdfPath);
  assert.equal(recovered["2"].hasAttachments, true);
});

test("movement aliases are canonicalized and same-date alias duplicates are removed", () => {
  const config = {
    movement_document_rules: [{ movement: "Prenotado", file: "Autuação" }],
    movement_attachment_rules: [
      { movement: "Prenotado; Prenotação", document: "Prenotação (DATA)", quantity: "1+" },
      { movement: "Transcurso de Prazo (Purga de Mora); Transcurso de Prazo", document: "Certidão de Transcurso de Prazo", quantity: "1+" }
    ]
  };
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "27/08/2026", "27", "agosto", "2026", "Autuação"],
    ["", "Prenotação", "27/08/2026", "27", "agosto", "2026", ""],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", ""],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", ""],
    ["", "Transcurso de Prazo", "08/10/2026", "08", "outubro", "2026", ""],
    ["", "Transcurso de Prazo (Purga de Mora)", "08/10/2026", "08", "outubro", "2026", ""]
  ];

  core.recoverMovementsFromPdfs(movements, [], config);

  assert.deepEqual(
    movements.slice(1).filter((row) => row[1]).map((row) => row[1]),
    ["Prenotado", "Intimado", "Transcurso de Prazo (Purga de Mora)"]
  );
});

test("recovering movements from PDFs does not append existing movement and date pairs again", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-no-duplicate-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPath = path.join(tempDir, "Arquivamento - 03.11.2026 - Protocolo IN01676188C - 40.828.pdf");
  fs.writeFileSync(pdfPath, "pdf");
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Arquivamento por Consolidação", "03/11/2026", "03", "novembro", "2026", "Certidão Arquivamento por Consolidação"]
  ];

  core.recoverMovementsFromPdfs(movements, [pdfPath]);

  assert.equal(movements.length, 2);
});

test("PDF prenotado replaces the automatic row and recovered movements are chronological", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-movement-order-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPaths = [
    "Prenotado - 27.08.2026 - Protocolo IN01676188C - 40.828.pdf",
    "Intimado - 16.09.2026 - Protocolo IN01676188C - 40.828.pdf",
    "Arquivamento - 03.11.2026 - Protocolo IN01676188C - 40.828.pdf"
  ].map((name) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, "pdf");
    return filePath;
  });
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "", "", "", "", "Autuação"],
    ["", "Arquivamento", "03/11/2026", "03", "novembro", "2026", "Certidão Arquivamento por Consolidação"],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", "Certidão Notificações RTD Positivas"]
  ];

  core.recoverMovementsFromPdfs(movements, pdfPaths);
  const movementEntries = movements.slice(1).filter((row) => row[1]).map((row) => `${row[1]}|${row[2]}`);
  const recovered = core.recoverAutuationsFromPdfs(movements, pdfPaths);

  assert.deepEqual(movementEntries, [
    "Prenotado|27/08/2026",
    "Intimado|16/09/2026",
    "Arquivamento|03/11/2026"
  ]);
  assert.equal(movements.filter((row) => row[1] === "Prenotado").length, 1);
  assert.deepEqual(Object.keys(recovered), ["1", "2", "3"]);
});

test("duplicate same-date intimado rows recovered earlier are collapsed to one", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-intimado-duplicates-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPath = path.join(tempDir, "Intimado - 16.09.2026 - Protocolo IN01676188C - 40.828.pdf");
  fs.writeFileSync(pdfPath, "pdf");
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", ""],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", ""],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", ""]
  ];

  core.recoverMovementsFromPdfs(movements, [pdfPath]);
  const recovered = core.recoverAutuationsFromPdfs(movements, [pdfPath]);

  assert.equal(movements.filter((row) => row[1] === "Intimado").length, 1);
  assert.deepEqual(Object.keys(recovered), ["1"]);
});

test("the protocol's Intimado and Intimação Positiva PDFs create one autuated movement", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-intimado-pdf-pair-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPaths = [
    "Intimacao Positiva - 16.09.2026 - Protocolo IN01676188C - 40.828.pdf",
    "Intimado - 16.09.2026 - Protocolo IN01676188C - 40.828.pdf"
  ].map((name) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, "pdf");
    return filePath;
  });
  const movements = [
    ["PROTOCOLO:", "", "DATA NA AUTUAÇÃO", "", "", ""],
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Prenotado", "27/08/2026", "27", "agosto", "2026", "Autuação"],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", "Certidão Notificações RTD Positivas"],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", "Certidão Notificações RTD Positivas"]
  ];
  const config = core.normalizeConfig({});

  core.recoverMovementsFromPdfs(movements, pdfPaths, config);
  const recovered = core.recoverAutuationsFromPdfs(movements, pdfPaths, config);
  const intimadoRows = movements
    .map((row, sourceRow) => ({ row, sourceRow }))
    .filter(({ row }) => row[1] === "Intimado");

  assert.equal(intimadoRows.length, 1);
  assert.deepEqual(Object.keys(recovered), ["3"]);
  assert.deepEqual(
    new Set(recovered["3"].files.map((file) => path.basename(file))),
    new Set(pdfPaths.map((file) => path.basename(file)))
  );
});

test("partial preview sorts recovered PDFs by movement row, not PDF modification time", () => {
  const records = core.autuationRecordsInMovementOrder({
    12: { files: ["novembro.pdf"], autuadoEm: "2026-09-01T00:00:00.000Z" },
    4: { files: ["setembro.pdf"], autuadoEm: "2026-11-01T00:00:00.000Z" },
    8: { files: ["outubro.pdf"], autuadoEm: "2026-10-01T00:00:00.000Z" }
  });

  assert.deepEqual(records.map(([row]) => row), ["4", "8", "12"]);
});

test("autuation preview puts the Prenotado cover before its attachments", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-autuation-cover-order-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const protocolFolder = path.join(tempDir, "protocol");
  const pdfsDir = path.join(protocolFolder, "Autuação", "PDFs");
  const outputDir = path.join(tempDir, "preview");
  fs.mkdirSync(pdfsDir, { recursive: true });

  const createPdf = async (filename, width) => {
    const pdf = await PDFDocument.create();
    pdf.addPage([width, 200]);
    const filePath = path.join(pdfsDir, filename);
    fs.writeFileSync(filePath, await pdf.save());
    return filePath;
  };
  const attachment = await createPdf("Caixa - 27.08.2026 - IN01676188C - 40.828.pdf", 100);
  const cover = await createPdf("Prenotado - 27.08.2026 - IN01676188C - 40.828.pdf", 300);
  const output = await core.createAutuationPreview({
    1: {
      files: [attachment, cover],
      movement: "Prenotado",
      documentName: "Autuação"
    }
  }, protocolFolder, outputDir);
  const merged = await PDFDocument.load(fs.readFileSync(output));

  assert.equal(merged.getPageCount(), 2);
  assert.equal(merged.getPage(0).getWidth(), 300);
  assert.equal(merged.getPage(1).getWidth(), 100);
});

test("numbered PDFs stay in natural order within every autuation movement", () => {
  const records = {
    1: {
      movement: "Prenotado",
      documentName: "Autuação",
      parts: [
        { file: "Prenotado - 27.08.2026 - Protocolo - 40.828 - 03.pdf", order: 0 },
        { file: "Prenotado - 27.08.2026 - Protocolo - 40.828 - 02.pdf", order: 1 },
        { file: "Prenotado - 27.08.2026 - Protocolo - 40.828.pdf", order: 2 }
      ],
      files: []
    },
    2: {
      movement: "Intimado",
      documentName: "Certidão Intimação",
      parts: [
        { file: "Intimado - 16.09.2026 - Protocolo - 40.828 - 03.pdf", order: 0 },
        { file: "Intimado - 16.09.2026 - Protocolo - 40.828.pdf", order: 1 },
        { file: "Intimado - 16.09.2026 - Protocolo - 40.828 - 02.pdf", order: 2 }
      ],
      files: []
    }
  };

  assert.deepEqual(
    core.autuationRecordsInMovementOrder(records).flatMap(([, record]) => (
      core.autuationRecordParts(record).map((part) => path.basename(part.file))
    )),
    [
      "Prenotado - 27.08.2026 - Protocolo - 40.828.pdf",
      "Prenotado - 27.08.2026 - Protocolo - 40.828 - 02.pdf",
      "Prenotado - 27.08.2026 - Protocolo - 40.828 - 03.pdf",
      "Intimado - 16.09.2026 - Protocolo - 40.828.pdf",
      "Intimado - 16.09.2026 - Protocolo - 40.828 - 02.pdf",
      "Intimado - 16.09.2026 - Protocolo - 40.828 - 03.pdf"
    ]
  );
});

test("fixed autuation documents come before attachments within each movement", () => {
  const record = {
    movement: "Intimado",
    documentName: "Certidão Intimação",
    files: [],
    parts: [
      { file: "Intimação Positiva - 16.09.2026 - Protocolo - 40.828.pdf", order: 0, kind: "attachment" },
      { file: "Intimado - 16.09.2026 - Protocolo - 40.828.pdf", order: 1000, kind: "document" },
      { file: "Intimação Positiva - 16.09.2026 - Protocolo - 40.828 - 02.pdf", order: 1, kind: "attachment" },
      { file: "Intimado - 16.09.2026 - Protocolo - 40.828 - 02.pdf", order: 1001, kind: "document" }
    ]
  };

  const orderedParts = core.autuationRecordParts(record);
  assert.deepEqual(
    orderedParts.map((part) => path.basename(part.file)),
    [
      "Intimado - 16.09.2026 - Protocolo - 40.828.pdf",
      "Intimado - 16.09.2026 - Protocolo - 40.828 - 02.pdf",
      "Intimação Positiva - 16.09.2026 - Protocolo - 40.828.pdf",
      "Intimação Positiva - 16.09.2026 - Protocolo - 40.828 - 02.pdf"
    ]
  );
  assert.deepEqual(orderedParts.map((part) => part.order), [0, 1, 2, 3]);
});

test("PDF recovery classifies fixed documents separately from attachments", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-recover-part-kinds-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const pdfPaths = [
    "Intimado - 16.09.2026 - Protocolo IN01676188C - 40.828.pdf",
    "Intimação Positiva - 16.09.2026 - Protocolo IN01676188C - 40.828.pdf"
  ].map((name) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, "pdf");
    return filePath;
  });
  const recovered = core.recoverAutuationsFromPdfs([
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", "Certidão Notificações RTD Positivas"]
  ], pdfPaths, {
    movement_attachment_rules: [{ movement: "Intimado", document: "Intimação Positiva (DATA)", quantity: "1+" }]
  });

  assert.deepEqual(recovered["1"].parts.map((part) => part.kind), ["document", "attachment"]);
});

test("stale repeated intimado autuations are removed after movement deduplication", () => {
  const movements = [
    ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
    ["", "Intimado", "16/09/2026", "16", "setembro", "2026", ""]
  ];
  const stored = {
    1: { movement: "Intimado", files: ["intimado-antigo.pdf"] },
    2: { movement: "Intimado", files: ["intimado-duplicado.pdf"] },
    3: { movement: "Arquivamento", files: ["arquivamento.pdf"] }
  };
  const recovered = { 1: { movement: "Intimado", files: ["intimado-recuperado.pdf"] } };

  const result = core.mergeRecoveredAutuations(movements, stored, recovered);

  assert.deepEqual(Object.keys(result), ["1"]);
  assert.deepEqual(result["1"].files, ["intimado-recuperado.pdf"]);
});
