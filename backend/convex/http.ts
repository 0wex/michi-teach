import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// 1. Integrar rutas oficiales de autenticación de Convex Auth (/api/auth/*)
auth.addHttpRoutes(http);

// Función auxiliar para respuestas CORS
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

// 2. Endpoint HTTP REST: GET /api/health
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

// 3. Endpoint HTTP REST: POST /api/conversations (Crear hilo vía REST)
http.route({
  path: "/api/conversations",
  method: "OPTIONS",
  handler: httpAction(async () => corsResponse(null, 204)),
});

http.route({
  path: "/api/conversations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await request.json();
      const conversationId = await ctx.runMutation(api.conversations.create, {
        title: payload.title ?? "Nueva Conversación",
      });
      return corsResponse({ success: true, conversationId }, 201);
    } catch (err: any) {
      return corsResponse({ success: false, error: err?.message ?? "Error interno" }, 500);
    }
  }),
});

// 4. Endpoint HTTP REST: POST /api/chat (Enviar mensaje y recibir respuesta IA vía REST)
http.route({
  path: "/api/chat",
  method: "OPTIONS",
  handler: httpAction(async () => corsResponse(null, 204)),
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

      return corsResponse({ success: true, ...result });
    } catch (err: any) {
      return corsResponse({ success: false, error: err?.message ?? "Error interno" }, 500);
    }
  }),
});

export default http;
