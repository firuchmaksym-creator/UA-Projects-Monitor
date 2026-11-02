import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { monitorProjectsTable } from "./projects";
import { z } from "zod/v4";

export const measurementsTable = pgTable(
  "monitor_measurements",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("project_id", { length: 64 })
      .notNull()
      .references(() => monitorProjectsTable.id, { onDelete: "cascade" }),
    online: integer("online").notNull(),
    source: text("source").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("monitor_measurements_project_time_idx").on(table.projectId, table.measuredAt)],
);

export const insertMeasurementSchema = createInsertSchema(measurementsTable).omit({
  id: true,
  measuredAt: true,
});
export type InsertMeasurement = z.infer<typeof insertMeasurementSchema>;
export type Measurement = typeof measurementsTable.$inferSelect;
