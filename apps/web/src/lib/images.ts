/** Photos from the camera: turned the right way up and made smaller before they are stored or sent. */

export async function downscale(src: Blob, maxSide: number, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(src, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvasToJpeg(canvas, quality);
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the image."))), "image/jpeg", quality),
  );
}

export async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Claude reads pages best at about 1.15 megapixels; larger photos only cost more. */
export const CLAUDE_SIDE = 1568;
/** On-device recognition wants more pixels per letter. */
export const OCR_SIDE = 2200;
export const COVER_SIDE = 900;
