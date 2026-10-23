export const MAX_IMAGE_EDGE = 2000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Longest edge <= `maxEdge`; returns the scale to apply (1 when already small enough). */
export function downscaleFactor(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): number {
  const longest = Math.max(width, height);
  return longest <= maxEdge ? 1 : maxEdge / longest;
}

/** Decoded byte size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Re-encodes a receipt photo as a JPEG data URL no larger than 2000px on its
 * longest edge and under 5 MB, lowering quality until it fits. Browser only.
 */
export async function prepareReceiptImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = downscaleFactor(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the image on this device.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.85, 0.75, 0.6, 0.45, 0.3]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(dataUrl) < MAX_IMAGE_BYTES) return dataUrl;
  }
  throw new Error("The photo is too large even after compressing. Try a closer, smaller photo.");
}
