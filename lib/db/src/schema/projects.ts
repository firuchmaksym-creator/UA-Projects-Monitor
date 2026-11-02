import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const monitorProjectsTable = pgTable("monitor_projects", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  sourceUrl: text("source_url"),
  parser: varchar("parser", { length: 48 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertMonitorProjectSchema = createInsertSchema(monitorProjectsTable).omit({
  updatedAt: true,
});
export type InsertMonitorProject = z.infer<typeof insertMonitorProjectSchema>;
export type MonitorProject = typeof monitorProjectsTable.$inferSelect;
