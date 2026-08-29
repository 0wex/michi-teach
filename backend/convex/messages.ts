import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireConversationAccess } from "./lib/authorization";
import {
  MAX_IMAGE_BASE64_LENGTH,
  storeScreenshotFromBase64,
} from "./lib/imageStorage";
import { resolveToolIdentity } from "./lib/appCatalog";
import { analyzeUserContextFromImage } from "./lib/userContext";
import { isHybridSearchLowCoverage } from "./lib/ragCoverage";

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

/**
 * Anotación visual que el overlay dibuja sobre el escritorio. Coordenadas
 * normalizadas 0..1 respecto a la captura. `point` señala un elemento, `rect`
 * enmarca una región/panel, `arrow` indica un arrastre o una dirección.
 */
type Annotation =
  | { kind: "point"; x: number; y: number; label?: string; step?: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; label?: string; step?: number }
  | {
      kind: "arrow";
      x: number;
      y: number;
      x2: number;
      y2: number;
      label?: string;
      step?: number;
    };

const clamp01 = (n: unknown): number =>
  Math.max(0, Math.min(1, typeof n === "number" && Number.isFinite(n) ? n : 0));

/** Valida y normaliza el array `annotations` que devuelve el modelo. */
function parseAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return [];
  const out: Annotation[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const label =
      typeof a.label === "string" && a.label.trim() ? a.label.trim().slice(0, 60) : undefined;
    const step =
      typeof a.step === "number" && Number.isFinite(a.step) ? Math.round(a.step) : undefined;
    const kind = a.kind;
    if (kind === "rect") {
      if (typeof a.x !== "number" || typeof a.y !== "number") continue;
      out.push({
        kind: "rect",
        x: clamp01(a.x),
        y: clamp01(a.y),
        w: clamp01(a.w),
        h: clamp01(a.h),
        label,
        step,
      });
    } else if (kind === "arrow") {
      if (
        typeof a.x !== "number" ||
        typeof a.y !== "number" ||
        typeof a.x2 !== "number" ||
        typeof a.y2 !== "number"
      )
        continue;
      out.push({
        kind: "arrow",
        x: clamp01(a.x),
        y: clamp01(a.y),
        x2: clamp01(a.x2),
        y2: clamp01(a.y2),
        label,
        step,
      });
    } else if (kind === "point" || kind === undefined) {
      if (typeof a.x !== "number" || typeof a.y !== "number") continue;
      out.push({ kind: "point", x: clamp01(a.x), y: clamp01(a.y), label, step });
    }
  }
  // Ordenar por `step` si viene; los sin step al final en orden de aparición.
  return out
    .map((a, i) => ({ a, i }))
    .sort((p, q) => (p.a.step ?? 99) - (q.a.step ?? 99) || p.i - q.i)
    .map(({ a }) => a);
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
    annotations?: Annotation[];
    sources: AssistantSource[];
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
    // Modelo separado para la rama de visión: señalar el centro de un botón
    // con precisión < 50 px exige más capacidad que el chat de texto normal.
    const visionModel = process.env.OPENAI_VISION_MODEL || "gpt-4o";
    const forceWeb = shouldForceWeb(args.content);

    if (args.imageBase64 && apiKey) {
      const appIdentity = args.app ? resolveToolIdentity(args.app) : undefined;

      let hits: HybridHit[] = [];
      try {
        hits = await ctx.runAction(internal.rag.hybridSearch, {
          query: args.content,
          app: args.app,
          detectedToolName: args.app,
          requireLive: appIdentity ? !appIdentity.inCatalog : false,
          forceWeb,
          limit: 3,
        });
      } catch (ragErr) {
        console.warn("RAG no disponible:", ragErr);
      }

      let ragContext = formatContextBlock(hits);

      let userContext = await analyzeUserContextFromImage({
        imageBase64: args.imageBase64,
        userQuestion: args.content,
        ragContext,
        appHint: args.app,
        apiKey,
        model: visionModel,
      });

      const shouldRefineRag =
        isHybridSearchLowCoverage(hits) &&
        userContext.confidence !== "low" &&
        userContext.softwareOrEnvironment !== "Desconocido";

      if (shouldRefineRag) {
        const refinedIdentity = resolveToolIdentity(userContext.softwareOrEnvironment);
        try {
          const refinedHits = await ctx.runAction(internal.rag.hybridSearch, {
            query: args.content,
            detectedToolName: userContext.softwareOrEnvironment,
            requireLive: !refinedIdentity.inCatalog,
            forceWeb,
            limit: 3,
          });
          if (refinedHits.length > 0) {
            hits = refinedHits;
            ragContext = formatContextBlock(hits);
            userContext = await analyzeUserContextFromImage({
              imageBase64: args.imageBase64,
              userQuestion: args.content,
              ragContext,
              appHint: args.app,
              apiKey,
              model: visionModel,
            });
          }
        } catch (ragErr) {
          console.warn("RAG refinado no disponible:", ragErr);
        }
      }

      const resolvedEnvironment = userContext.softwareOrEnvironment;

      let annotations = parseAnnotations(userContext.annotationsRaw);
      const hasLooseCoords = userContext.x !== null && userContext.y !== null;
      if (annotations.length === 0 && hasLooseCoords) {
        annotations = [
          {
            kind: "point",
            x: userContext.x!,
            y: userContext.y!,
            label: userContext.label,
          },
        ];
      }

      const primary =
        annotations.find((a) => a.kind === "point") ??
        annotations.find((a) => a.kind === "rect");
      const visualHighlight = primary
        ? {
            x: primary.kind === "rect" ? primary.x + primary.w / 2 : primary.x,
            y: primary.kind === "rect" ? primary.y + primary.h / 2 : primary.y,
            label: primary.label,
          }
        : hasLooseCoords
          ? {
              x: userContext.x!,
              y: userContext.y!,
              label: userContext.label,
            }
          : undefined;

      const assistantMessageId = await ctx.runMutation(internal.messages.save, {
        conversationId: args.conversationId,
        role: "assistant",
        content: userContext.explanation,
        detectedTool: resolvedEnvironment,
        visualHighlight,
      });

      return {
        userMessageId,
        assistantMessageId,
        content: userContext.explanation,
        detectedTool: resolvedEnvironment,
        visualHighlight,
        annotations: annotations.length > 0 ? annotations : undefined,
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
