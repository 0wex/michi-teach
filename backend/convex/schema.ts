import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  // Tablas del sistema de autenticación de Convex Auth (users, authSessions, authAccounts, etc.)
  ...authTables,

  // Cuentas de la app de escritorio (email + contraseña con hash PBKDF2)
  accounts: defineTable({
    name: v.string(),
    email: v.string(), // siempre normalizado a minúsculas
    passwordHash: v.string(), // PBKDF2-SHA256, hex
    salt: v.string(), // 16 bytes en hex
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  // Hilos de conversación entre el usuario y el asistente
  conversations: defineTable({
    userId: v.optional(v.id("users")), // ID del usuario autenticado (o null para invitado)
    title: v.string(), // Título descriptivo de la conversación
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_createdAt", ["createdAt"]),

  // Mensajes dentro de un hilo de conversación
  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(), // Texto del mensaje

    // Metadatos visuales opcionales (para capturas de pantalla de cualquier software):
    screenshotUrl: v.optional(v.string()), // Imagen base64 o URL
    visualHighlight: v.optional(
      v.object({
        x: v.number(), // 0.0 a 1.0 (coordenada horizontal normalizada)
        y: v.number(), // 0.0 a 1.0 (coordenada vertical normalizada)
        label: v.optional(v.string()), // Nombre o etiqueta del elemento resaltado
      })
    ),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId"]),
});
