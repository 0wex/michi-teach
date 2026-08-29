import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

function corsResponse(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function errorStatusFromMessage(message: string): number {
  if (message === "No autenticado") return 401;
  if (message === "No tienes acceso a esta conversación") return 403;
  if (message === "Conversación no encontrada") return 404;
  return 500;
}

function getErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === "string") return data;
  }
  if (err instanceof Error) return err.message;
  return "Error interno del servidor";
}

function handleConvexError(err: unknown) {
  const message = getErrorMessage(err);
  const status = errorStatusFromMessage(message);
  return corsResponse({ success: false, error: message }, status);
}

async function requireHttpAuth(ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return corsResponse({ success: false, error: "No autenticado" }, 401);
  }
  return null;
}

const handleOptions = httpAction(async () => corsResponse(null, 204));

http.route({
  path: "/api/health",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => {
    return corsResponse({
      status: "ok",
      timestamp: Date.now(),
      version: "1.0.0",
      service: "Michi Teach Convex Backend",
    });
  }),
});

http.route({
  path: "/api/conversations",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/conversations",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const conversations = await ctx.runQuery(api.conversations.list, {});
      return corsResponse(conversations);
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

http.route({
  path: "/api/conversations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const payload = await request.json();
      const title = payload.title ?? "Nueva Conversación";
      const conversationId = await ctx.runMutation(api.conversations.create, { title });
      return corsResponse({ _id: conversationId, title, createdAt: Date.now() }, 201);
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

http.route({
  path: "/api/chat",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const payload = await request.json();
      if (!payload.conversationId || !payload.content) {
        return corsResponse(
          { success: false, error: "Se requieren 'conversationId' y 'content'." },
          400
        );
      }

      const result = await ctx.runAction(api.messages.sendAndReply, {
        conversationId: payload.conversationId,
        content: payload.content,
        imageBase64: payload.imageBase64,
        app: typeof payload.app === "string" ? payload.app : undefined,
      });

      return corsResponse({
        success: true,
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
        content: result.content,
        detectedTool: result.detectedTool,
        visualHighlight: result.visualHighlight,
        annotations: result.annotations,
      });
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

http.route({
  path: "/api/analyze",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/analyze",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const payload = await request.json();
      if (!payload.imageBase64 || !payload.question) {
        return corsResponse(
          { success: false, error: "Se requieren 'imageBase64' y 'question'." },
          400
        );
      }

      let convId = payload.conversationId;
      if (!convId) {
        convId = await ctx.runMutation(api.conversations.create, {
          title: "Análisis Visual Rápido",
        });
      }

      const result = await ctx.runAction(api.messages.sendAndReply, {
        conversationId: convId,
        content: payload.question,
        imageBase64: payload.imageBase64,
        app: typeof payload.app === "string" ? payload.app : undefined,
      });

      return corsResponse({
        success: true,
        explanation: result.content,
        visualHighlight: result.visualHighlight,
        annotations: result.annotations,
        detectedTool: result.detectedTool,
        conversationId: convId,
      });
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

// -----------------------------------------------------------------------------
// RAG endpoints
// -----------------------------------------------------------------------------

http.route({
  path: "/api/rag/ingest",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/rag/ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const payload = await request.json().catch(() => ({}));
      if (!payload || typeof payload.app !== "string") {
        return corsResponse(
          { success: false, error: "Se requiere el campo 'app' (string)." },
          400
        );
      }
      const topics = Array.isArray(payload.topics)
        ? payload.topics.filter((t: unknown): t is string => typeof t === "string")
        : undefined;
      const result = await ctx.runAction(internal.rag.ingestApp, {
        app: payload.app,
        topics,
        triggeredBy: "manual",
      });
      return corsResponse({ success: true, result });
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

http.route({
  path: "/api/rag/search",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/rag/search",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const payload = await request.json().catch(() => ({}));
      if (!payload || typeof payload.query !== "string") {
        return corsResponse(
          { success: false, error: "Se requiere el campo 'query' (string)." },
          400
        );
      }
      const hits = await ctx.runAction(internal.rag.hybridSearch, {
        query: payload.query,
        app: typeof payload.app === "string" ? payload.app : undefined,
        forceWeb: payload.forceWeb === true,
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
      });
      return corsResponse({ success: true, hits });
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

// -----------------------------------------------------------------------------
// Progress endpoints
// -----------------------------------------------------------------------------

http.route({
  path: "/api/progress",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/progress",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const url = new URL(request.url);
      const app = url.searchParams.get("app");
      if (app) {
        const record = await ctx.runQuery(api.progress.getProgress, { app });
        return corsResponse({ success: true, progress: record });
      }
      const all = await ctx.runQuery(api.progress.listAppsWithProgress, {});
      return corsResponse({ success: true, progress: all });
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

http.route({
  path: "/api/progress",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = await requireHttpAuth(ctx);
    if (authError) return authError;
    try {
      const payload = await request.json().catch(() => ({}));
      if (!payload || typeof payload.app !== "string") {
        return corsResponse(
          { success: false, error: "Se requiere el campo 'app' (string)." },
          400
        );
      }
      const action: string = typeof payload.action === "string" ? payload.action : "upsert";

      if (action === "completeTopic") {
        if (typeof payload.topic !== "string") {
          return corsResponse(
            { success: false, error: "completeTopic requiere 'topic' (string)." },
            400
          );
        }
        const record = await ctx.runMutation(api.progress.markTopicComplete, {
          app: payload.app,
          topic: payload.topic,
        });
        return corsResponse({ success: true, progress: record });
      }

      if (action === "addErrorNote") {
        if (typeof payload.note !== "string") {
          return corsResponse(
            { success: false, error: "addErrorNote requiere 'note' (string)." },
            400
          );
        }
        const record = await ctx.runMutation(api.progress.addErrorNote, {
          app: payload.app,
          note: payload.note,
          topic: typeof payload.topic === "string" ? payload.topic : undefined,
        });
        return corsResponse({ success: true, progress: record });
      }

      const detectedLevelInput = payload.detectedLevel;
      const detectedLevel =
        detectedLevelInput === "beginner" ||
        detectedLevelInput === "intermediate" ||
        detectedLevelInput === "advanced"
          ? detectedLevelInput
          : undefined;

      const record = await ctx.runMutation(api.progress.upsertProgress, {
        app: payload.app,
        currentTopic:
          typeof payload.currentTopic === "string" ? payload.currentTopic : undefined,
        currentStepIndex:
          typeof payload.currentStepIndex === "number" ? payload.currentStepIndex : undefined,
        detectedLevel,
      });
      return corsResponse({ success: true, progress: record });
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

export default http;
