import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireAuthUserId } from "./lib/authorization";

/**
 * Sintetiza voz con Fish Audio. La llave vive del lado servidor
 * (`FISH_AUDIO_API_KEY`), como el resto de Michi.
 *
 * Devuelve el MP3 en base64. Si no hay llave configurada, devuelve
 * `audioBase64: null` y el frontend cae a `speechSynthesis` del navegador.
 *
 * Variables de entorno:
 *  - FISH_AUDIO_API_KEY   (secret, requerida para que funcione)
 *  - FISH_AUDIO_MODEL     (opcional, cabecera `model`; default "s2.1-pro-free")
 *  - FISH_AUDIO_VOICE_ID  (opcional, `reference_id` de una voz de la librería)
 */
export const synthesize = action({
  args: {
    text: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ audioBase64: string | null; mimeType: string }> => {
    await requireAuthUserId(ctx);

    const apiKey = process.env.FISH_AUDIO_API_KEY;
    if (!apiKey) {
      return { audioBase64: null, mimeType: "audio/mpeg" };
    }

    const model = process.env.FISH_AUDIO_MODEL || "s2.1-pro-free";
    const voiceId = process.env.FISH_AUDIO_VOICE_ID;

    const body: Record<string, unknown> = {
      text: args.text.slice(0, 2000),
      format: "mp3",
      mp3_bitrate: 128,
      normalize: true,
      latency: "balanced",
    };
    if (voiceId) {
      body.reference_id = voiceId;
    }

    const response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        model,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Fish Audio error (${response.status}): ${errText}`);
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buffer.length; i += 1) {
      binary += String.fromCharCode(buffer[i]);
    }
    return { audioBase64: btoa(binary), mimeType: "audio/mpeg" };
  },
});
