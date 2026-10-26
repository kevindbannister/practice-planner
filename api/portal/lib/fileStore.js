// Where the files themselves are kept, behind a small interface so the place can change (like the
// record store). A file store has: put(path, bytes), get(path) -> bytes | null, remove(path).
// Paths are built by the server from ids it generated plus a cleaned file name, never from anything
// a browser sent as a path.

function createMemoryFiles() {
  const files = new Map();
  return {
    kind: "memory",
    files,
    async put(path, bytes) { files.set(path, Buffer.from(bytes)); },
    async get(path) { return files.has(path) ? Buffer.from(files.get(path)) : null; },
    async remove(path) { files.delete(path); },
  };
}

module.exports = { createMemoryFiles };
