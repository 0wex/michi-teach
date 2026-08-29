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

// 3. Enviar mensaje del usuario y generar la respuesta con Auto-Detección y RAG Interno
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
    // A. Guardar mensaje del usuario
    const userMessageId: Id<"messages"> = await ctx.runMutation(api.messages.save, {
      conversationId: args.conversationId,
      role: "user",
      content: args.content,
      screenshotUrl: args.imageBase64,
    });

    const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // B1. Flujo con Imagen: Auto-Detección de Software, RAG e Inferencia Visual
    if (args.imageBase64 && apiKey) {
      try {
        let imageUrl = args.imageBase64;
        if (!imageUrl.startsWith("data:")) {
          imageUrl = `data:image/png;base64,${imageUrl}`;
        }

        // Paso 1: Consultar RAG preliminarmente con la pregunta del usuario
        let ragContext = "";
        let detectedToolName: string | undefined = undefined;

        try {
          const relevantDocs = await ctx.runAction(api.rag.searchDocs, {
            query: args.content,
            limit: 2,
          });

          if (relevantDocs && relevantDocs.length > 0) {
            ragContext = relevantDocs
              .map((d) => `[DOCUMENTACIÓN OFICIAL: ${d.title} (${d.tool})]: ${d.content}`)
              .join("\n\n");
          }
        } catch (ragErr) {
          console.warn("RAG no disponible o sin inicializar aún:", ragErr);
        }

        // Paso 2: Prompt con Auto-Detección de Software y RAG Grounding
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
            model: model,
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 350,
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

            detectedToolName = parsed.detectedTool ? String(parsed.detectedTool) : undefined;

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
                detectedTool: detectedToolName,
                visualHighlight,
              }
            );

            return {
              userMessageId,
              assistantMessageId,
              content: parsed.explanation ?? "He localizado la herramienta en tu pantalla.",
              detectedTool: detectedToolName,
              visualHighlight,
            };
          }
        } else {
          const errData = await openAiResponse.text();
          console.error("OpenAI API error response:", openAiResponse.status, errData);
        }
      } catch (err) {
        console.error("Error al procesar con OpenAI Vision y RAG:", err);
      }
    }

    // B2. Sin imagen pero con clave: Chat de texto con el tutor Michi enriquecido con RAG y memoria
    if (!args.imageBase64 && apiKey) {
      try {
        const history = await ctx.runQuery(api.messages.list, {
          conversationId: args.conversationId,
        });
        const priorTurns = history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-12)
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        // Consultar RAG para complementar con documentación técnica si aplica
        let textRagSnippet = "";
        try {
          const docs = await ctx.runAction(api.rag.searchDocs, {
            query: args.content,
            limit: 2,
          });
          if (docs && docs.length > 0) {
            textRagSnippet = docs.map((d) => `[${d.title}]: ${d.content}`).join("\n");
          }
        } catch {
          // Ignorar si el RAG no devuelve docs
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

    // C. Respuesta de fallback / texto conversacional (si no hay clave)
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
