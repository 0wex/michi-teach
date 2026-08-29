import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("messages").order("desc").take(50),
});

export const send = mutation({
  args: { body: v.string() },
  handler: async (ctx, { body }) => ctx.db.insert("messages", { body }),
});
