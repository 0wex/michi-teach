import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireConversationAccess } from "./lib/authorization";

export const list = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await requireConversationAccess(ctx, args.conversationId);
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .collect();
  },
});

export const save = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    detectedTool: v.optional(v.string()),
    screenshotUrl: v.optional(v.string()),
    visualHighlight: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
        label: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<"messages">> => {
    return await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      detectedTool: args.detectedTool,
      screenshotUrl: args.screenshotUrl,
      visualHighlight: args.visualHighlight,
      createdAt: Date.now(),
    });
  },
});

/**
 * Detecta expresiones del usuario que fuerzan el fallback web live.
 * Ejemplos: "verifica con la web", "búscalo online", "actualiza", "chequea internet".
 */
function shouldForceWeb(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns = [
    /verifica\s+(con\s+la\s+)?web/,
    /verific[aá](lo)?\s+online/,
    /b[uú]scalo\s+online/,
    /b[uú]scalo\s+en\s+internet/,
    /b[uú]scalo\s+en\s+la\s+web/,
    /consulta\s+(la\s+)?web/,
    /actual(iza|ízalo|izame)/,
    /revisa\s+(la\s+)?web/,
    /chequea\s+(la\s+)?web/,
    /chequea\s+internet/,
    /fuentes?\s+en\s+vivo/,
  ];
  return patterns.some((p) => p.test(lower));
}

type HybridHit = {
  title: string;
  content: string;
  tool: string;
  score: number;
  url?: string;
  source: "official-docs" | "official-forum" | "tavily-live" | "seed";
  topic?: string;
};

interface AssistantSource {
  title: string;
  url?: string;
  source: HybridHit["source"];
}

function toSources(hits: HybridHit[]): AssistantSource[] {
  const seen = new Set<string>();
  const out: AssistantSource[] = [];
  for (const h of hits) {
    const key = h.url ?? h.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: h.title, url: h.url, source: h.source });
  }
  return out;
}

function formatContextBlock(hits: HybridHit[]): string {
  if (hits.length === 0) return "";
  return hits
    .map((h) => {
      const label = h.source === "tavily-live" ? "WEB LIVE" : "CONTEXTO OFICIAL";
      const urlLine = h.url ? ` (${h.url})` : "";
      return `[${label}: ${h.title}${urlLine}]\n${h.content}`;
    })
    .join("\n\n");
}

export const sendAndReply = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    imageBase64: v.optional(v.string()),
    app: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    userMessageId: Id<"messages">;
    assistantMessageId: Id<"messages">;
    content: string;
    detectedTool?: string;
    visualHighlight?: { x: number; y: number; label?: string };
    sources: AssistantSource[];
  }> => {
    await ctx.runQuery(internal.conversations.assertAccess, {
      conversationId: args.conversationId,
    });

    const userMessageId: Id<"messages"> = await ctx.runMutation(internal.messages.save, {
      conversationId: args.conversationId,
      role: "user",
      content: args.content,
      screenshotUrl: args.imageBase64,
    });

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const forceWeb = shouldForceWeb(args.content);

    if (args.imageBase64 && apiKey) {
      let imageUrl = args.imageBase64;
      if (!imageUrl.startsWith("data:")) {
        imageUrl = `data:image/png;base64,${imageUrl}`;
      }

      let hits: HybridHit[] = [];
      try {
        hits = await ctx.runAction(internal.rag.hybridSearch, {
          query: args.content,
          app: args.app,
          forceWeb,
          limit: 3,
        });
      } catch (ragErr) {
        console.warn("RAG no disponible:", ragErr);
      }

      const ragContext = formatContextBlock(hits);

      const systemPrompt = `
ROL: Eres Michi, un tutor experto de software de edición de video, diseño y 3D en tiempo real.

TAREA PRINCIPAL:
1. AUTO-DETECCIÓN: Analiza la interfaz en la captura de pantalla e identifica qué software es (ej: "DaVinci Resolve", "Blender", "CapCut", "Adobe Photoshop", "Adobe Premiere Pro", o "Desconocido").
2. CONTEXTO TÉCNICO OFICIAL (RAG):
${ragContext ? ragContext : "No hay contexto oficial recuperado."}

3. INSTRUCCIÓN AL USUARIO:
   - Responde a la duda: "${args.content}".
   - Utiliza los atajos de teclado y nombres de menús canónicos de la documentación oficial.
   - Si el CONTEXTO OFICIAL no cubre la pregunta, responde exactamente: "No tengo información oficial verificada para esto" en vez de inventar pasos de UI.
   - Sé conciso, claro y motivador (máximo 35 palabras), pensado para guiar en vivo.

4. SEÑALIZACIÓN VISUAL:
   - Si la consulta alude a un botón, menú, herramienta o control visible en pantalla, indica sus coordenadas normalizadas (x e y flotantes entre 0.0 y 1.0) del centro exacto del elemento.
   - Si no hay un elemento puntual que señalar, usa x: null, y: null.

FORMATO OBLIGATORIO DE RESPUESTA:
Devuelve ÚNICAMENTE un JSON válido con esta estructura:
{
  "detectedTool": "Nombre del software identificado (ej. DaVinci Resolve)",
  "explanation": "Texto explicativo conciso...",
  "x": number | null,
  "y": number | null,
  "label": "Nombre del botón o herramienta señalada"
}
`;

      const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 350,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: `Pregunta del usuario: "${args.content}"` },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
      });

      if (!openAiResponse.ok) {
        const errData = await openAiResponse.text();
        throw new Error(`OpenAI Vision error (${openAiResponse.status}): ${errData}`);
      }

      const data = await openAiResponse.json();
      const contentText = data.choices?.[0]?.message?.content;
      if (!contentText) {
        throw new Error("OpenAI Vision devolvió una respuesta vacía");
      }

      const parsed = JSON.parse(contentText);
      const hasCoords = typeof parsed.x === "number" && typeof parsed.y === "number";
      const detectedToolName = parsed.detectedTool ? String(parsed.detectedTool) : undefined;
      const visualHighlight = hasCoords
        ? {
            x: Math.max(0.0, Math.min(1.0, parsed.x)),
            y: Math.max(0.0, Math.min(1.0, parsed.y)),
            label: parsed.label ? String(parsed.label) : undefined,
          }
        : undefined;

      const explanation = parsed.explanation ?? "He localizado la herramienta en tu pantalla.";
      const assistantMessageId = await ctx.runMutation(internal.messages.save, {
        conversationId: args.conversationId,
        role: "assistant",
        content: explanation,
        detectedTool: detectedToolName,
        visualHighlight,
      });

      return {
        userMessageId,
        assistantMessageId,
        content: explanation,
        detectedTool: detectedToolName,
        visualHighlight,
        sources: toSources(hits),
      };
    }

    if (!args.imageBase64 && apiKey) {
      const history = await ctx.runQuery(api.messages.list, {
        conversationId: args.conversationId,
      });
      const priorTurns = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-12)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      let hits: HybridHit[] = [];
      try {
        hits = await ctx.runAction(internal.rag.hybridSearch, {
          query: args.content,
          app: args.app,
          forceWeb,
          limit: 3,
        });
      } catch {
        // RAG opcional
      }
      const textRagSnippet = formatContextBlock(hits);

      const systemPrompt =
        "Eres Michi, un tutor personal cálido, claro y motivador. Explicas cualquier " +
        "tema paso a paso, con ejemplos concretos y lenguaje sencillo. Respondes siempre " +
        "en español. Si la pregunta es ambigua, pide una aclaración breve. Mantén las " +
        "respuestas enfocadas (unas 180 palabras como máximo, salvo que pidan más detalle). " +
        "Si el CONTEXTO OFICIAL no cubre la pregunta, responde exactamente: " +
        '"No tengo información oficial verificada para esto" en vez de inventar pasos de UI.\n\n' +
        (textRagSnippet ? `INFORMACIÓN DE REFERENCIA:\n${textRagSnippet}` : "");

      const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 600,
          messages: [{ role: "system", content: systemPrompt }, ...priorTurns],
        }),
      });

      if (!chatResponse.ok) {
        const errData = await chatResponse.text();
        throw new Error(`OpenAI chat error (${chatResponse.status}): ${errData}`);
      }

      const data = await chatResponse.json();
      const reply: string | undefined = data.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        throw new Error("OpenAI chat devolvió una respuesta vacía");
      }

      const assistantMessageId = await ctx.runMutation(internal.messages.save, {
        conversationId: args.conversationId,
        role: "assistant",
        content: reply,
      });
      return {
        userMessageId,
        assistantMessageId,
        content: reply,
        sources: toSources(hits),
      };
    }

    const defaultResponse = args.imageBase64
      ? "He recibido tu captura de pantalla. En este momento el servicio de inferencia está funcionando en modo demostración. Configura OPENAI_API_KEY para detección en tiempo real."
      : `He recibido tu consulta: "${args.content}". Puedes hacer preguntas sobre cualquier software o adjuntar una captura de tu pantalla para que te señale el botón exacto.`;

    const assistantMessageId = await ctx.runMutation(internal.messages.save, {
      conversationId: args.conversationId,
      role: "assistant",
      content: defaultResponse,
    });

    return {
      userMessageId,
      assistantMessageId,
      content: defaultResponse,
      sources: [],
    };
  },
});
