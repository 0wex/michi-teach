import { ActionCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export const MAX_IMAGE_BASE64_LENGTH = 16 * 1024 * 1024;

export function normalizeImageDataUrl(imageBase64: string): string {
  if (imageBase64.startsWith("data:")) {
    return imageBase64;
  }
  return `data:image/png;base64,${imageBase64}`;
}

export function parseImageBase64(imageBase64: string): Blob {
  let contentType = "image/png";
  let base64Data = imageBase64;

  if (imageBase64.startsWith("data:")) {
    const commaIndex = imageBase64.indexOf(",");
    if (commaIndex === -1) {
      throw new Error("Formato de imagen inválido.");
    }
    const header = imageBase64.slice(0, commaIndex);
    const mimeMatch = header.match(/^data:([^;]+);base64$/);
    if (mimeMatch?.[1]) {
      contentType = mimeMatch[1];
    }
    base64Data = imageBase64.slice(commaIndex + 1);
  }

  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: contentType });
}

export async function storeScreenshotFromBase64(
  ctx: ActionCtx,
  imageBase64: string
): Promise<Id<"_storage">> {
  const blob = parseImageBase64(imageBase64);
  return await ctx.storage.store(blob);
}
