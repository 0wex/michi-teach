import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import Anthropic from "@anthropic-ai/sdk";

// 1. Listar mensajes de una conversación en orden cronológico
export const list = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .collect();
  },
});

// 2. Guardar un mensaje en la base de datos
export const save = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
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
      screenshotUrl: args.screenshotUrl,
      visualHighlight: args.visualHighlight,
      createdAt: Date.now(),
    });
  },
});

// 3. Enviar mensaje del usuario y generar la respuesta del asistente (IA)
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
    visualHighlight?: { x: number; y: number; label?: string };
  }> => {
    // A. Guardar mensaje del usuario
    const userMessageId: Id<"messages"> = await ctx.runMutation(api.messages.save, {
      conversationId: args.conversationId,
      role: "user",
      content: args.content,
      screenshotUrl: args.imageBase64,
    });

    const apiKey = process.env.ANTHROPIC_API_KEY;

    // B. Si hay imagen y clave de Anthropic, invocar Claude 3.7 Vision
    if (args.imageBase64 && apiKey) {
      try {
        const anthropic = new Anthropic({ apiKey });

        let rawBase64 = args.imageBase64;
        let mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png";

        if (rawBase64.includes(";base64,")) {
          const parts = rawBase64.split(";base64,");
          if (parts[0].includes("image/jpeg") || parts[0].includes("image/jpg")) {
            mediaType = "image/jpeg";
          } else if (parts[0].includes("image/webp")) {
            mediaType = "image/webp";
          }
          rawBase64 = parts[1];
        }

        const prompt = `
ROL: Eres un tutor de software universal y experto en interfaces gráficas.
TAREA:
1. El usuario pregunta: "${args.content}".
2. Si la duda se refiere a un botón, menú, herramienta o control específico visible en la imagen:
   - Identifica el elemento exacto.
   - Provee las coordenadas normalizadas del centro del elemento (X e Y entre 0.0 y 1.0).
   - Escribe una explicación clara y concisa (máximo 30 palabras).
3. Devuelve ÚNICAMENTE un objeto JSON:
{
  "explanation": "Texto explicativo...",
  "x": number | null,
  "y": number | null,
  "label": "Nombre del botón o herramienta"
}
`;

        const response = await anthropic.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 300,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: rawBase64,
                  },
                },
                {
                  type: "text",
                  text: prompt,
                },
              ],
            },
          ],
        });

        const textContent = response.content[0];
        if (textContent.type === "text") {
          const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const hasCoords = typeof parsed.x === "number" && typeof parsed.y === "number";

            const visualHighlight = hasCoords
              ? {
                  x: Math.max(0.0, Math.min(1.0, parsed.x)),
                  y: Math.max(0.0, Math.min(1.0, parsed.y)),
                  label: parsed.label ? String(parsed.label) : undefined,
                }
              : undefined;

            const assistantMessageId: Id<"messages"> = await ctx.runMutation(
              api.messages.save,
              {
                conversationId: args.conversationId,
                role: "assistant",
                content: parsed.explanation ?? "He localizado la herramienta en tu pantalla.",
                visualHighlight,
              }
            );

            return {
              userMessageId,
              assistantMessageId,
              content: parsed.explanation ?? "He localizado la herramienta en tu pantalla.",
              visualHighlight,
            };
          }
        }
      } catch (err) {
        console.error("Error al procesar con Claude Vision:", err);
      }
    }

    // C. Respuesta simulada / texto conversacional (si no hay API key o no hay captura)
    const defaultResponse = args.imageBase64
      ? "He recibido tu captura de pantalla. En este momento el servicio de inferencia está funcionando en modo demostración. Puedes configurar ANTHROPIC_API_KEY para detección en tiempo real."
      : `He recibido tu consulta: "${args.content}". Puedes hacer preguntas sobre cualquier software o adjuntar una captura de tu pantalla para que te señale el botón exacto.`;

    const assistantMessageId: Id<"messages"> = await ctx.runMutation(api.messages.save, {
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
