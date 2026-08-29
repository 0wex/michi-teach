/**
 * Módulo RAG:
 *
 *  - `ingestApp({ app, topics?, triggeredBy })`
 *      Ingesta autoritativa vía Tavily (search restringido a dominios oficiales
 *      + extract + chunking + dedup por hash). Registra cada corrida en `ingestionRuns`.
 *
 *  - `hybridSearch({ query, app?, forceWeb? })`
 *      1) Vector search local sobre `documents`.
 *      2) Si la cobertura es baja (top-1 < 0.72 o < 2 hits con score > 0.6)
 *         o si `forceWeb` es true, ejecuta Tavily live sin dominios,
 *         persiste como `source: "tavily-live"` y añade los resultados al output.
 *      Devuelve resultados etiquetados con `source` para trazabilidad.
 */

import {
  action,
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { APP_CATALOG, getAppEntry, normalizeAppKey, resolveToolIdentity } from "./lib/appCatalog";
import { requireAuthUserId } from "./lib/authorization";
import {
  CHUNK_TARGET_CHARS,
  extractQualitySignals,
  sha256Hex,
  splitIntoChunks,
} from "./lib/chunking";
import {
  classifyOfficialSource,
  tavilyExtract,
  tavilySearch,
  TavilySearchResult,
} from "./lib/tavily";

const LOW_TOP1_THRESHOLD = 0.72;
const LOW_MIN_HIT_SCORE = 0.6;
const LOW_MIN_HIT_COUNT = 2;

const VALID_SOURCES = ["official-docs", "official-forum", "tavily-live", "seed"] as const;
type DocumentSource = (typeof VALID_SOURCES)[number];

// -------------------------------------------------------------------------
// Helpers de embeddings
// -------------------------------------------------------------------------

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Error al generar embedding (${response.status}): ${err}`);
  }
  const data = await response.json();
  return data.data[0].embedding as number[];
}

function requireOpenAiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("No hay OPENAI_API_KEY configurada para generar embeddings");
  }
  return apiKey;
}

// -------------------------------------------------------------------------
// Queries y mutations internas
// -------------------------------------------------------------------------

export const fetchDocsByIds = internalQuery({
  args: { ids: v.array(v.id("documents")) },
  handler: async (ctx, args) => {
    const docs: Doc<"documents">[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) docs.push(doc);
    }
    return docs;
  },
});

export const findByToolTitle = internalQuery({
  args: { tool: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_tool_title", (q) =>
        q.eq("tool", args.tool.toLowerCase()).eq("title", args.title)
      )
      .unique();
  },
});

export const findByHash = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .first();
  },
});

export const saveDoc = internalMutation({
  args: {
    tool: v.string(),
    title: v.string(),
    content: v.string(),
    embedding: v.array(v.float64()),
    url: v.optional(v.string()),
    topic: v.optional(v.string()),
    source: v.optional(
      v.union(
        v.literal("official-docs"),
        v.literal("official-forum"),
        v.literal("tavily-live"),
        v.literal("seed")
      )
    ),
    version: v.optional(v.string()),
    chunkIndex: v.optional(v.number()),
    chunkTotal: v.optional(v.number()),
    quality: v.optional(
      v.object({
        acceptedAnswer: v.optional(v.boolean()),
        voteScore: v.optional(v.number()),
        tavilyScore: v.optional(v.number()),
      })
    ),
    hash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("documents", {
      tool: args.tool.toLowerCase(),
      title: args.title,
      content: args.content,
      embedding: args.embedding,
      url: args.url,
      topic: args.topic,
      source: args.source,
      version: args.version,
      ingestedAt: Date.now(),
      chunkIndex: args.chunkIndex,
      chunkTotal: args.chunkTotal,
      quality: args.quality,
      hash: args.hash,
    });
  },
});

export const startIngestionRun = internalMutation({
  args: {
    app: v.string(),
    topic: v.optional(v.string()),
    triggeredBy: v.union(v.literal("cron"), v.literal("manual"), v.literal("fallback")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("ingestionRuns", {
      app: args.app.toLowerCase(),
      topic: args.topic,
      triggeredBy: args.triggeredBy,
      startedAt: Date.now(),
      status: "running",
      urlsDiscovered: 0,
      chunksInserted: 0,
      chunksSkipped: 0,
    });
  },
});

export const finishIngestionRun = internalMutation({
  args: {
    runId: v.id("ingestionRuns"),
    status: v.union(
      v.literal("success"),
      v.literal("partial"),
      v.literal("failed")
    ),
    urlsDiscovered: v.number(),
    chunksInserted: v.number(),
    chunksSkipped: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      urlsDiscovered: args.urlsDiscovered,
      chunksInserted: args.chunksInserted,
      chunksSkipped: args.chunksSkipped,
      error: args.error,
      finishedAt: Date.now(),
    });
  },
});

// -------------------------------------------------------------------------
// Ingesta autoritativa (Tavily + dominios oficiales)
// -------------------------------------------------------------------------

export interface IngestAppResult {
  app: string;
  runId: Id<"ingestionRuns">;
  status: "success" | "partial" | "failed";
  urlsDiscovered: number;
  chunksInserted: number;
  chunksSkipped: number;
  error?: string;
}

export const ingestApp = internalAction({
  args: {
    app: v.string(),
    topics: v.optional(v.array(v.string())),
    triggeredBy: v.optional(
      v.union(v.literal("cron"), v.literal("manual"), v.literal("fallback"))
    ),
    maxUrlsPerTopic: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<IngestAppResult> => {
    const entry = getAppEntry(args.app);
    if (!entry) {
      throw new Error(
        `App "${args.app}" no está en el catálogo. Agrégala en backend/convex/lib/appCatalog.ts.`
      );
    }

    const topics = args.topics && args.topics.length > 0 ? args.topics : entry.seedTopics;
    const triggeredBy = args.triggeredBy ?? "manual";
    const maxUrlsPerTopic = args.maxUrlsPerTopic ?? 4;

    const runId: Id<"ingestionRuns"> = await ctx.runMutation(
      internal.rag.startIngestionRun,
      { app: entry.key, triggeredBy }
    );

    let urlsDiscovered = 0;
    let chunksInserted = 0;
    let chunksSkipped = 0;
    const errors: string[] = [];

    try {
      const openAiKey = requireOpenAiKey();

      const discovered: Array<{ topic: string; search: TavilySearchResult }> = [];
      for (const topic of topics) {
        try {
          const res = await tavilySearch({
            query: topic,
            includeDomains: entry.officialDomains,
            maxResults: maxUrlsPerTopic,
            searchDepth: "advanced",
          });
          for (const r of res.results) {
            discovered.push({ topic, search: r });
          }
        } catch (err) {
          errors.push(
            `search[${topic}]: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      urlsDiscovered = discovered.length;

      const dedupUrls = new Map<string, { topic: string; search: TavilySearchResult }>();
      for (const item of discovered) {
        if (!dedupUrls.has(item.search.url)) dedupUrls.set(item.search.url, item);
      }

      const batches = chunkArray(Array.from(dedupUrls.values()), 10);
      for (const batch of batches) {
        let extracted;
        try {
          extracted = await tavilyExtract({
            urls: batch.map((b) => b.search.url),
            extractDepth: "advanced",
          });
        } catch (err) {
          errors.push(
            `extract: ${err instanceof Error ? err.message : String(err)}`
          );
          continue;
        }
        for (const failed of extracted.failedResults) {
          errors.push(`extract-failed[${failed.url}]: ${failed.error}`);
        }
        const byUrl = new Map(extracted.results.map((r) => [r.url, r.rawContent]));
        for (const item of batch) {
          const rawContent = byUrl.get(item.search.url);
          if (!rawContent) continue;

          const chunks = splitIntoChunks(rawContent, {
            targetChars: CHUNK_TARGET_CHARS,
          });
          if (chunks.length === 0) continue;

          for (const chunk of chunks) {
            try {
              const hash = await sha256Hex(`${entry.key}::${item.search.url}::${chunk.index}::${chunk.content}`);
              const existing = await ctx.runQuery(internal.rag.findByHash, { hash });
              if (existing) {
                chunksSkipped++;
                continue;
              }
              const quality = extractQualitySignals(chunk.content, {
                tavilyScore: item.search.score,
              });
              const embedding = await generateEmbedding(
                `${item.search.title}. ${chunk.content}`,
                openAiKey
              );
              await ctx.runMutation(internal.rag.saveDoc, {
                tool: entry.key,
                title: item.search.title,
                content: chunk.content,
                embedding,
                url: item.search.url,
                topic: item.topic,
                source: classifyOfficialSource(item.search.url),
                version: entry.version,
                chunkIndex: chunk.index,
                chunkTotal: chunk.total,
                quality: Object.keys(quality).length > 0 ? quality : undefined,
                hash,
              });
              chunksInserted++;
            } catch (err) {
              errors.push(
                `chunk[${item.search.url}#${chunk.index}]: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        }
      }

      const status: "success" | "partial" | "failed" =
        chunksInserted === 0 && errors.length > 0
          ? "failed"
          : errors.length > 0
            ? "partial"
            : "success";

      await ctx.runMutation(internal.rag.finishIngestionRun, {
        runId,
        status,
        urlsDiscovered,
        chunksInserted,
        chunksSkipped,
        error: errors.length > 0 ? errors.slice(0, 5).join(" | ") : undefined,
      });

      return {
        app: entry.key,
        runId,
        status,
        urlsDiscovered,
        chunksInserted,
        chunksSkipped,
        error: errors.length > 0 ? errors.slice(0, 5).join(" | ") : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.rag.finishIngestionRun, {
        runId,
        status: "failed",
        urlsDiscovered,
        chunksInserted,
        chunksSkipped,
        error: message,
      });
      return {
        app: entry.key,
        runId,
        status: "failed",
        urlsDiscovered,
        chunksInserted,
        chunksSkipped,
        error: message,
      };
    }
  },
});

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// -------------------------------------------------------------------------
// Búsqueda híbrida (vector local + fallback Tavily live)
// -------------------------------------------------------------------------

export interface HybridSearchHit {
  title: string;
  content: string;
  tool: string;
  score: number;
  url?: string;
  source: DocumentSource;
  topic?: string;
}

function buildSearchContext(args: {
  query: string;
  app?: string;
  detectedToolName?: string;
}) {
  if (args.detectedToolName) {
    const identity = resolveToolIdentity(args.detectedToolName);
    return {
      enrichedQuery: `${identity.displayName} ${args.query}`.trim(),
      catalogKey: identity.inCatalog ? identity.key : undefined,
      toolKey: identity.key,
      inCatalog: identity.inCatalog,
    };
  }
  if (args.app) {
    const identity = resolveToolIdentity(args.app);
    return {
      enrichedQuery: args.query,
      catalogKey: identity.inCatalog ? identity.key : normalizeAppKey(args.app),
      toolKey: identity.key,
      inCatalog: identity.inCatalog,
    };
  }
  return {
    enrichedQuery: args.query,
    catalogKey: undefined as string | undefined,
    toolKey: "generic",
    inCatalog: false,
  };
}

export const hybridSearch = internalAction({
  args: {
    query: v.string(),
    app: v.optional(v.string()),
    detectedToolName: v.optional(v.string()),
    requireLive: v.optional(v.boolean()),
    forceWeb: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<HybridSearchHit[]> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return [];

    const limit = args.limit ?? 4;
    const { enrichedQuery, catalogKey, toolKey, inCatalog } = buildSearchContext(args);
    const skipLocal = args.requireLive === true || !inCatalog;

    let localHits: HybridSearchHit[] = [];
    if (!skipLocal) {
      try {
        const queryEmbedding = await generateEmbedding(enrichedQuery, apiKey);
        const searchResults = await ctx.vectorSearch("documents", "by_embedding", {
          vector: queryEmbedding,
          limit,
          filter: catalogKey ? (q) => q.eq("tool", catalogKey) : undefined,
        });

        if (searchResults && searchResults.length > 0) {
          const docs = await ctx.runQuery(internal.rag.fetchDocsByIds, {
            ids: searchResults.map((r) => r._id as Id<"documents">),
          });
          localHits = docs.map((doc, idx) => ({
            title: doc.title,
            content: doc.content,
            tool: doc.tool,
            score: searchResults[idx]?._score ?? 0,
            url: doc.url,
            source: (doc.source ?? "seed") as DocumentSource,
            topic: doc.topic,
          }));
        }
      } catch (err) {
        console.error("hybridSearch: fallo en vector local", err);
      }
    }

    const top1 = localHits[0]?.score ?? 0;
    const strongHits = localHits.filter((h) => h.score >= LOW_MIN_HIT_SCORE).length;
    const lowCoverage = top1 < LOW_TOP1_THRESHOLD || strongHits < LOW_MIN_HIT_COUNT;

    const shouldGoWeb = args.forceWeb === true || skipLocal || lowCoverage;
    if (!shouldGoWeb) return localHits;

    const webQuery = skipLocal
      ? `${enrichedQuery} official documentation`.trim()
      : enrichedQuery;

    let webHits: HybridSearchHit[] = [];
    try {
      const web = await tavilySearch({
        query: webQuery,
        maxResults: limit,
        searchDepth: "advanced",
      });
      if (web.results.length > 0) {
        webHits = await persistLiveWebHits(ctx, apiKey, toolKey, web.results, {
          persist: inCatalog,
        });
      }
    } catch (err) {
      console.warn("hybridSearch: fallback Tavily falló", err);
    }

    if (skipLocal) {
      return webHits.slice(0, Math.max(limit, 4));
    }

    const combined = [...localHits, ...webHits];
    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, Math.max(limit, 4));
  },
});

async function persistLiveWebHits(
  ctx: ActionCtx,
  apiKey: string,
  toolKey: string,
  results: TavilySearchResult[],
  options?: { persist?: boolean }
): Promise<HybridSearchHit[]> {
  const persist = options?.persist !== false;
  const out: HybridSearchHit[] = [];
  for (const r of results) {
    const text = r.content?.trim();
    if (!text) continue;
    try {
      const chunks = splitIntoChunks(text);
      const firstChunk = chunks[0]?.content ?? text.slice(0, 2400);
      const hash = await sha256Hex(`live::${toolKey}::${r.url}::${firstChunk}`);
      const existing = await ctx.runQuery(internal.rag.findByHash, { hash });
      const embedding = await generateEmbedding(`${r.title}. ${firstChunk}`, apiKey);
      const quality = extractQualitySignals(firstChunk, { tavilyScore: r.score });

      if (persist && !existing) {
        await ctx.runMutation(internal.rag.saveDoc, {
          tool: toolKey,
          title: r.title,
          content: firstChunk,
          embedding,
          url: r.url,
          source: "tavily-live" as const,
          quality: Object.keys(quality).length > 0 ? quality : undefined,
          hash,
        });
      }

      out.push({
        title: r.title,
        content: firstChunk,
        tool: toolKey,
        score: r.score ?? 0.55,
        url: r.url,
        source: "tavily-live",
      });
    } catch (err) {
      console.warn("persistLiveWebHits fallo puntual:", err);
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// Wrappers públicos (action) para exponer via HTTP / dashboard
// -------------------------------------------------------------------------

export const runIngestApp = action({
  args: {
    app: v.string(),
    topics: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<IngestAppResult> => {
    await requireAuthUserId(ctx);
    const entry = getAppEntry(args.app);
    if (!entry) {
      throw new ConvexError(`App "${args.app}" no está en el catálogo.`);
    }
    return await ctx.runAction(internal.rag.ingestApp, {
      app: entry.key,
      topics: args.topics,
      triggeredBy: "manual",
    });
  },
});

export const runHybridSearch = action({
  args: {
    query: v.string(),
    app: v.optional(v.string()),
    forceWeb: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<HybridSearchHit[]> => {
    await requireAuthUserId(ctx);
    return await ctx.runAction(internal.rag.hybridSearch, {
      query: args.query,
      app: args.app,
      forceWeb: args.forceWeb,
      limit: args.limit,
    });
  },
});

/**
 * Iterador que corre `ingestApp` sobre todas las apps del catálogo.
 * Se invoca desde el cron para el refresco periódico.
 */
export const ingestAllApps = internalAction({
  args: {},
  handler: async (ctx): Promise<IngestAppResult[]> => {
    const results: IngestAppResult[] = [];
    for (const key of Object.keys(APP_CATALOG)) {
      try {
        const res: IngestAppResult = await ctx.runAction(internal.rag.ingestApp, {
          app: key,
          triggeredBy: "cron",
        });
        results.push(res);
      } catch (err) {
        console.error(`ingestAllApps: fallo en ${key}`, err);
      }
    }
    return results;
  },
});
