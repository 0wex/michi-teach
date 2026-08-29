import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireConversationAccess } from "./lib/authorization";
import {
  MAX_IMAGE_BASE64_LENGTH,
  normalizeImageDataUrl,
  storeScreenshotFromBase64,
} from "./lib/imageStorage";

async function withResolvedScreenshotUrl(
  ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
  message: {
    screenshotUrl?: string;
    screenshotStorageId?: Id<"_storage">;
  } & Record<string, unknown>
) {
  if (message.screenshotStorageId) {
    const url = await ctx.storage.getUrl(message.screenshotStorageId);
    if (url) {
      return { ...message, screenshotUrl: url };
    }
  }
  return message;
}

export const list = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await requireConversationAccess(ctx, args.conversationId);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .collect();

    return Promise.all(messages.map((message) => withResolvedScreenshotUrl(ctx, message)));
  },
});

export const save = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    detectedTool: v.optional(v.string()),
    screenshotUrl: v.optional(v.string()),
    screenshotStorageId: v.optional(v.id("_storage")),
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
      screenshotStorageId: args.screenshotStorageId,
      visualHighlight: args.visualHighlight,
      createdAt: Date.now(),
    });
  },
});

export const sendAndReply = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    imageBase64: v.optional(v.string()),
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
  }> => {
    await ctx.runQuery(internal.conversations.assertAccess, {
      conversationId: args.conversationId,
    });

    if (args.imageBase64 && args.imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      throw new Error("La imagen supera el tamaño máximo permitido (16 MB).");
    }

    const screenshotStorageId = args.imageBase64
      ? await storeScreenshotFromBase64(ctx, args.imageBase64)
      : undefined;

    const userMessageId: Id<"messages"> = await ctx.runMutation(internal.messages.save, {
      conversationId: args.conversationId,
      role: "user",
      content: args.content,
      screenshotStorageId,
    });

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (args.imageBase64 && apiKey) {
      const imageUrl = normalizeImageDataUrl(args.imageBase64);

      let ragContext = "";
      try {
        const relevantDocs = await ctx.runAction(internal.rag.searchDocs, {
          query: args.content,
          limit: 2,
        });
        if (relevantDocs.length > 0) {
          ragContext = relevantDocs
            .map((d) => `[DOCUMENTACIÓN OFICIAL: ${d.title} (${d.tool})]: ${d.content}`)
            .join("\n\n");
        }
      } catch (ragErr) {
        console.warn("RAG no disponible:", ragErr);
      }

      const systemPrompt = `
ROL: Eres Michi, un tutor experto de software de edición de video, diseño y 3D en tiempo real.

TAREA PRINCIPAL:
1. AUTO-DETECCIÓN: Analiza la interfaz en la captura de pantalla e identifica qué software es (ej: "DaVinci Resolve", "Blender", "CapCut", "Adobe Photoshop", "Adobe Premiere Pro", o "Desconocido").
2. CONTEXTO TÉCNICO OFICIAL (RAG):
${ragContext ? ragContext : "Utiliza las mejores prácticas estándar para la herramienta identificada."}

3. INSTRUCCIÓN AL USUARIO:
   - Responde a la duda: "${args.content}".
   - Utiliza los atajos de teclado y nombres de menús canónicos de la documentación oficial.
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

      let textRagSnippet = "";
      try {
        const docs = await ctx.runAction(internal.rag.searchDocs, {
          query: args.content,
          limit: 2,
        });
        if (docs.length > 0) {
          textRagSnippet = docs.map((d) => `[${d.title}]: ${d.content}`).join("\n");
        }
      } catch {
        // RAG opcional
      }

      const systemPrompt =
        "Eres Michi, un tutor personal cálido, claro y motivador. Explicas cualquier " +
        "tema paso a paso, con ejemplos concretos y lenguaje sencillo. Respondes siempre " +
        "en español. Si la pregunta es ambigua, pide una aclaración breve. Mantén las " +
        "respuestas enfocadas (unas 180 palabras como máximo, salvo que pidan más detalle).\n\n" +
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
      return { userMessageId, assistantMessageId, content: reply };
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
    };
  },
});
