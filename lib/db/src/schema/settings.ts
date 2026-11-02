import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const monitorSettingsTable = pgTable("monitor_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertMonitorSettingSchema = createInsertSchema(monitorSettingsTable).omit({
  updatedAt: true,
});
export type InsertMonitorSetting = z.infer<typeof insertMonitorSettingSchema>;
export type MonitorSetting = typeof monitorSettingsTable.$inferSelect;
