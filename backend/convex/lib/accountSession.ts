import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";

export async function findAccountBySessionToken(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string | undefined,
): Promise<Doc<"accounts"> | null> {
  if (!sessionToken) return null;
  return await ctx.db
    .query("accounts")
    .withIndex("by_sessionToken", (q) => q.eq("sessionToken", sessionToken))
    .unique();
}
