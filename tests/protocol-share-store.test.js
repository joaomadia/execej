const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProtocolShareStore } = require("../src/core/protocolShareStore");

function sharedProtocolPath(root, id) {
  const directoryName = crypto.createHash("sha256").update(id).digest("hex");
  return path.join(root, "Protocolos", directoryName);
}

test("shared protocols are linked in place and updates do not copy their folders", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-protocol-share-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const root = path.join(tempDir, "rede");
  const protocolDirectory = sharedProtocolPath(root, "protocol-1");
  const documentPath = path.join(protocolDirectory, "protocolo.ods");
  fs.mkdirSync(protocolDirectory, { recursive: true });
  fs.writeFileSync(documentPath, "arquivo já compartilhado");
  fs.writeFileSync(path.join(protocolDirectory, "protocolo.json"), JSON.stringify({
    id: "protocol-1",
    name: "Protocolo de teste",
    folderPath: protocolDirectory,
    odsPath: documentPath
  }));

  const store = createProtocolShareStore(root);
  store.initialize();
  assert.equal(store.hasProtocol("protocol-1"), true);
  assert.equal(store.listProtocols()[0].id, "protocol-1");
  store.saveProtocol({ ...store.listProtocols()[0], name: "Atualizado" });

  assert.equal(store.listProtocols()[0].name, "Atualizado");
  assert.equal(fs.readFileSync(documentPath, "utf8"), "arquivo já compartilhado");
  assert.equal(fs.existsSync(path.join(protocolDirectory, "protocolo.json")), true);
  assert.equal(store.publishProtocol, undefined);
});

test("saving a protocol that is not linked to the shared folder fails", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-protocol-share-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const store = createProtocolShareStore(path.join(tempDir, "rede"));
  store.initialize();

  assert.throws(
    () => store.saveProtocol({ id: "local-protocol", name: "Local" }),
    /ainda não foi publicado/
  );
});

test("importing a protocol keeps an already-synchronized shared folder", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-protocol-share-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const store = createProtocolShareStore(path.join(tempDir, "rede"));
  store.initialize();
  const folderPath = store.protocolFolderPath("protocol-1");
  fs.mkdirSync(folderPath, { recursive: true });
  fs.writeFileSync(path.join(folderPath, "protocolo.ods"), "arquivo sincronizado");

  const result = store.importProtocol({
    id: "protocol-1",
    officeProtocol: "IN01614027C",
    prenotation: "40.828",
    folderPath,
    odsPath: path.join(folderPath, "protocolo.ods")
  });

  assert.equal(result.created, true);
  assert.equal(fs.readFileSync(path.join(folderPath, "protocolo.ods"), "utf8"), "arquivo sincronizado");
});

test("importing the same office protocol and prenotation does not create duplicates", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-protocol-share-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const store = createProtocolShareStore(path.join(tempDir, "rede"));
  store.initialize();

  const first = store.importProtocol({
    id: "import-1",
    officeProtocol: "IN01614027C",
    prenotation: "40.828",
    odsPath: path.join(tempDir, "protocol.ods"),
    folderPath: tempDir,
    autuacoesMovimentacoes: {}
  });
  const duplicate = store.importProtocol({
    id: "import-2",
    officeProtocol: "in01614027c",
    prenotation: "40828",
    odsPath: path.join(tempDir, "other-copy.ods"),
    folderPath: tempDir,
    autuacoesMovimentacoes: {
      7: {
        files: [path.join(tempDir, "Arquivamento - 03.11.2026 - Protocolo IN01676188C - 40.828.pdf")],
        movement: "Arquivamento",
        autuadoEm: "2026-11-03T00:00:00.000Z"
      }
    }
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.updated, true);
  assert.equal(duplicate.protocol.id, "import-1");
  assert.equal(duplicate.protocol.autuacoesMovimentacoes[7].movement, "Arquivamento");
  assert.equal(store.listProtocols().length, 1);

  const refreshed = store.importProtocol({
    id: "import-3",
    officeProtocol: "IN01614027C",
    prenotation: "40.828",
    odsPath: path.join(tempDir, "protocol.ods"),
    folderPath: tempDir,
    autuacoesMovimentacoes: {}
  });
  assert.deepEqual(refreshed.protocol.autuacoesMovimentacoes, {});
});

test("import identity falls back to the ODS path when protocol fields are absent", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execej-protocol-share-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const store = createProtocolShareStore(path.join(tempDir, "rede"));
  store.initialize();
  const odsPath = path.join(tempDir, "protocol.ods");

  assert.equal(store.importProtocol({ id: "import-1", odsPath }).created, true);
  assert.equal(store.importProtocol({ id: "import-2", odsPath }).created, false);
  assert.equal(store.listProtocols().length, 1);
});
