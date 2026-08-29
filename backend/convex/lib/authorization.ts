import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "../_generated/dataModel";
import { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

export async function requireAuthUserId(ctx: DbCtx | ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("No autenticado");
  }
  return userId;
}

export async function requireConversationAccess(
  ctx: DbCtx,
  conversationId: Id<"conversations">
) {
  const userId = await requireAuthUserId(ctx);
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new ConvexError("Conversación no encontrada");
  }
  if (!conversation.userId || conversation.userId !== userId) {
    throw new ConvexError("No tienes acceso a esta conversación");
  }
  return conversation;
}
