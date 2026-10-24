// Documents: shows a PDF page by page, drawn by pdf.js (served from the site, see build.mjs), so what
// is previewed is the actual file that will be saved, not an approximation.
import { useEffect, useRef, useState } from "react";
import { loadPdfJs } from "../lib/pdfText";

type Page = { getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvas: HTMLCanvasElement; viewport: unknown }): { promise: Promise<void> } };
type Pdf = { numPages: number; getPage(n: number): Promise<Page>; destroy?: () => void };

export function PdfPreview({ bytes, width = 680 }: { bytes: Uint8Array | null; width?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [pages, setPages] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el || !bytes) return;
    let cancelled = false;
    setError("");
    (async () => {
      try {
        const lib = (await loadPdfJs()) as unknown as { getDocument(s: unknown): { promise: Promise<Pdf> } };
        const pdf = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
        if (cancelled) return;
        el.textContent = "";
        setPages(pdf.numPages);
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const ratio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${width}px`;
          canvas.style.maxWidth = "100%";
          canvas.className = "pdf-page";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Page ${n} of ${pdf.numPages}`);
          el.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } catch (e) {
        console.warn("PDF preview failed", e);
        if (!cancelled) setError("The preview couldn't be drawn. You can still download the PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, width]);

  if (!bytes) return <p className="muted">The preview appears here.</p>;
  return (
    <div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div ref={host} className="pdf-pages" aria-label={`PDF preview, ${pages} page${pages === 1 ? "" : "s"}`} />
    </div>
  );
}
