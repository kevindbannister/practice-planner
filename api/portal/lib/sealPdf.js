// Builds the two PDFs that come out of a completed signing: the sealed copy of the document (the
// original pages, a small reference footer on each, and a signature page) and the evidence
// certificate (who signed, what they agreed to, what was recorded, and the document's fingerprints).
//
// These are electronic signatures with an evidence trail. They are not "qualified" signatures and
// the sealed PDF carries no cryptographic certificate: its integrity is shown by the SHA-256 values
// recorded in the audit trail and certificate, not by the PDF itself. The certificate says so.

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const A4 = [595.28, 841.89];
const GREY = rgb(0.35, 0.38, 0.42);
const INK = rgb(0.1, 0.13, 0.17);

/** Only characters the standard fonts can draw: anything else becomes "?" rather than failing. */
const safe = (font, s) => [...String(s ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")].map((c) => { try { font.encodeText(c); return c; } catch { return "?"; } }).join("");

const stamp = (ms) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

/** A cursor that writes wrapped lines and starts new pages when it runs out of room. */
function createWriter(pdf, { regular, bold }, { margin = 50, size = 10 } = {}) {
  let page = pdf.addPage(A4);
  let y = A4[1] - margin;
  const width = A4[0] - margin * 2;
  const room = (h) => { if (y - h < margin) { page = pdf.addPage(A4); y = A4[1] - margin; } };
  const wrap = (text, font, sz, w) => {
    const out = [];
    for (const para of safe(font, text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        // Break words longer than a line (hashes, long addresses).
        let w2 = word;
        while (font.widthOfTextAtSize(w2, sz) > w) {
          let n = w2.length;
          while (n > 1 && font.widthOfTextAtSize(w2.slice(0, n), sz) > w) n--;
          if (line) { out.push(line); line = ""; }
          out.push(w2.slice(0, n));
          w2 = w2.slice(n);
        }
        const t = line ? `${line} ${w2}` : w2;
        if (font.widthOfTextAtSize(t, sz) <= w) line = t;
        else { out.push(line); line = w2; }
      }
      out.push(line);
    }
    return out;
  };
  return {
    get page() { return page; },
    get y() { return y; },
    set y(v) { y = v; },
    width, margin,
    gap(h = 8) { y -= h; },
    text(t, { font = regular, sz = size, color = INK, indent = 0, after = 3 } = {}) {
      for (const line of wrap(t, font, sz, width - indent)) {
        room(sz * 1.35);
        y -= sz * 1.2;
        page.drawText(line, { x: margin + indent, y, size: sz, font, color });
      }
      y -= after;
    },
    rule() { room(10); y -= 4; page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) }); y -= 6; },
    room,
  };
}

async function fonts(pdf) {
  return { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), script: await pdf.embedFont(StandardFonts.TimesRomanItalic) };
}

/**
 * Original pages + a reference footer on each + a signature page.
 * signers: [{ name, email, at (ms), mode: "typed"|"drawn", typedName, image (Buffer png) }]
 */
async function sealDocument({ original, title, ref, originalSha256, signers, practiceName }) {
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const f = await fonts(pdf);
  const footer = safe(f.regular, `Electronically signed. Reference ${ref}. SHA-256 of the document before signing: ${originalSha256.slice(0, 16)}...`);
  for (const p of pdf.getPages()) p.drawText(footer, { x: 20, y: 10, size: 6.5, font: f.regular, color: GREY });
  const w = createWriter(pdf, f);
  w.text("Signature page", { font: f.bold, sz: 20, after: 8 });
  w.text(title, { font: f.bold, sz: 12 });
  w.text(`Reference ${ref}${practiceName ? ` · ${practiceName}` : ""}`, { color: GREY });
  w.text(`SHA-256 of the document that was signed:\n${originalSha256}`, { color: GREY, sz: 8.5 });
  w.rule();
  for (const s of signers) {
    w.room(130);
    w.gap(6);
    if (s.mode === "drawn" && s.image) {
      const img = await pdf.embedPng(s.image);
      const scale = Math.min(220 / img.width, 70 / img.height, 1);
      w.room(img.height * scale + 8);
      w.page.drawImage(img, { x: w.margin, y: w.y - img.height * scale, width: img.width * scale, height: img.height * scale });
      w.y -= img.height * scale + 4;
    } else {
      w.room(34);
      w.y -= 26;
      w.page.drawText(safe(f.script, s.typedName || s.name), { x: w.margin, y: w.y, size: 22, font: f.script, color: rgb(0.05, 0.15, 0.35) });
      w.y -= 4;
    }
    w.page.drawLine({ start: { x: w.margin, y: w.y }, end: { x: w.margin + 240, y: w.y }, thickness: 0.6, color: GREY });
    w.y -= 4;
    w.text(`${s.name}`, { font: f.bold });
    w.text(`Signed on ${stamp(s.at)}`, { color: GREY });
    w.text("Named by the practice as a signatory of this document. Signed electronically.", { color: GREY, sz: 8.5 });
    w.gap(8);
  }
  pdf.setTitle(`${title} (signed)`);
  pdf.setProducer("XProFlow");
  return Buffer.from(await pdf.save());
}

/** The evidence certificate. `req` is the signing record; `events` the audit events for it. */
async function evidenceCertificate({ req, ref, practiceName, sealedSha256, signers, events, consentText }) {
  const pdf = await PDFDocument.create();
  const f = await fonts(pdf);
  const w = createWriter(pdf, f);
  w.text("Certificate of electronic signing", { font: f.bold, sz: 20, after: 6 });
  w.text(`${practiceName || "XProFlow"} · Reference ${ref}`, { color: GREY });
  w.rule();
  const kv = (k, v) => { w.text(k, { font: f.bold, sz: 8.5, color: GREY, after: 0 }); w.text(v, { after: 5 }); };
  kv("Document", req.title);
  kv("Requested by the practice", `${req.createdByName} on ${stamp(Date.parse(req.createdAt))}`);
  kv("Signing order", req.sequential ? "One after another, in the order listed" : "Any order");
  kv("SHA-256 of the document before signing", req.sha256);
  kv("SHA-256 of the signed copy", sealedSha256);
  kv("Completed", stamp(Date.parse(req.completedAt)));
  w.rule();
  w.text("Signatories", { font: f.bold, sz: 13 });
  for (const s of signers) {
    w.gap(4);
    w.text(`${s.order}. ${s.name}`, { font: f.bold, sz: 11 });
    const ev = s.evidence;
    w.text(`Email (verified at sign-in): ${s.email}`, { indent: 12 });
    w.text(`Signed: ${stamp(Date.parse(ev.at))}`, { indent: 12 });
    w.text(`Signature: ${ev.mode === "drawn" ? "drawn on screen" : `typed name "${ev.typedName}"`}`, { indent: 12 });
    w.text(`Two-step sign-in: ${ev.mfa ? "yes" : "no"}`, { indent: 12 });
    w.text(`Network address: ${ev.ip || "not available"}`, { indent: 12 });
    w.text(`Device: ${ev.ua || "not available"}`, { indent: 12, sz: 8.5, color: GREY });
    w.text(`Document fingerprint seen when signing: ${ev.docSha256}`, { indent: 12, sz: 8.5, color: GREY });
    w.text(`Named as a signatory by ${req.createdByName} on ${stamp(Date.parse(req.createdAt))}.`, { indent: 12 });
  }
  w.rule();
  w.text("What each signatory agreed to", { font: f.bold, sz: 13 });
  w.text(consentText, { sz: 9.5 });
  w.rule();
  w.text("Record of events", { font: f.bold, sz: 13 });
  for (const e of events) w.text(`${stamp(Date.parse(e.at))}   ${e.label}`, { sz: 9, after: 1 });
  w.rule();
  w.text("About this certificate", { font: f.bold, sz: 13 });
  w.text("These are electronic signatures captured inside the practice's secure portal. Each signatory had to sign in with a verified email address and had been named for this document by the practice; holding portal access or being an administrator was not enough. The values above identify the exact document that was signed. The signed copy is not digitally certified by a trust service provider, so it is not a \"qualified\" electronic signature; its integrity is shown by the fingerprints in this certificate and in the practice's tamper-evident audit trail. Whether an electronic signature is suitable for a particular document is for the practice and the parties to decide.", { sz: 9, color: GREY });
  pdf.setTitle(`Certificate of signing ${ref}`);
  pdf.setProducer("XProFlow");
  return Buffer.from(await pdf.save());
}

module.exports = { sealDocument, evidenceCertificate, safe };
