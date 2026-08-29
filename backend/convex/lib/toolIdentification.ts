import { normalizeImageDataUrl } from "./imageStorage";

export type ToolIdentificationConfidence = "high" | "medium" | "low";

export interface ToolIdentificationResult {
  toolName: string;
  confidence: ToolIdentificationConfidence;
}

const IDENTIFY_PROMPT = `Identifica el software de escritorio o aplicación web visible en la captura.
Responde SOLO con JSON válido:
{
  "toolName": "nombre comercial exacto del software (ej. OBS Studio, AutoCAD, Figma)",
  "confidence": "high" | "medium" | "low"
}
Si no puedes identificarlo, usa toolName "Desconocido" y confidence "low".`;

export async function identifyToolFromImage(
  imageBase64: string,
  apiKey: string,
  model: string
): Promise<ToolIdentificationResult> {
  const imageUrl = normalizeImageDataUrl(imageBase64);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: "system", content: IDENTIFY_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "¿Qué software aparece en esta captura?" },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errData = await response.text();
    throw new Error(`OpenAI tool identification error (${response.status}): ${errData}`);
  }

  const data = await response.json();
  const contentText = data.choices?.[0]?.message?.content;
  if (!contentText) {
    return { toolName: "Desconocido", confidence: "low" };
  }

  const parsed = JSON.parse(contentText) as {
    toolName?: string;
    confidence?: string;
  };

  const toolName = parsed.toolName?.trim() || "Desconocido";
  const confidence: ToolIdentificationConfidence =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";

  return { toolName, confidence };
}
