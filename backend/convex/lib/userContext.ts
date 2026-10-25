import { normalizeImageDataUrl } from "./imageStorage";

export type UserContextType =
  | "desktop_app"
  | "terminal"
  | "browser"
  | "web_app"
  | "system_ui"
  | "mixed"
  | "unknown";

export type UserContextConfidence = "high" | "medium" | "low";

export interface UserContextResult {
  softwareOrEnvironment: string;
  contextType: UserContextType;
  interfaceSummary: string;
  confidence: UserContextConfidence;
  explanation: string;
  x: number | null;
  y: number | null;
  label?: string;
  /** Respuesta cruda del modelo para parsear annotations en messages.ts */
  annotationsRaw?: unknown;
}

const VALID_CONTEXT_TYPES = new Set<UserContextType>([
  "desktop_app",
  "terminal",
  "browser",
  "web_app",
  "system_ui",
  "mixed",
  "unknown",
]);

export function buildVisionSystemPrompt(
  userQuestion: string,
  ragContext: string,
  appHint?: string
): string {
  const osHintBlock = appHint?.trim()
    ? `
HINT DEL SISTEMA (ventana activa detectada por el SO): "${appHint.trim()}"
Usalo como punto de partida para softwareOrEnvironment; confirma o corrige con la imagen.`
    : "";

  return `
ROL: Eres Michi, un tutor experto de software en tiempo real.

TAREA:
Analiza la captura de pantalla Y la pregunta del usuario juntos para entender que esta usando
(cualquier software, terminal, navegador o interfaz del sistema) y ayudarle en vivo.

PREGUNTA DEL USUARIO: "${userQuestion}"
${osHintBlock}

CONTEXTO TECNICO (RAG):
${ragContext ? ragContext : "No hay contexto oficial recuperado."}

INSTRUCCIONES:
1. Identifica el entorno real del usuario (ej. OBS Studio, Windows Terminal con PowerShell, DaVinci Resolve, Chrome, Windows 11).
   - No te limites a una lista fija de apps: reconoce cualquier software o entorno visible.
   - Para terminales: indica el shell si es visible (PowerShell, bash, cmd, zsh, etc.).
2. Resume brevemente que se ve en la captura (interfaceSummary).
3. Responde la duda del usuario de forma concisa, clara y motivadora (maximo 35 palabras).
   - Usa atajos de teclado y nombres de menus canonicos cuando el contexto lo permita.
   - Si el CONTEXTO TECNICO no cubre la pregunta, responde exactamente: "No tengo informacion oficial verificada para esto" en vez de inventar pasos de UI.
4. SEÑALIZACION VISUAL (coordenadas NORMALIZADAS 0.0–1.0 respecto a la captura):
   - Devuelve un array "annotations" con las marcas que hay que dibujar en pantalla.
   - Cada marca es un objeto con "kind" y coordenadas:
       · {"kind":"point","x":..,"y":..} — centro exacto de un boton/icono/menu.
       · {"kind":"rect","x":..,"y":..,"w":..,"h":..} — enmarca un panel (x,y esquina superior izquierda).
       · {"kind":"arrow","x":..,"y":..,"x2":..,"y2":..} — flecha de (x,y) a (x2,y2).
   - Anade "label" (1–4 palabras) y "step" (1,2,3…) cuando la tarea tenga varios pasos.
   - En terminales o sin elemento puntual, usa "annotations": [] y x: null, y: null.
   - Copia la primera marca point (o centro del primer rect) en x, y, label para compatibilidad.

FORMATO OBLIGATORIO (JSON valido):
{
  "softwareOrEnvironment": "nombre del software o entorno detectado",
  "contextType": "desktop_app" | "terminal" | "browser" | "web_app" | "system_ui" | "mixed" | "unknown",
  "interfaceSummary": "descripcion breve de lo visible en pantalla",
  "confidence": "high" | "medium" | "low",
  "explanation": "respuesta concisa al usuario",
  "annotations": [],
  "x": number | null,
  "y": number | null,
  "label": "nombre del boton o control senalado, o null"
}`.trim();
}

function parseContextType(value: unknown): UserContextType {
  if (typeof value === "string" && VALID_CONTEXT_TYPES.has(value as UserContextType)) {
    return value as UserContextType;
  }
  return "unknown";
}

function parseConfidence(value: unknown): UserContextConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
}

export function parseUserContextResponse(raw: unknown): UserContextResult {
  const parsed =
    typeof raw === "string"
      ? (JSON.parse(raw) as Record<string, unknown>)
      : ((raw ?? {}) as Record<string, unknown>);

  const legacyTool =
    typeof parsed.detectedTool === "string" ? parsed.detectedTool.trim() : "";
  const softwareOrEnvironment =
    (typeof parsed.softwareOrEnvironment === "string"
      ? parsed.softwareOrEnvironment.trim()
      : "") ||
    legacyTool ||
    "Desconocido";

  const hasCoords = typeof parsed.x === "number" && typeof parsed.y === "number";

  return {
    softwareOrEnvironment,
    contextType: parseContextType(parsed.contextType),
    interfaceSummary:
      typeof parsed.interfaceSummary === "string"
        ? parsed.interfaceSummary.trim()
        : "",
    confidence: parseConfidence(parsed.confidence),
    explanation:
      typeof parsed.explanation === "string" && parsed.explanation.trim()
        ? parsed.explanation.trim()
        : "He analizado tu pantalla y puedo ayudarte con eso.",
    x: hasCoords ? Math.max(0, Math.min(1, parsed.x as number)) : null,
    y: hasCoords ? Math.max(0, Math.min(1, parsed.y as number)) : null,
    label:
      typeof parsed.label === "string" && parsed.label.trim()
        ? parsed.label.trim()
        : undefined,
    annotationsRaw: parsed.annotations,
  };
}

export async function analyzeUserContextFromImage(args: {
  imageBase64: string;
  userQuestion: string;
  ragContext: string;
  appHint?: string;
  apiKey: string;
  model: string;
}): Promise<UserContextResult> {
  const imageUrl = normalizeImageDataUrl(args.imageBase64);
  const systemPrompt = buildVisionSystemPrompt(
    args.userQuestion,
    args.ragContext,
    args.appHint
  );

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: args.model,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Pregunta del usuario: "${args.userQuestion}"` },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errData = await response.text();
    throw new Error(`OpenAI Vision error (${response.status}): ${errData}`);
  }

  const data = await response.json();
  const contentText = data.choices?.[0]?.message?.content;
  if (!contentText) {
    throw new Error("OpenAI Vision devolvio una respuesta vacia");
  }

  return parseUserContextResponse(contentText);
}
