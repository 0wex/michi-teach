import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { findAccountBySessionToken } from "./lib/accountSession";

// Listar conversaciones de la cuenta con sesión activa
export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const account = await findAccountBySessionToken(ctx, sessionToken);
    if (!account) {
      return [];
    }

    return await ctx.db
      .query("conversations")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .order("desc")
      .collect();
  },
});

// Obtener una conversación por su ID
export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

// Crear una nueva conversación ligada a la cuenta
export const create = mutation({
  args: {
    title: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const account = await findAccountBySessionToken(ctx, args.sessionToken);
    if (!account) {
      throw new ConvexError("Necesitas iniciar sesión para crear una conversación.");
    }

    return await ctx.db.insert("conversations", {
      accountId: account._id,
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
