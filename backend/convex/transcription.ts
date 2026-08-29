import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireAuthUserId } from "./lib/authorization";

/**
 * Transcribe un clip de audio. La llave vive del lado servidor, como el resto
 * de Michi: el frontend nunca la ve.
 *
 * Proveedor:
 *  - Si `ASSEMBLYAI_API_KEY` está configurada → AssemblyAI (upload + poll).
 *  - Si no → OpenAI (`OPENAI_API_KEY`, modelo `OPENAI_TRANSCRIBE_MODEL`).
 *
 * El audio llega como base64 crudo (sin prefijo `data:`). El `mimeType` viene
 * del `MediaRecorder` del webview — WKWebView suele dar `audio/mp4`, Chromium
 * `audio/webm`; ambos proveedores los decodifican del lado servidor.
 */
export const transcribe = action({
  args: {
    audioBase64: v.string(),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ text: string }> => {
    await requireAuthUserId(ctx);

    const view = Uint8Array.from(atob(args.audioBase64), (c) => c.charCodeAt(0));
    // Copia a un ArrayBuffer "puro": TS 5.7 no acepta Uint8Array<ArrayBufferLike>
    // como BodyInit/BlobPart.
    const audio = view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength
    ) as ArrayBuffer;

    const assemblyKey = process.env.ASSEMBLYAI_API_KEY;
    if (assemblyKey) {
      return { text: await transcribeWithAssemblyAI(audio, assemblyKey.trim()) };
    }

    return { text: await transcribeWithOpenAI(audio, args.mimeType) };
  },
});

// ---------------------------------------------------------------------------

async function transcribeWithAssemblyAI(
  audio: ArrayBuffer,
  apiKey: string
): Promise<string> {
  const base = "https://api.assemblyai.com";
  // `speech_model` (singular) está deprecado. Ahora es `speech_models` (lista de
  // preferencia con fallback): universal-3-5-pro primero, universal-2 si el
  // idioma no está soportado.
  const speechModels = (process.env.ASSEMBLYAI_SPEECH_MODELS || "universal-3-5-pro,universal-2")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const language = process.env.ASSEMBLYAI_LANGUAGE || "es";

  // 1. Subir el audio crudo (binario, NO multipart).
  const uploadRes = await fetch(`${base}/v2/upload`, {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/octet-stream",
    },
    body: audio,
  });
  if (!uploadRes.ok) {
    throw new Error(
      `AssemblyAI upload error (${uploadRes.status}): ${await uploadRes.text()}`
    );
  }
  const { upload_url: audioUrl } = await uploadRes.json();

  // 2. Encolar la transcripción.
  const submitRes = await fetch(`${base}/v2/transcript`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: speechModels,
      language_code: language,
    }),
  });
  if (!submitRes.ok) {
    throw new Error(
      `AssemblyAI submit error (${submitRes.status}): ${await submitRes.text()}`
    );
  }
  const id: string = (await submitRes.json()).id;

  // 3. Sondear hasta que termine. Los clips de push-to-talk son cortos, así
  //    que suele resolver en pocos segundos; tope ~60 s.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(`${base}/v2/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    if (!pollRes.ok) {
      throw new Error(
        `AssemblyAI poll error (${pollRes.status}): ${await pollRes.text()}`
      );
    }
    const poll = await pollRes.json();
    if (poll.status === "completed") {
      return (poll.text ?? "").trim();
    }
    if (poll.status === "error") {
      throw new Error(`AssemblyAI transcription error: ${poll.error}`);
    }
  }
  throw new Error("AssemblyAI: la transcripción no terminó a tiempo");
}

async function transcribeWithOpenAI(
  audio: ArrayBuffer,
  mimeType: string | undefined
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No hay proveedor de transcripción configurado (ASSEMBLYAI_API_KEY u OPENAI_API_KEY)"
    );
  }

  const type = mimeType || "audio/webm";
  const extension = type.includes("mp4") || type.includes("m4a")
    ? "m4a"
    : type.includes("wav")
      ? "wav"
      : type.includes("ogg")
        ? "ogg"
        : "webm";
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `audio.${extension}`);
  form.append("model", model);
  form.append("language", "es");
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(
      `OpenAI transcription error (${response.status}): ${await response.text()}`
    );
  }
  const data = await response.json();
  return (data.text ?? "").trim();
}
