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
  })
    .index("by_tool", ["tool"])
    .index("by_tool_title", ["tool", "title"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["tool"],
    }),
});
