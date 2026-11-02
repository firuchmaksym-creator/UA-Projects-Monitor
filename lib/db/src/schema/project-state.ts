import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { monitorProjectsTable } from "./projects";
import { z } from "zod/v4";

export const projectStateTable = pgTable("monitor_project_state", {
  projectId: varchar("project_id", { length: 64 })
    .primaryKey()
    .references(() => monitorProjectsTable.id, { onDelete: "cascade" }),
  online: integer("online"),
  status: varchar("status", { length: 16 }).notNull().default("UNKNOWN"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  source: text("source"),
  error: text("error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastLatencyMs: integer("last_latency_ms"),
});

export const insertProjectStateSchema = createInsertSchema(projectStateTable);
export type InsertProjectState = z.infer<typeof insertProjectStateSchema>;
export type ProjectState = typeof projectStateTable.$inferSelect;
