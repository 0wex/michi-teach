import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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

// 3. Enviar mensaje del usuario y generar la respuesta del asistente con OpenAI (gpt-4o-mini)
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

    // Detectar clave de OpenAI (acepta OPENAI_API_KEY o ANTHROPIC_API_KEY por si se guardó ahí)
    const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // B. Si hay imagen y clave de API, invocar modelo multimodal con visión (gpt-4o-mini)
    if (args.imageBase64 && apiKey) {
      try {
        let imageUrl = args.imageBase64;
        if (!imageUrl.startsWith("data:")) {
          imageUrl = `data:image/png;base64,${imageUrl}`;
        }

        const systemPrompt = `
ROL: Eres un tutor de software universal y experto en interfaces gráficas de usuario.
TAREA:
1. El usuario pregunta: "${args.content}".
2. Analiza la imagen de la interfaz. Si la duda se refiere a un botón, menú, herramienta o control específico:
   - Identifica el elemento exacto.
   - Provee las coordenadas normalizadas del centro del elemento (x e y flotantes entre 0.0 y 1.0).
   - Escribe una explicación clara y concisa en español (máximo 30 palabras).
3. Devuelve ÚNICAMENTE un JSON con este formato exacto:
{
  "explanation": "Texto explicativo...",
  "x": 0.5,
  "y": 0.5,
  "label": "Nombre del botón o control"
}
Si no se identifica ningún control concreto, devuelve x: null, y: null, label: null.
`;

        const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`,
          },
          body: JSON.stringify({
            model: model,
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 300,
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Pregunta del usuario: "${args.content}"`,
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: imageUrl,
                    },
                  },
                ],
              },
            ],
          }),
        });

        if (openAiResponse.ok) {
          const data = await openAiResponse.json();
          const choice = data.choices?.[0];
          const contentText = choice?.message?.content;

          if (contentText) {
            const parsed = JSON.parse(contentText);
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
        } else {
          const errData = await openAiResponse.text();
          console.error("OpenAI API error response:", openAiResponse.status, errData);
        }
      } catch (err) {
        console.error("Error al procesar con OpenAI Vision:", err);
      }
    }

    // B2. Sin imagen pero con clave: chat de texto con el tutor (OpenAI)
    if (!args.imageBase64 && apiKey) {
      try {
        const history = await ctx.runQuery(api.messages.list, {
          conversationId: args.conversationId,
        });
        const priorTurns = history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-12)
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const systemPrompt =
          "Eres Michi, un tutor personal cálido, claro y motivador. Explicas cualquier " +
          "tema paso a paso, con ejemplos concretos y lenguaje sencillo. Respondes siempre " +
          "en español. Si la pregunta es ambigua, pide una aclaración breve. Mantén las " +
          "respuestas enfocadas (unas 180 palabras como máximo, salvo que pidan más detalle).";

        const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`,
          },
          body: JSON.stringify({
            model: model,
            temperature: 0.4,
            max_tokens: 600,
            messages: [{ role: "system", content: systemPrompt }, ...priorTurns],
          }),
        });

        if (chatResponse.ok) {
          const data = await chatResponse.json();
          const reply: string | undefined = data.choices?.[0]?.message?.content?.trim();
          if (reply) {
            const assistantMessageId: Id<"messages"> = await ctx.runMutation(api.messages.save, {
              conversationId: args.conversationId,
              role: "assistant",
              content: reply,
            });
            return { userMessageId, assistantMessageId, content: reply };
          }
        } else {
          const errData = await chatResponse.text();
          console.error("OpenAI API error (texto):", chatResponse.status, errData);
        }
      } catch (err) {
        console.error("Error al procesar texto con OpenAI:", err);
      }
    }

    // C. Respuesta de fallback / texto conversacional (si no hay clave o no hay imagen)
    const defaultResponse = args.imageBase64
      ? "He recibido tu captura de pantalla. En este momento el servicio de inferencia está funcionando en modo demostración. Puedes configurar OPENAI_API_KEY para detección en tiempo real."
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
