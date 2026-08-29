import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  conversations: defineTable({
    userId: v.optional(v.id("users")),
    title: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_createdAt", ["createdAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    detectedTool: v.optional(v.string()),
    screenshotUrl: v.optional(v.string()),
    screenshotStorageId: v.optional(v.id("_storage")),
    visualHighlight: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
        label: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId"]),

  documents: defineTable({
    tool: v.string(),
    title: v.string(),
    content: v.string(),
    embedding: v.array(v.float64()),
    url: v.optional(v.string()),
    topic: v.optional(v.string()),
    source: v.optional(
      v.union(
        v.literal("official-docs"),
        v.literal("official-forum"),
        v.literal("tavily-live"),
        v.literal("seed")
      )
    ),
    version: v.optional(v.string()),
    ingestedAt: v.optional(v.number()),
    chunkIndex: v.optional(v.number()),
    chunkTotal: v.optional(v.number()),
    quality: v.optional(
      v.object({
        acceptedAnswer: v.optional(v.boolean()),
        voteScore: v.optional(v.number()),
        tavilyScore: v.optional(v.number()),
      })
    ),
    hash: v.optional(v.string()),
  })
    .index("by_tool", ["tool"])
    .index("by_tool_title", ["tool", "title"])
    .index("by_url", ["url"])
    .index("by_hash", ["hash"])
    .index("by_tool_topic", ["tool", "topic"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["tool", "source"],
    }),

  learningProgress: defineTable({
    userId: v.id("users"),
    app: v.string(),
    currentTopic: v.optional(v.string()),
    currentStepIndex: v.optional(v.number()),
    completedTopics: v.array(v.string()),
    detectedLevel: v.optional(
      v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced"))
    ),
    errorNotes: v.array(
      v.object({
        note: v.string(),
        topic: v.optional(v.string()),
        createdAt: v.number(),
      })
    ),
    lastInteractionAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_user_app", ["userId", "app"])
    .index("by_user", ["userId"]),

  ingestionRuns: defineTable({
    app: v.string(),
    topic: v.optional(v.string()),
    triggeredBy: v.union(v.literal("cron"), v.literal("manual"), v.literal("fallback")),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("partial"),
      v.literal("failed")
    ),
    urlsDiscovered: v.number(),
    chunksInserted: v.number(),
    chunksSkipped: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_app", ["app"])
    .index("by_startedAt", ["startedAt"]),
});
