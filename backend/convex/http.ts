import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
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
      });

      return corsResponse({
        success: true,
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
        content: result.content,
        detectedTool: result.detectedTool,
        visualHighlight: result.visualHighlight,
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
      });

      return corsResponse({
        success: true,
        explanation: result.content,
        visualHighlight: result.visualHighlight,
        detectedTool: result.detectedTool,
        conversationId: convId,
      });
    } catch (err) {
      return handleConvexError(err);
    }
  }),
});

export default http;
