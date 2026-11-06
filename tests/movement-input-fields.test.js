const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");
const core = require("../src/core");

test("formats the required creditor refund balance for the certificate field", () => {
  const inputRule = { type: "balance" };
  const fields = {};
  core.addMovementInputFields(fields, inputRule, { saldo_a_devolver: "1234,5" });

  assert.equal(fields.SALDO_A_DEVOLVER, "1.234,50");
  assert.equal(core.prepareMovementInputFields(inputRule, { balance: "1.234,56" }).SALDO_A_DEVOLVER, "1.234,56");
  assert.throws(
    () => core.prepareMovementInputFields(inputRule, { saldo_a_devolver: "valor inválido" }),
    /Informe um saldo válido/
  );
  assert.throws(
    () => core.prepareMovementInputFields(inputRule, {}),
    /Informe um saldo válido/
  );
});

test("formats joined documents as one bullet per line and pluralizes only multiple items", () => {
  const inputRule = { type: "documents" };
  const single = core.prepareMovementInputFields(inputRule, { docs: ["Contrato"] });
  assert.deepEqual(single, { DOCS: "- Contrato", S: "" });

  const multiple = {};
  core.addMovementInputFields(multiple, inputRule, { docs: ["Contrato", "Comprovante de pagamento"] });
  assert.deepEqual(multiple, {
    DOCS: "- Contrato\n- Comprovante de pagamento",
    S: "s"
  });
  assert.throws(
    () => core.prepareMovementInputFields(inputRule, { docs: ["", "  "] }),
    /Informe pelo menos um documento juntado/
  );
});

test("renders each joined document as its own paragraph while preserving paragraph formatting", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-joined-docs-"));
  try {
    const templatePath = path.join(tempDir, "template.odt");
    const outputPath = path.join(tempDir, "output.odt");
    const template = new AdmZip();
    template.addFile(
      "content.xml",
      Buffer.from('<office:document-content><text:p text:style-name="Empty"/><text:p text:style-name="List"><text:database-display text:column-name="DOCS">&lt;DOCS&gt;</text:database-display></text:p></office:document-content>')
    );
    template.writeZip(templatePath);

    core.mergeOdtDocument(templatePath, outputPath, {
      DOCS: "- Contrato\n- Comprovante de pagamento"
    });

    const output = new AdmZip(outputPath).readAsText("content.xml");
    assert.ok(output.includes(
      '<text:p text:style-name="List">- Contrato</text:p><text:p text:style-name="List">- Comprovante de pagamento</text:p>'
    ));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalizes the built-in movement input types and honors explicit configuration", () => {
  assert.deepEqual(core.normalizeMovementInputRules({}), core.DEFAULT_MOVEMENT_INPUT_RULES);
  assert.deepEqual(
    core.normalizeMovementInputRules({
      movement_input_rules: [{ movement: "Saldo devolvido", type: "balance" }, { movement: "Juntada", type: "unknown" }]
    }),
    [{ movement: "Saldo devolvido", type: "balance" }]
  );
  assert.deepEqual(core.normalizeMovementInputRules({ movement_input_rules: [] }), []);
});

test("migrates existing configuration with the new movement suggestions and attachment rule", () => {
  const config = core.normalizeConfig({
    movement_attachment_rules: [{ movement: "Exigência", document: "Exigência", quantity: "1" }],
    movement_prefill_options: ["Exigência"]
  });

  assert.ok(config.movement_prefill_options.includes("Saldo a Devolver"));
  assert.ok(config.movement_prefill_options.includes("Juntada de Documentos"));
  assert.ok(config.movement_input_rules.some((rule) => rule.movement === "Saldo a Devolver" && rule.type === "balance"));
  assert.ok(config.movement_input_rules.some((rule) => rule.movement === "Juntada de Documentos" && rule.type === "documents"));
  assert.ok(config.movement_attachment_rules.some((rule) => rule.movement === "Juntada de Documentos"));
});

test("resolves the additional input and attachment for a configured movement row", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-movement-input-"));
  try {
    const odsPath = path.join(tempDir, "protocol.ods");
    core.writeWorkbookOds(odsPath, {
      sheetOrder: ["Movimentações"],
      sheets: {
        "Movimentações": [
          ["", "PROTOCOLO:", "", "", "", "", ""],
          ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
          ["", "Juntada de Documentos", "28/10/2026", "", "", "", ""]
        ]
      }
    });

    test("uses the refund balance field instead of requesting an attachment", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-balance-input-"));
      try {
        const odsPath = path.join(tempDir, "protocol.ods");
        core.writeWorkbookOds(odsPath, {
          sheetOrder: ["Movimentações"],
          sheets: {
            "Movimentações": [
              ["", "PROTOCOLO:", "", "", "", "", ""],
              ["", "MOVIMENTAÇÃO", "DATA", "DIA", "MÊS", "ANO", "NOME ARQUIVO"],
              ["", "Saldo a Devolver", "28/10/2026", "", "", "", ""]
            ]
          }
        });
        const config = {
          movement_input_rules: [{ movement: "Saldo a Devolver", type: "balance" }],
          movement_attachment_rules: [{ movement: "Saldo a Devolver", document: "Anexo legado", quantity: "1+" }]
        };

        assert.deepEqual(core.movementAttachmentRequirements(odsPath, "Movimentações", 2, config), []);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
    const config = core.normalizeConfig({});

    assert.deepEqual(
      core.movementInputRequirementForRow(odsPath, "Movimentações", 2, config),
      { movement: "Juntada de Documentos", type: "documents" }
    );
    assert.equal(
      core.movementAttachmentRequirements(odsPath, "Movimentações", 2, config)[0].title,
      "Documento a ser juntado"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
