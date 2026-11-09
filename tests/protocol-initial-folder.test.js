const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../src/core");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "execej-initial-folder-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const template = path.join(root, "modelo.ods");
  fs.writeFileSync(template, "modelo");
  return { root, template };
}

test("initial folder creation reuses a matching protocol in a sibling category", (t) => {
  const { root, template } = setup(t);
  const currentRoot = path.join(root, "Encerrados");
  const existingFolder = path.join(root, "Prenotados", "INABC - 41.123");
  const existingOds = path.join(existingFolder, "Protocolo INABC - 41.123.ods");
  fs.mkdirSync(existingFolder, { recursive: true });
  fs.writeFileSync(existingOds, "protocolo em andamento");

  const result = core.createInitialFolder({
    initial_folder_root: currentRoot,
    base_protocol_template: template
  }, {
    officeProtocol: "INABC",
    prenotation: "41123"
  });

  assert.equal(result.folder, existingFolder);
  assert.equal(result.protocolFile, existingOds);
  assert.equal(fs.readFileSync(existingOds, "utf8"), "protocolo em andamento");
  assert.equal(fs.existsSync(path.join(currentRoot, "INABC - 41123")), false);
});

test("initial folder creation does not reuse a folder with a different process identity", (t) => {
  const { root, template } = setup(t);
  const currentRoot = path.join(root, "Encerrados");
  const otherProcess = path.join(root, "Prenotados", "INXYZ - 41.123");
  fs.mkdirSync(otherProcess, { recursive: true });

  const result = core.createInitialFolder({
    initial_folder_root: currentRoot,
    base_protocol_template: template
  }, {
    officeProtocol: "INABC",
    prenotation: "41.123"
  });

  assert.equal(result.folder, path.join(currentRoot, "INABC - 41.123"));
  assert.equal(fs.existsSync(path.join(otherProcess, "Protocolo INABC - 41.123.ods")), false);
});
