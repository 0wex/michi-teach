import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// 1. Integrar rutas oficiales de autenticación de Convex Auth (/api/auth/*)
auth.addHttpRoutes(http);

// Función auxiliar para respuestas JSON con CORS
function corsResponse(body: any, status = 200) {
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

// Handler genérico de pre-flight OPTIONS
const handleOptions = httpAction(async () => corsResponse(null, 204));

// ---------------------------------------------------------------------------
// 2. GET /api/health
// ---------------------------------------------------------------------------
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
      service: "Vision Guide Convex Backend",
    });
  }),
});

// ---------------------------------------------------------------------------
// 3. /api/conversations (GET y POST)
// ---------------------------------------------------------------------------
http.route({
  path: "/api/conversations",
  method: "OPTIONS",
  handler: handleOptions,
});

// GET /api/conversations: Listar hilos de conversación
http.route({
  path: "/api/conversations",
  method: "GET",
  handler: httpAction(async (ctx) => {
    try {
      const conversations = await ctx.runQuery(api.conversations.list, {});
      return corsResponse(conversations);
    } catch (err: any) {
      return corsResponse({ success: false, error: err?.message ?? "Error al listar conversaciones" }, 500);
    }
  }),
});

// POST /api/conversations: Crear un nuevo hilo
http.route({
  path: "/api/conversations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await request.json();
      const title = payload.title ?? "Nueva Conversación";
      const conversationId = await ctx.runMutation(api.conversations.create, {
        title,
      });

      return corsResponse(
        {
          _id: conversationId,
          title,
          createdAt: Date.now(),
        },
        201
      );
    } catch (err: any) {
      return corsResponse({ success: false, error: err?.message ?? "Error al crear conversación" }, 500);
    }
  }),
});

// ---------------------------------------------------------------------------
// 4. POST /api/chat: Enviar mensaje al chat con IA y coordenadas
// ---------------------------------------------------------------------------
http.route({
  path: "/api/chat",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
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
        visualHighlight: result.visualHighlight,
      });
    } catch (err: any) {
      return corsResponse({ success: false, error: err?.message ?? "Error interno del servidor" }, 500);
    }
  }),
});

// ---------------------------------------------------------------------------
// 5. POST /api/analyze: Análisis visual directo de captura de pantalla
// ---------------------------------------------------------------------------
http.route({
  path: "/api/analyze",
  method: "OPTIONS",
  handler: handleOptions,
});

http.route({
  path: "/api/analyze",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await request.json();
      if (!payload.imageBase64 || !payload.question) {
        return corsResponse(
          { success: false, error: "Se requieren 'imageBase64' y 'question'." },
          400
        );
      }

      // Si no viene conversationId, crear uno temporal para la sesión de análisis
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
        conversationId: convId,
      });
    } catch (err: any) {
      return corsResponse({ success: false, error: err?.message ?? "Error al analizar imagen" }, 500);
    }
  }),
});

export default http;
