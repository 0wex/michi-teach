import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Listar conversaciones del usuario autenticado (o las más recientes si es invitado)
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);

    if (userId) {
      return await ctx.db
        .query("conversations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("conversations")
      .withIndex("by_createdAt")
      .order("desc")
      .take(20);
  },
});

// Obtener una conversación por su ID
export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

// Crear una nueva conversación
export const create = mutation({
  args: {
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    return await ctx.db.insert("conversations", {
      userId: userId ?? undefined,
      title: args.title,
      createdAt: Date.now(),
    });
  },
});

// Eliminar una conversación y sus mensajes asociados
export const remove = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.delete(args.conversationId);
  },
});
