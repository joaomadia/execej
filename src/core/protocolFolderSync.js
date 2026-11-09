const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function hashFile(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function snapshotDirectory(root) {
  const entries = new Map();

  function visit(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Não é possível sincronizar links simbólicos: ${fullPath}`);
      }
      if (entry.isDirectory()) {
        entries.set(relativePath, "directory");
        visit(fullPath, relativePath);
      } else if (entry.isFile()) {
        const hash = hashFile(fullPath);
        entries.set(relativePath, `file:${hash}`);
      } else {
        throw new Error(`Tipo de arquivo não suportado na sincronização: ${fullPath}`);
      }
    }
  }

  visit(root);
  return entries;
}

function readSyncState(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!state || !state.files || typeof state.files !== "object" || Array.isArray(state.files)) {
      throw new Error("O arquivo de estado da sincronização tem formato inválido.");
    }
    for (const [relativePath, value] of Object.entries(state.files)) {
      const normalizedPath = path.normalize(relativePath);
      if (!relativePath || normalizedPath === "." || path.isAbsolute(relativePath) || normalizedPath === ".." || normalizedPath.startsWith(`..${path.sep}`)) {
        throw new Error("O estado da sincronização contém um caminho inválido.");
      }
      if (value !== null && value !== "directory" && !/^file:[a-f0-9]{64}$/.test(value)) {
        throw new Error("O estado da sincronização contém uma assinatura inválida.");
      }
    }
    return state.files;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Não foi possível ler o estado da sincronização: ${error.message}`);
  }
}

function removeEntry(root, relativePath, entryType) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return;
  if (entryType === "directory") fs.rmdirSync(target);
  else fs.unlinkSync(target);
}

function copyEntry(sourceRoot, targetRoot, relativePath, entryType) {
  const source = path.join(sourceRoot, relativePath);
  const target = path.join(targetRoot, relativePath);
  if (entryType === "directory") {
    if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) fs.unlinkSync(target);
    fs.mkdirSync(target, { recursive: true });
    return;
  }
  let parent = path.dirname(target);
  while (parent !== targetRoot) {
    const relativeParent = path.relative(targetRoot, parent);
    if (!relativeParent || relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) break;
    if (fs.existsSync(parent) && !fs.statSync(parent).isDirectory()) fs.unlinkSync(parent);
    parent = path.dirname(parent);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) fs.rmSync(target, { recursive: true, force: true });
  fs.copyFileSync(source, target);
}

function synchronizeProtocolFolders(localPath, sharedPath, statePath) {
  const localRoot = path.resolve(localPath);
  const sharedRoot = path.resolve(sharedPath);
  const isSameOrInside = (root, candidate) => {
    let relative = path.relative(root, candidate);
    if (process.platform === "win32") relative = relative.toLowerCase();
    return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  if (isSameOrInside(localRoot, sharedRoot) || isSameOrInside(sharedRoot, localRoot)) {
    throw new Error("As pastas local e compartilhada não podem ser iguais nem estar uma dentro da outra.");
  }
  if (!fs.existsSync(localRoot) || !fs.existsSync(sharedRoot)) {
    throw new Error("Uma das pastas vinculadas não está disponível; a sincronização foi interrompida para evitar perda de arquivos.");
  }
  if (!fs.statSync(localRoot).isDirectory() || !fs.statSync(sharedRoot).isDirectory()) {
    throw new Error("As pastas local e compartilhada precisam ser diretórios.");
  }

  const localEntries = snapshotDirectory(localRoot);
  const sharedEntries = snapshotDirectory(sharedRoot);
  const previousFiles = readSyncState(statePath);
  const relativePaths = new Set([
    ...localEntries.keys(),
    ...sharedEntries.keys(),
    ...Object.keys(previousFiles || {})
  ]);
  const orderedPaths = [...relativePaths].sort((a, b) => {
    const aType = localEntries.get(a) || sharedEntries.get(a);
    const bType = localEntries.get(b) || sharedEntries.get(b);
    if (aType === "directory" && bType !== "directory") return 1;
    if (aType !== "directory" && bType === "directory") return -1;
    if (aType === "directory" && bType === "directory") return b.split(path.sep).length - a.split(path.sep).length;
    return a.localeCompare(b);
  });

  for (const relativePath of orderedPaths) {
    const localEntry = localEntries.get(relativePath) || null;
    const sharedEntry = sharedEntries.get(relativePath) || null;
    const wasTracked = previousFiles && Object.prototype.hasOwnProperty.call(previousFiles, relativePath);

    if (!wasTracked) {
      if (localEntry && localEntry !== sharedEntry) {
        copyEntry(localRoot, sharedRoot, relativePath, localEntry === "directory" ? "directory" : "file");
      } else if (!localEntry && sharedEntry) {
        copyEntry(sharedRoot, localRoot, relativePath, sharedEntry === "directory" ? "directory" : "file");
      }
      continue;
    }

    const previousEntry = previousFiles[relativePath];
    const localChanged = localEntry !== previousEntry;
    const sharedChanged = sharedEntry !== previousEntry;
    if (localChanged && sharedChanged) {
      if (localEntry !== sharedEntry) {
        if (localEntry) copyEntry(localRoot, sharedRoot, relativePath, localEntry === "directory" ? "directory" : "file");
        else if (sharedEntry) removeEntry(sharedRoot, relativePath, sharedEntry === "directory" ? "directory" : "file");
      }
    } else if (localChanged) {
      if (localEntry) copyEntry(localRoot, sharedRoot, relativePath, localEntry === "directory" ? "directory" : "file");
      else if (sharedEntry) removeEntry(sharedRoot, relativePath, sharedEntry === "directory" ? "directory" : "file");
    } else if (sharedChanged) {
      if (sharedEntry) copyEntry(sharedRoot, localRoot, relativePath, sharedEntry === "directory" ? "directory" : "file");
      else if (localEntry) removeEntry(localRoot, relativePath, localEntry === "directory" ? "directory" : "file");
    }
  }

  const syncedLocalEntries = snapshotDirectory(localRoot);
  const syncedSharedEntries = snapshotDirectory(sharedRoot);
  const stateFiles = {};
  for (const relativePath of relativePaths) {
    stateFiles[relativePath] = syncedLocalEntries.get(relativePath) || syncedSharedEntries.get(relativePath) || null;
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({ files: stateFiles }, null, 2)}\n`, "utf8");
  return { synchronized: true, files: syncedLocalEntries.size };
}

module.exports = { synchronizeProtocolFolders };
