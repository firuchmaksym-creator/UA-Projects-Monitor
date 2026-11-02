import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { monitorProjectsTable } from "./projects";
import { z } from "zod/v4";

export const providerChecksTable = pgTable(
  "monitor_provider_checks",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("project_id", { length: 64 })
      .notNull()
      .references(() => monitorProjectsTable.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms").notNull().default(0),
    success: boolean("success").notNull().default(false),
    status: varchar("status", { length: 16 }).notNull().default("UNKNOWN"),
    online: integer("online"),
    source: text("source"),
    error: text("error"),
  },
  (table) => [index("monitor_provider_checks_time_idx").on(table.checkedAt)],
);

export const insertProviderCheckSchema = createInsertSchema(providerChecksTable).omit({
  id: true,
  checkedAt: true,
});
export type InsertProviderCheck = z.infer<typeof insertProviderCheckSchema>;
export type ProviderCheck = typeof providerChecksTable.$inferSelect;
