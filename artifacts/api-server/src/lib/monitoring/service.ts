import {
  and,
  asc,
  avg,
  count,
  desc,
  eq,
  gte,
  max,
  min,
  sql,
} from "drizzle-orm";
import {
  db,
  measurementsTable,
  monitorProjectsTable,
  monitorSettingsTable,
  pool,
  projectStateTable,
  providerChecksTable,
} from "@workspace/db";
import { logger } from "../logger";
import { collectProject, defaultProjects, type ProjectId, type ProviderResult } from "./providers";

const REFRESH_KEY = "refreshIntervalSeconds";
const DEFAULT_REFRESH_SECONDS = 30;
const ADVISORY_LOCK_ID = 482_610_217;

export class CollectionBusyError extends Error {
  constructor() {
    super("A collection cycle is already running.");
    this.name = "CollectionBusyError";
  }
}

let collectorStarted = false;
let collectorRunning = false;
let collectorTimer: NodeJS.Timeout | undefined;
let activeCollection: Promise<CollectionResult> | null = null;

export interface CollectionResult {
  startedAt: string;
  completedAt: string;
  results: Array<{
    id: number;
    projectId: ProjectId;
    checkedAt: string;
    durationMs: number;
    success: boolean;
    status: "ONLINE" | "OFFLINE" | "UNKNOWN";
    online: number | null;
    source: string | null;
    error: string | null;
  }>;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function normalizeAverage(value: string | number | null): number | null {
  if (value === null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? Math.round(result * 10) / 10 : null;
}

export async function ensureMonitorSeedData(): Promise<void> {
  await db
    .insert(monitorProjectsTable)
    .values(defaultProjects)
    .onConflictDoNothing();

  await db
    .insert(projectStateTable)
    .values(defaultProjects.map(({ id }) => ({ projectId: id, status: "UNKNOWN" })))
    .onConflictDoNothing();

  await db
    .insert(monitorSettingsTable)
    .values({ key: REFRESH_KEY, value: String(DEFAULT_REFRESH_SECONDS) })
    .onConflictDoNothing();
}

export async function getRefreshInterval(): Promise<number> {
  const [setting] = await db
    .select({ value: monitorSettingsTable.value })
    .from(monitorSettingsTable)
    .where(eq(monitorSettingsTable.key, REFRESH_KEY))
    .limit(1);
  const parsed = Number(setting?.value);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 600) {
    return DEFAULT_REFRESH_SECONDS;
  }
  return parsed;
}

async function saveProviderResult(result: ProviderResult) {
  return db.transaction(async (tx) => {
    const [check] = await tx
      .insert(providerChecksTable)
      .values({
        projectId: result.projectId,
        checkedAt: result.checkedAt,
        durationMs: result.durationMs,
        success: result.online !== null,
        status: result.status,
        online: result.online,
        source: result.source,
        error: result.error,
      })
      .returning();

    await tx
      .insert(projectStateTable)
      .values({
        projectId: result.projectId,
        online: result.online,
        status: result.status,
        checkedAt: result.checkedAt,
        lastSuccessAt: result.online === null ? null : result.checkedAt,
        source: result.source,
        error: result.error,
        consecutiveFailures: result.online === null ? 1 : 0,
        lastLatencyMs: result.durationMs,
      })
      .onConflictDoUpdate({
        target: projectStateTable.projectId,
        set: {
          online: result.online,
          status: result.status,
          checkedAt: result.checkedAt,
          ...(result.online === null ? {} : { lastSuccessAt: result.checkedAt }),
          source: result.source,
          error: result.error,
          consecutiveFailures:
            result.online === null
              ? sql`${projectStateTable.consecutiveFailures} + 1`
              : 0,
          lastLatencyMs: result.durationMs,
        },
      });

    if (result.online !== null && result.source) {
      await tx.insert(measurementsTable).values({
        projectId: result.projectId,
        online: result.online,
        source: result.source,
        status: result.status,
        measuredAt: result.checkedAt,
      });
    }
    return check;
  });
}

async function performCollection(): Promise<CollectionResult> {
  const startedAt = new Date();
  const lockClient = await pool.connect();
  let hasLock = false;

  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_ID],
    );
    hasLock = lockResult.rows[0]?.locked === true;
    if (!hasLock) throw new CollectionBusyError();

    collectorRunning = true;
    await ensureMonitorSeedData();
    const configs = await db.select().from(monitorProjectsTable).orderBy(asc(monitorProjectsTable.id));
    const providerResults = await Promise.all(
      configs.map((config) =>
        collectProject({
          id: config.id as ProjectId,
          name: config.name,
          sourceUrl: config.sourceUrl,
          parser: config.parser,
          enabled: config.enabled,
        }),
      ),
    );

    const checks = await Promise.all(
      providerResults.map(async (result) => {
        try {
          return await saveProviderResult(result);
        } catch (error) {
          logger.error(
            { err: error, projectId: result.projectId },
            "Could not persist project provider result",
          );
          throw error;
        }
      }),
    );

    const completedAt = new Date();
    logger.info(
      {
        projects: providerResults.length,
        successful: providerResults.filter((result) => result.online !== null).length,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
      "Central monitor collection completed",
    );

    return {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      results: checks.map((check) => ({
        id: check.id,
        projectId: check.projectId as ProjectId,
        checkedAt: check.checkedAt.toISOString(),
        durationMs: check.durationMs,
        success: check.success,
        status: check.status as "ONLINE" | "OFFLINE" | "UNKNOWN",
        online: check.online,
        source: check.source,
        error: check.error,
      })),
    };
  } finally {
    collectorRunning = false;
    if (hasLock) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
      } catch (error) {
        logger.error({ err: error }, "Could not release monitor collection lock");
      }
    }
    lockClient.release();
  }
}

export async function runCollection(): Promise<CollectionResult> {
  if (activeCollection) throw new CollectionBusyError();
  const current = performCollection();
  activeCollection = current;
  try {
    return await current;
  } finally {
    if (activeCollection === current) activeCollection = null;
  }
}

async function scheduleNext(): Promise<void> {
  if (!collectorStarted) return;
  if (collectorTimer) clearTimeout(collectorTimer);
  const interval = await getRefreshInterval().catch((error: unknown) => {
    logger.error({ err: error }, "Could not read monitor interval; using default");
    return DEFAULT_REFRESH_SECONDS;
  });
  collectorTimer = setTimeout(async () => {
    try {
      await runCollection();
    } catch (error) {
      if (!(error instanceof CollectionBusyError)) {
        logger.error({ err: error }, "Automatic monitor collection failed");
      }
    } finally {
      void scheduleNext();
    }
  }, interval * 1000);
}

export function startMonitorWorker(): void {
  if (collectorStarted) return;
  collectorStarted = true;
  void (async () => {
    try {
      await ensureMonitorSeedData();
      await runCollection();
    } catch (error) {
      logger.error({ err: error }, "Initial monitor setup or collection failed");
    } finally {
      await scheduleNext();
    }
  })();
}

export async function rescheduleMonitorWorker(): Promise<void> {
  if (collectorTimer) clearTimeout(collectorTimer);
  if (collectorStarted) await scheduleNext();
}

export async function getMonitorOverview() {
  await ensureMonitorSeedData();
  const rows = await db
    .select({ project: monitorProjectsTable, state: projectStateTable })
    .from(monitorProjectsTable)
    .leftJoin(projectStateTable, eq(monitorProjectsTable.id, projectStateTable.projectId))
    .orderBy(asc(monitorProjectsTable.id));

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const metrics = await db
    .select({
      projectId: measurementsTable.projectId,
      historicalMax: max(measurementsTable.online),
      averageOnline: avg(measurementsTable.online),
      peak24h: max(
        sql<number>`CASE WHEN ${measurementsTable.measuredAt} >= ${dayAgo} THEN ${measurementsTable.online} END`,
      ),
      peak7d: max(
        sql<number>`CASE WHEN ${measurementsTable.measuredAt} >= ${weekAgo} THEN ${measurementsTable.online} END`,
      ),
    })
    .from(measurementsTable)
    .groupBy(measurementsTable.projectId);
  const metricsByProject = new Map(metrics.map((row) => [row.projectId, row]));

  const projects = rows.map(({ project, state }) => {
    const stats = metricsByProject.get(project.id);
    return {
      id: project.id,
      project: project.name,
      online: state?.online ?? null,
      status: state?.status ?? "UNKNOWN",
      checkedAt: iso(state?.checkedAt),
      lastSuccessAt: iso(state?.lastSuccessAt),
      source: state?.source ?? null,
      error: state?.error ?? "Очікується перша перевірка джерела.",
      historicalMax: stats?.historicalMax ?? null,
      averageOnline: normalizeAverage(stats?.averageOnline ?? null),
      peak24h: stats?.peak24h ?? null,
      peak7d: stats?.peak7d ?? null,
    };
  });

  const known = rows.filter(
    ({ state }) =>
      state?.online !== null &&
      state?.online !== undefined &&
      state.status !== "UNKNOWN",
  );
  const knownOnlineTotal = known.reduce((total, row) => total + (row.state?.online ?? 0), 0);
  const leader = [...known].sort(
    (left, right) => (right.state?.online ?? 0) - (left.state?.online ?? 0),
  )[0];
  const latestStateDate = rows.reduce<Date | null>((latest, row) => {
    const checkedAt = row.state?.checkedAt;
    return checkedAt && (!latest || checkedAt > latest) ? checkedAt : latest;
  }, null);

  let changeSincePrevious: number | null = null;
  if (known.length > 0 && known.every((row) => row.state?.checkedAt)) {
    const previous = await Promise.all(
      known.map(async ({ project, state }) => {
        const [check] = await db
          .select({ online: providerChecksTable.online })
          .from(providerChecksTable)
          .where(
            and(
              eq(providerChecksTable.projectId, project.id),
              eq(providerChecksTable.success, true),
              sql`${providerChecksTable.checkedAt} < ${state!.checkedAt}`,
            ),
          )
          .orderBy(desc(providerChecksTable.checkedAt))
          .limit(1);
        return check?.online ?? null;
      }),
    );
    if (previous.every((value) => value !== null)) {
      changeSincePrevious =
        knownOnlineTotal - previous.reduce<number>((total, value) => total + (value ?? 0), 0);
    }
  }

  return {
    summary: {
      knownOnlineTotal,
      changeSincePrevious,
      availableProjects: rows.filter(({ state }) => state?.status === "ONLINE").length,
      totalProjects: rows.length,
      knownProjects: known.length,
      totalIsPartial: known.length < rows.length,
      leaderProjectId: (leader?.project.id ?? null) as ProjectId | null,
      leaderProject: leader?.project.name ?? null,
      lastUpdatedAt: iso(latestStateDate),
    },
    refreshIntervalSeconds: await getRefreshInterval(),
    projects,
  };
}

export async function getLeaderboard() {
  await ensureMonitorSeedData();
  const rows = await db
    .select({ project: monitorProjectsTable, state: projectStateTable })
    .from(monitorProjectsTable)
    .leftJoin(projectStateTable, eq(monitorProjectsTable.id, projectStateTable.projectId));
  const known = rows
    .filter(
      ({ state }) =>
        state?.online !== null &&
        state?.online !== undefined &&
        state.status !== "UNKNOWN" &&
        state.checkedAt,
    )
    .sort((left, right) => (right.state?.online ?? 0) - (left.state?.online ?? 0));
  const latest = rows.reduce<Date | null>((value, row) => {
    const checkedAt = row.state?.checkedAt;
    return checkedAt && (!value || checkedAt > value) ? checkedAt : value;
  }, null);
  return {
    entries: known.map(({ project, state }, index) => ({
      rank: index + 1,
      id: project.id,
      project: project.name,
      online: state!.online!,
      checkedAt: state!.checkedAt!.toISOString(),
    })),
    unknownProjects: rows.filter(({ state }) => state?.status === "UNKNOWN").length,
    updatedAt: iso(latest),
  };
}

const ranges = {
  "1h": { milliseconds: 60 * 60 * 1000, bucket: "1 minute" },
  "24h": { milliseconds: 24 * 60 * 60 * 1000, bucket: "15 minutes" },
  "7d": { milliseconds: 7 * 24 * 60 * 60 * 1000, bucket: "1 hour" },
  "30d": { milliseconds: 30 * 24 * 60 * 60 * 1000, bucket: "6 hours" },
  all: { milliseconds: null, bucket: "1 day" },
} as const;

export async function getStatistics(range: keyof typeof ranges, projectId?: ProjectId) {
  await ensureMonitorSeedData();
  const now = new Date();
  const rangeConfig = ranges[range];
  const from = rangeConfig.milliseconds === null ? null : new Date(now.getTime() - rangeConfig.milliseconds);
  const filters = [];
  if (from) filters.push(gte(measurementsTable.measuredAt, from));
  if (projectId) filters.push(eq(measurementsTable.projectId, projectId));
  const where = filters.length ? and(...filters) : undefined;
  const bucketedMeasurements = db
    .select({
      id: measurementsTable.id,
      projectId: measurementsTable.projectId,
      online: measurementsTable.online,
      source: measurementsTable.source,
      status: measurementsTable.status,
      measuredAt: sql<Date>`date_bin(${rangeConfig.bucket}::interval, ${measurementsTable.measuredAt}, TIMESTAMPTZ '2000-01-01 00:00:00+00')`.as("bucket_at"),
    })
    .from(measurementsTable)
    .where(where)
    .as("bucketed_measurements");

  const [points, aggregates, projects, states] = await Promise.all([
    db
      .select({
        id: min(bucketedMeasurements.id),
        projectId: bucketedMeasurements.projectId,
        online: sql<number>`round(avg(${bucketedMeasurements.online}))::int`,
        source: min(bucketedMeasurements.source),
        status: sql<string>`CASE WHEN bool_and(${bucketedMeasurements.status} = 'OFFLINE') THEN 'OFFLINE' ELSE 'ONLINE' END`,
        measuredAt: bucketedMeasurements.measuredAt,
      })
      .from(bucketedMeasurements)
      .groupBy(bucketedMeasurements.projectId, bucketedMeasurements.measuredAt)
      .orderBy(asc(bucketedMeasurements.measuredAt)),
    db
      .select({
        projectId: measurementsTable.projectId,
        highestOnline: max(measurementsTable.online),
        lowestOnline: min(measurementsTable.online),
        averageOnline: avg(measurementsTable.online),
      })
      .from(measurementsTable)
      .where(where)
      .groupBy(measurementsTable.projectId),
    db.select().from(monitorProjectsTable).orderBy(asc(monitorProjectsTable.id)),
    db.select().from(projectStateTable),
  ]);

  const aggregatesByProject = new Map(aggregates.map((row) => [row.projectId, row]));
  const stateByProject = new Map(states.map((row) => [row.projectId, row]));
  const selectedProjects = projectId
    ? projects.filter((project) => project.id === projectId)
    : projects;

  return {
    range,
    from: iso(from),
    to: now.toISOString(),
    series: selectedProjects.map((project) => {
      const stats = aggregatesByProject.get(project.id);
      const state = stateByProject.get(project.id);
      return {
        projectId: project.id,
        project: project.name,
        status: state?.status ?? "UNKNOWN",
        source: state?.source ?? null,
        points: points
          .filter((point) => point.projectId === project.id)
          .map((point) => ({
            id: Number(point.id ?? 0),
            projectId: project.id,
            online: Number(point.online),
            source: point.source ?? state?.source ?? "Verified source",
            status: point.status,
            measuredAt: toIsoTimestamp(point.measuredAt),
          })),
        highestOnline: stats?.highestOnline ?? null,
        lowestOnline: stats?.lowestOnline ?? null,
        averageOnline: normalizeAverage(stats?.averageOnline ?? null),
      };
    }),
  };
}

export async function getMeasurementHistory(
  projectId: ProjectId | undefined,
  limit: number,
  offset: number,
) {
  await ensureMonitorSeedData();
  const where = projectId ? eq(measurementsTable.projectId, projectId) : undefined;
  const [items, totals] = await Promise.all([
    db
      .select()
      .from(measurementsTable)
      .where(where)
      .orderBy(desc(measurementsTable.measuredAt), desc(measurementsTable.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(measurementsTable).where(where),
  ]);
  return {
    items: items.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      online: item.online,
      source: item.source,
      status: item.status,
      measuredAt: item.measuredAt.toISOString(),
    })),
    total: Number(totals[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function getAdminStatus() {
  await ensureMonitorSeedData();
  let database: "healthy" | "unavailable" = "healthy";
  try {
    await db.execute(sql`SELECT 1`);
  } catch (error) {
    database = "unavailable";
    logger.error({ err: error }, "Monitor database health check failed");
  }

  const [joined, checks] = await Promise.all([
    db
      .select({ project: monitorProjectsTable, state: projectStateTable })
      .from(monitorProjectsTable)
      .leftJoin(projectStateTable, eq(monitorProjectsTable.id, projectStateTable.projectId))
      .orderBy(asc(monitorProjectsTable.id)),
    db
      .select()
      .from(providerChecksTable)
      .orderBy(desc(providerChecksTable.checkedAt), desc(providerChecksTable.id))
      .limit(40),
  ]);

  return {
    database,
    refreshIntervalSeconds: await getRefreshInterval(),
    collectorRunning,
    projects: joined.map(({ project, state }) => ({
      id: project.id,
      project: project.name,
      sourceUrl: project.sourceUrl,
      enabled: project.enabled,
      parser: project.parser,
      lastCheckedAt: iso(state?.checkedAt),
      lastSuccessAt: iso(state?.lastSuccessAt),
      status: state?.status ?? "UNKNOWN",
      online: state?.online ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      lastLatencyMs: state?.lastLatencyMs ?? null,
      error: state?.error ?? "Очікується перша перевірка джерела.",
    })),
    recentChecks: checks.map((check) => ({
      id: check.id,
      projectId: check.projectId,
      checkedAt: check.checkedAt.toISOString(),
      durationMs: check.durationMs,
      success: check.success,
      status: check.status,
      online: check.online,
      source: check.source,
      error: check.error,
    })),
  };
}
