// Client logos: an image you pick is shrunk in the browser and saved with the client record,
// so it shows everywhere (and goes into backups) without needing a separate file store.
export const LOGO_MAX_W = 360;
export const LOGO_MAX_H = 144;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024; // what we'll accept before shrinking
export const LOGO_MAX_STORED = 32000; // characters saved with the client (fits in one Excel cell in backups)

/** The picture to show for a client: an uploaded logo, else a linked one. */
export const logoSrc = (c: { LogoData?: unknown; LogoUrl?: unknown }): string | undefined =>
  (c.LogoData as string) || (c.LogoUrl as string) || undefined;

/** Width and height that fit inside the box, keeping the shape and never enlarging. */
export function fitWithin(w: number, h: number, maxW = LOGO_MAX_W, maxH = LOGO_MAX_H): { w: number; h: number } {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export class LogoError extends Error {}

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new LogoError("Couldn't read that file."));
    r.readAsDataURL(f);
  });

/** Turn a picked image file into a small data URL ready to save. */
export async function prepareLogo(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new LogoError("That isn't an image. Use a PNG, JPG, SVG or WebP file.");
  if (file.size > LOGO_MAX_BYTES) throw new LogoError("That image is over 5 MB. Try a smaller version of the logo.");
  if (file.type === "image/svg+xml") {
    // drawings stay sharp at any size; shown as a picture, so nothing inside them can run
    const url = await readAsDataUrl(file);
    if (url.length > LOGO_MAX_STORED) throw new LogoError("That SVG is too detailed to store. Try a PNG instead.");
    return url;
  }
  const src = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new LogoError("Couldn't open that image."));
    i.src = src;
  });
  // twice the display size, so it's crisp on high-resolution screens
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, LOGO_MAX_W, LOGO_MAX_H);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LogoError("This browser couldn't resize the image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  let out = canvas.toDataURL("image/png"); // keeps a transparent background
  if (out.length > LOGO_MAX_STORED) out = canvas.toDataURL("image/webp", 0.9);
  if (out.length > LOGO_MAX_STORED) out = canvas.toDataURL("image/webp", 0.75);
  if (out.length > LOGO_MAX_STORED) throw new LogoError("That image is too detailed to store, even after shrinking it.");
  return out;
}
