import {
  GetAdminStatusResponse,
  GetLeaderboardResponse,
  GetMeasurementHistoryQueryParams,
  GetMeasurementHistoryResponse,
  GetMonitorOverviewResponse,
  GetStatisticsQueryParams,
  GetStatisticsResponse,
  RunManualCollectionResponse,
  UpdateMonitorSettingsBody,
  UpdateMonitorSettingsResponse,
  UpdateProjectConfigBody,
  UpdateProjectConfigParams,
  UpdateProjectConfigResponse,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  monitorProjectsTable,
  monitorSettingsTable,
  projectStateTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  CollectionBusyError,
  getAdminStatus,
  getLeaderboard,
  getMeasurementHistory,
  getMonitorOverview,
  getRefreshInterval,
  getStatistics,
  rescheduleMonitorWorker,
  runCollection,
} from "../lib/monitoring/service";
import { validatePublicHttpsUrl, type ProjectId } from "../lib/monitoring/providers";

const router: IRouter = Router();

router.get("/monitor", async (_req, res): Promise<void> => {
  res.json(GetMonitorOverviewResponse.parse(await getMonitorOverview()));
});

router.get("/leaderboard", async (_req, res): Promise<void> => {
  res.json(GetLeaderboardResponse.parse(await getLeaderboard()));
});

router.get("/statistics", async (req, res): Promise<void> => {
  const parsed = GetStatisticsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    GetStatisticsResponse.parse(
      await getStatistics(
        parsed.data.range as "1h" | "24h" | "7d" | "30d" | "all",
        parsed.data.projectId as ProjectId | undefined,
      ),
    ),
  );
});

router.get("/history", async (req, res): Promise<void> => {
  const parsed = GetMeasurementHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    GetMeasurementHistoryResponse.parse(
      await getMeasurementHistory(
        parsed.data.projectId as ProjectId | undefined,
        parsed.data.limit,
        parsed.data.offset,
      ),
    ),
  );
});

router.use("/admin", requireAdmin);

router.get("/admin/status", async (_req, res): Promise<void> => {
  res.json(GetAdminStatusResponse.parse(await getAdminStatus()));
});

router.post("/admin/collect", async (_req, res): Promise<void> => {
  try {
    res.json(RunManualCollectionResponse.parse(await runCollection()));
  } catch (error) {
    if (error instanceof CollectionBusyError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.patch("/admin/settings", async (req, res): Promise<void> => {
  const parsed = UpdateMonitorSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .insert(monitorSettingsTable)
    .values({
      key: "refreshIntervalSeconds",
      value: String(parsed.data.refreshIntervalSeconds),
    })
    .onConflictDoUpdate({
      target: monitorSettingsTable.key,
      set: {
        value: String(parsed.data.refreshIntervalSeconds),
        updatedAt: new Date(),
      },
    });
  await rescheduleMonitorWorker();
  res.json(UpdateMonitorSettingsResponse.parse({ refreshIntervalSeconds: await getRefreshInterval() }));
});

router.patch("/admin/projects/:projectId", async (req, res): Promise<void> => {
  const params = UpdateProjectConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProjectConfigBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: parsed.success ? "Provide a setting to update." : parsed.error.message });
    return;
  }

  if (parsed.data.sourceUrl) {
    try {
      await validatePublicHttpsUrl(parsed.data.sourceUrl);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid source URL.",
      });
      return;
    }
  }

  const update: { sourceUrl?: string | null; enabled?: boolean; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (parsed.data.sourceUrl !== undefined) update.sourceUrl = parsed.data.sourceUrl;
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;

  const [project] = await db
    .update(monitorProjectsTable)
    .set(update)
    .where(eq(monitorProjectsTable.id, params.data.projectId))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  const [state] = await db
    .select()
    .from(projectStateTable)
    .where(and(eq(projectStateTable.projectId, project.id)))
    .limit(1);
  res.json(
    UpdateProjectConfigResponse.parse({
      id: project.id,
      project: project.name,
      sourceUrl: project.sourceUrl,
      enabled: project.enabled,
      parser: project.parser,
      lastCheckedAt: state?.checkedAt?.toISOString() ?? null,
      lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
      status: state?.status ?? "UNKNOWN",
      online: state?.online ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      lastLatencyMs: state?.lastLatencyMs ?? null,
      error: state?.error ?? "Очікується перша перевірка джерела.",
    }),
  );
});

export default router;
