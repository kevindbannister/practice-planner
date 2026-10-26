// Moving files between the browser and the portal. Files travel as base64 inside the normal signed-in
// calls, so there is never a public file address to share or guess.
import type { FileOut } from "./api";

export const MAX_MB = 10;
export const ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.csv,.txt";

export function readFile(file: File): Promise<{ fileName: string; content: string }> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_MB * 1048576) return reject(new Error(`That file is too large (the limit is ${MAX_MB} MB).`));
    const r = new FileReader();
    r.onerror = () => reject(new Error("That file couldn't be read."));
    r.onload = () => resolve({ fileName: file.name, content: String(r.result).split(",")[1] || "" });
    r.readAsDataURL(file);
  });
}

export function toBlob(f: FileOut): Blob {
  const bin = atob(f.content);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: f.mime });
}

export function save(f: FileOut) {
  const url = URL.createObjectURL(toBlob(f));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
