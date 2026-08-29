/**
 * Módulo de progreso de aprendizaje por usuario y app.
 *
 * Todas las operaciones requieren usuario autenticado (`requireAuthUserId`)
 * y trabajan sobre la tabla `learningProgress` (índice `by_user_app`).
 */

import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireAuthUserId } from "./lib/authorization";
import { getAppEntry, normalizeAppKey } from "./lib/appCatalog";
import { Doc, Id } from "./_generated/dataModel";

async function findRecord(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  app: string
): Promise<Doc<"learningProgress"> | null> {
  return await ctx.db
    .query("learningProgress")
    .withIndex("by_user_app", (q) => q.eq("userId", userId).eq("app", app))
    .unique();
}

function resolveAppKey(app: string): string {
  const entry = getAppEntry(app);
  return entry?.key ?? normalizeAppKey(app);
}

export const getProgress = query({
  args: { app: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const appKey = resolveAppKey(args.app);
    const record = await findRecord(ctx, userId, appKey);
    return record ?? null;
  },
});

export const listAppsWithProgress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    return await ctx.db
      .query("learningProgress")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const upsertProgress = mutation({
  args: {
    app: v.string(),
    currentTopic: v.optional(v.string()),
    currentStepIndex: v.optional(v.number()),
    detectedLevel: v.optional(
      v.union(
        v.literal("beginner"),
        v.literal("intermediate"),
        v.literal("advanced")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const appKey = resolveAppKey(args.app);
    const now = Date.now();

    const existing = await findRecord(ctx, userId, appKey);
    if (!existing) {
      const id = await ctx.db.insert("learningProgress", {
        userId,
        app: appKey,
        currentTopic: args.currentTopic,
        currentStepIndex: args.currentStepIndex,
        completedTopics: [],
        detectedLevel: args.detectedLevel,
        errorNotes: [],
        lastInteractionAt: now,
        createdAt: now,
      });
      return await ctx.db.get(id);
    }

    const patch: Partial<Doc<"learningProgress">> = { lastInteractionAt: now };
    if (args.currentTopic !== undefined) patch.currentTopic = args.currentTopic;
    if (args.currentStepIndex !== undefined) patch.currentStepIndex = args.currentStepIndex;
    if (args.detectedLevel !== undefined) patch.detectedLevel = args.detectedLevel;
    await ctx.db.patch(existing._id, patch);
    return await ctx.db.get(existing._id);
  },
});

export const markTopicComplete = mutation({
  args: {
    app: v.string(),
    topic: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const appKey = resolveAppKey(args.app);
    const now = Date.now();

    const existing = await findRecord(ctx, userId, appKey);
    if (!existing) {
      const id = await ctx.db.insert("learningProgress", {
        userId,
        app: appKey,
        completedTopics: [args.topic],
        errorNotes: [],
        lastInteractionAt: now,
        createdAt: now,
      });
      return await ctx.db.get(id);
    }

    const set = new Set(existing.completedTopics ?? []);
    set.add(args.topic);
    await ctx.db.patch(existing._id, {
      completedTopics: Array.from(set),
      currentTopic:
        existing.currentTopic === args.topic ? undefined : existing.currentTopic,
      currentStepIndex:
        existing.currentTopic === args.topic ? undefined : existing.currentStepIndex,
      lastInteractionAt: now,
    });
    return await ctx.db.get(existing._id);
  },
});

export const addErrorNote = mutation({
  args: {
    app: v.string(),
    note: v.string(),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const appKey = resolveAppKey(args.app);
    const now = Date.now();
    const noteEntry = { note: args.note, topic: args.topic, createdAt: now };

    const existing = await findRecord(ctx, userId, appKey);
    if (!existing) {
      const id = await ctx.db.insert("learningProgress", {
        userId,
        app: appKey,
        completedTopics: [],
        errorNotes: [noteEntry],
        lastInteractionAt: now,
        createdAt: now,
      });
      return await ctx.db.get(id);
    }

    const trimmed = [...(existing.errorNotes ?? []), noteEntry].slice(-50);
    await ctx.db.patch(existing._id, {
      errorNotes: trimmed,
      lastInteractionAt: now,
    });
    return await ctx.db.get(existing._id);
  },
});
