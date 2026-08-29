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
    detectedTool: v.optional(v.string()), // Software auto-detectado por la IA (ej. "DaVinci Resolve", "Blender")

    // Metadatos visuales opcionales:
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

  // Base de conocimiento técnica y vectorial para RAG
  documents: defineTable({
    tool: v.string(), // Identificador del software (ej. "davinci", "blender", "capcut", "photoshop", "premiere")
    title: v.string(), // Título del concepto o funcionalidad
    content: v.string(), // Explicación técnica, atajos y ubicación en la interfaz
    embedding: v.array(v.float64()), // Vector de 1536 dimensiones (OpenAI text-embedding-3-small)
  })
    .index("by_tool", ["tool"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["tool"],
    }),
});
