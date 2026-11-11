const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const { PDFParse } = require("pdf-parse");
const core = require("../src/core");

async function createPdf(filePath, pageCount = 1) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage();
  fs.writeFileSync(filePath, await document.save());
}

async function extractPdfText(filePath) {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  try {
    return (await parser.getText()).pages.map((page) => page.text);
  } finally {
    await parser.destroy();
  }
}

test("numbers pages of each partial autuation continuously in attachment order", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-attachment-page-numbers-"));
  try {
    const protocolFolder = path.join(tempDir, "protocol");
    const odsPath = path.join(tempDir, "protocol.ods");
    const firstAttachment = path.join(tempDir, "first.pdf");
    const secondAttachment = path.join(tempDir, "second.pdf");
    fs.mkdirSync(protocolFolder);
    await createPdf(firstAttachment, 2);
    await createPdf(secondAttachment);
    core.writeWorkbookOds(odsPath, {
      sheetOrder: ["Movimentações"],
      sheets: {
        "Movimentações": [
          ["", "PROTOCOLO:", "", "", "", "", ""],
          ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
          ["", "Exigência", "28/10/2026", "28", "outubro", "2026", ""]
        ]
      }
    });
    const config = {
      models_folder: path.join(tempDir, "models"),
      movement_document_rules: [],
      movement_attachment_rules: [
        { movement: "Exigência", document: "Documento da exigência", quantity: "1+" }
      ]
    };
    const [requirement] = core.movementAttachmentRequirements(odsPath, "Movimentações", 2, config);
    const result = await core.autuarMovimentacao(config, {
      odsPath,
      sheetName: "Movimentações",
      sourceRowIndex: 2,
      protocolFolder,
      officeProtocol: "IN12345678",
      prenotation: "12345",
      attachments: [{ title: requirement.title, files: [firstAttachment, secondAttachment] }]
    });

    const pageTexts = await Promise.all(result.files.map(extractPdfText));
    assert.deepEqual(pageTexts.map((pages) => pages.length), [2, 1]);
    assert.deepEqual(pageTexts.flat().map((text) => text.match(/\b\d+\b/g)), [["1"], ["2"], ["3"]]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("autuates attachment-only movements without requiring a fixed document", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-attachment-only-"));
  try {
    const protocolFolder = path.join(tempDir, "protocol");
    const odsPath = path.join(tempDir, "protocol.ods");
    const attachmentPath = path.join(tempDir, "Anexo.pdf");
    fs.mkdirSync(protocolFolder);
    await createPdf(attachmentPath);
    core.writeWorkbookOds(odsPath, {
      sheetOrder: ["Movimentações"],
      sheets: {
        "Movimentações": [
          ["", "PROTOCOLO:", "", "", "", "", ""],
          ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
          ["", "Exigência", "28/10/2026", "28", "outubro", "2026", ""]
        ]
      }
    });
    const config = {
      models_folder: path.join(tempDir, "models"),
      movement_document_rules: [],
      movement_attachment_rules: [
        { movement: "Exigência", document: "Documento da exigência", quantity: "1" }
      ]
    };
    const requirements = core.movementAttachmentRequirements(odsPath, "Movimentações", 2, config);
    assert.equal(requirements.length, 1);
    assert.equal(requirements[0].title, "Documento da exigência");
    assert.equal(core.movementRequiresOnrSignature(odsPath, "Movimentações", 2, config), false);

    const result = await core.autuarMovimentacao(config, {
      odsPath,
      sheetName: "Movimentações",
      sourceRowIndex: 2,
      protocolFolder,
      officeProtocol: "IN12345678",
      prenotation: "12345",
      attachments: [{ title: requirements[0].title, files: [attachmentPath] }]
    });

    assert.equal(result.documentName, "");
    assert.equal(result.hasAttachments, true);
    assert.equal(result.files.length, 1);
    assert.equal(path.dirname(result.files[0]), path.join(protocolFolder, "Autuação", "PDFs"));
    assert.match(path.basename(result.files[0]), /^Exigencia - Documento da exigencia - 28\.10\.2026 - /);
    assert.ok(fs.existsSync(result.files[0]));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("names the partial autuation preview from the office protocol and prenotation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-autuation-preview-name-"));
  try {
    const protocolFolder = path.join(tempDir, "protocol");
    const pdfsDir = path.join(protocolFolder, "Autuação", "PDFs");
    const outputDir = path.join(tempDir, "preview");
    const pdfPath = path.join(pdfsDir, "movement.pdf");
    fs.mkdirSync(pdfsDir, { recursive: true });
    await createPdf(pdfPath);

    const output = await core.createAutuationPreview({
      "2": { files: [pdfPath], parts: [{ file: pdfPath, order: 0 }] }
    }, protocolFolder, outputDir, "IN12345678 - 40000.pdf");

    assert.equal(path.basename(output), "IN12345678 - 40000.pdf");
    assert.ok(fs.existsSync(output));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("requires the talão at final archiving autuation and reuses it as the final PDF bookend", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-archive-talao-"));
  try {
    const protocolFolder = path.join(tempDir, "protocol");
    const modelsFolder = path.join(tempDir, "models");
    const pdfsDir = path.join(protocolFolder, "Autuação", "PDFs");
    const odsPath = path.join(tempDir, "protocol.ods");
    const talaoPath = path.join(tempDir, "Certidão Talão.pdf");
    const modelPath = path.join(modelsFolder, "Certidão Arquivamento por Consolidação.pdf");
    fs.mkdirSync(pdfsDir, { recursive: true });
    fs.mkdirSync(modelsFolder);
    await createPdf(talaoPath);
    await createPdf(modelPath);
    core.writeWorkbookOds(odsPath, {
      sheetOrder: ["Movimentações"],
      sheets: {
        "Movimentações": [
          ["", "PROTOCOLO:", "", "", "", "", ""],
          ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
          ["", "Prenotado", "27/10/2026", "27", "outubro", "2026", "Autuação"],
          ["", "Arquivamento", "28/10/2026", "28", "outubro", "2026", "Certidão Arquivamento por Consolidação"]
        ]
      }
    });
    const config = {
      models_folder: modelsFolder,
      movement_document_rules: [],
      movement_attachment_rules: []
    };
    const requirements = core.movementAttachmentRequirements(odsPath, "Movimentações", 3, config);
    assert.equal(requirements.length, 1);
    assert.equal(requirements[0].title, "Certidão Talão");
    assert.equal(requirements[0].fixed_position, "bookend");
    assert.equal(requirements[0].single_file, true);

    const archived = await core.autuarMovimentacao(config, {
      odsPath,
      sheetName: "Movimentações",
      sourceRowIndex: 3,
      protocolFolder,
      officeProtocol: "IN12345678",
      prenotation: "12345",
      attachments: [{ title: "Certidão Talão", files: [talaoPath] }]
    });
    const talaoPart = archived.parts.find((part) => part.fixedPosition === "bookend");
    assert.ok(talaoPart);
    assert.equal(archived.files.length, 2);

    const prenotacaoPath = path.join(pdfsDir, "Prenotado.pdf");
    await createPdf(prenotacaoPath);
    const result = await core.generateFinalPdf(config, {
      odsPath,
      sheetName: "Movimentações",
      protocolFolder,
      officeProtocol: "IN12345678",
      prenotation: "12345",
      slots: [{ ...requirements[0], files: [] }],
      autuacoesMovimentacoes: {
        "2": {
          files: [prenotacaoPath],
          parts: [{ file: prenotacaoPath, order: 0 }],
          hasAttachments: false
        },
        "3": archived
      }
    });
    const finalPdf = await PDFDocument.load(fs.readFileSync(result.output));
    assert.equal(finalPdf.getPageCount(), 4);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejects a movement with neither a fixed document nor attachment rules", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-unconfigured-movement-"));
  try {
    const protocolFolder = path.join(tempDir, "protocol");
    const odsPath = path.join(tempDir, "protocol.ods");
    fs.mkdirSync(protocolFolder);
    core.writeWorkbookOds(odsPath, {
      sheetOrder: ["Movimentações"],
      sheets: {
        "Movimentações": [
          ["", "PROTOCOLO:", "", "", "", "", ""],
          ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
          ["", "Movimento sem configuração", "28/10/2026", "", "", "", ""]
        ]
      }
    });

    await assert.rejects(
      core.autuarMovimentacao({
        models_folder: tempDir,
        movement_document_rules: [],
        movement_attachment_rules: []
      }, {
        odsPath,
        sheetName: "Movimentações",
        sourceRowIndex: 2,
        protocolFolder
      }),
      /Não há documento nem anexos configurados para a movimentação/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
