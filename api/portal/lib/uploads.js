// Checks a file before it is stored. Never trust the name or the type the browser reports: the first
// bytes must match what the extension claims, only a short list of document types is allowed, and
// nothing that can run or script is ever accepted (no HTML, SVG, scripts, programs, macro-enabled
// Office files or archives). PDFs that ask to run code or launch programs are refused.
//
// This is format checking, not a virus scan. Files kept in SharePoint are also scanned by Microsoft 365;
// a separate scanner can be plugged in (see `scanner` in documents.js).

const crypto = require("node:crypto");

const MAX_BYTES_DEFAULT = 10 * 1024 * 1024;

const TYPES = {
  pdf: { mime: "application/pdf", magic: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  png: { mime: "image/png", magic: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  jpg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: zipOffice("word/") },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: zipOffice("xl/") },
  csv: { mime: "text/csv", magic: isText },
  txt: { mime: "text/plain", magic: isText },
};

/** A zip that is a real Word/Excel file (has the part folder) and carries no macros. */
function zipOffice(folder) {
  return (b) => {
    if (b.length < 30 || b.readUInt32LE(0) !== 0x04034b50) return false;
    const head = b.toString("latin1");
    return head.includes("[Content_Types].xml") && head.includes(folder) && !/vbaProject\.bin/i.test(head);
  };
}
function isText(b) {
  if (b.includes(0)) return false;
  const s = b.subarray(0, 4096).toString("utf8");
  return !/<\s*(script|html|svg|iframe)\b/i.test(s) && !s.includes("�");
}

/** A name that is safe to keep: letters, digits, spaces, dots, dashes and underscores, no path, never hidden. */
function safeName(raw) {
  let n = String(raw || "").normalize("NFKC").split(/[\\/]/).pop().replace(/[\\/]/g, "_").replace(/[^\p{L}\p{N} ._()\-]/gu, "_").replace(/\s+/g, " ").replace(/^\.+/, "").trim();
  if (n.length > 120) n = n.slice(0, 100) + n.slice(n.lastIndexOf("."));
  return n || "file";
}

/** { ok, name, ext, mime, size, sha256 } or { ok: false, error }. */
function checkUpload({ fileName, bytes, maxBytes = MAX_BYTES_DEFAULT }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return { ok: false, error: "That file is empty" };
  if (bytes.length > maxBytes) return { ok: false, error: `That file is too large (the limit is ${Math.round(maxBytes / 1048576)} MB)` };
  const name = safeName(fileName);
  const parts = name.split(".");
  if (parts.length < 2) return { ok: false, error: "The file needs a name ending in .pdf, .docx, .xlsx, .png, .jpg, .csv or .txt" };
  if (parts.slice(1, -1).some((p) => /^(exe|js|vbs|bat|cmd|com|scr|ps1|sh|html?|svg|php|jar|msi|dll|lnk|docm|xlsm|pptm|zip|rar|7z)$/i.test(p))) return { ok: false, error: "That file name isn't allowed" };
  const ext = parts[parts.length - 1].toLowerCase();
  const t = TYPES[ext];
  if (!t) return { ok: false, error: "That type of file isn't accepted. Please use PDF, Word, Excel, PNG, JPG, CSV or text files." };
  if (!t.magic(bytes)) return { ok: false, error: "That file doesn't look like a real ." + ext + " file" };
  if (ext === "pdf" && /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(bytes.toString("latin1"))) return { ok: false, error: "That PDF contains active content, which isn't accepted. Please send a plain PDF." };
  return { ok: true, name, ext, mime: t.mime, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

module.exports = { checkUpload, safeName, TYPES, MAX_BYTES_DEFAULT };
