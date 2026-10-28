const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const core = require("../src/core");

async function createPdf(filePath) {
  const document = await PDFDocument.create();
  document.addPage();
  fs.writeFileSync(filePath, await document.save());
}

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
    assert.ok(fs.existsSync(result.files[0]));
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
