const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { synchronizeProtocolFolders } = require("../src/core/protocolFolderSync");

test("protocol folder sync merges initial contents and prefers local conflicts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "execej-folder-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, "local");
  const shared = path.join(root, "shared");
  const state = path.join(root, "state.json");
  fs.mkdirSync(path.join(local, "Entrada"), { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(local, "protocolo.ods"), "local inicial");
  fs.writeFileSync(path.join(shared, "documento.pdf"), "remoto inicial");

  synchronizeProtocolFolders(local, shared, state);

  assert.equal(fs.readFileSync(path.join(shared, "protocolo.ods"), "utf8"), "local inicial");
  assert.equal(fs.readFileSync(path.join(local, "documento.pdf"), "utf8"), "remoto inicial");
  assert.equal(fs.existsSync(path.join(shared, "Entrada")), true);

  fs.writeFileSync(path.join(local, "protocolo.ods"), "alterado local");
  fs.writeFileSync(path.join(shared, "protocolo.ods"), "alterado compartilhado");
  synchronizeProtocolFolders(local, shared, state);
  assert.equal(fs.readFileSync(path.join(shared, "protocolo.ods"), "utf8"), "alterado local");
});

test("protocol folder sync propagates changes and deletions in either direction", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "execej-folder-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, "local");
  const shared = path.join(root, "shared");
  const state = path.join(root, "state.json");
  fs.mkdirSync(local);
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(local, "local.txt"), "initial");
  fs.writeFileSync(path.join(shared, "shared.txt"), "initial");
  synchronizeProtocolFolders(local, shared, state);

  fs.writeFileSync(path.join(local, "local.txt"), "updated locally");
  fs.writeFileSync(path.join(shared, "shared.txt"), "updated remotely");
  synchronizeProtocolFolders(local, shared, state);
  assert.equal(fs.readFileSync(path.join(shared, "local.txt"), "utf8"), "updated locally");
  assert.equal(fs.readFileSync(path.join(local, "shared.txt"), "utf8"), "updated remotely");

  fs.unlinkSync(path.join(local, "local.txt"));
  fs.unlinkSync(path.join(shared, "shared.txt"));
  synchronizeProtocolFolders(local, shared, state);
  assert.equal(fs.existsSync(path.join(local, "local.txt")), false);
  assert.equal(fs.existsSync(path.join(shared, "local.txt")), false);
  assert.equal(fs.existsSync(path.join(local, "shared.txt")), false);
  assert.equal(fs.existsSync(path.join(shared, "shared.txt")), false);
});

test("protocol folder sync refuses to treat a missing folder as an empty folder", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "execej-folder-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, "local");
  const shared = path.join(root, "shared");
  fs.mkdirSync(local);
  fs.mkdirSync(shared);

  assert.throws(
    () => synchronizeProtocolFolders(local, path.join(root, "unavailable"), path.join(root, "state.json")),
    /não está disponível/
  );
});
