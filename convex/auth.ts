import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const login = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (_ctx, { email }) => ({ ok: true, email }),
});

export const register = mutation({
  args: { name: v.string(), email: v.string(), password: v.string() },
  handler: async (_ctx, { name, email }) => ({ ok: true, name, email }),
});
