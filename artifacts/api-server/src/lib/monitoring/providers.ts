import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ProjectId =
  | "verba-online"
  | "ua-online"
  | "ukraine-gta"
  | "trident-mobile";

export type ProjectStatus = "ONLINE" | "OFFLINE" | "UNKNOWN";

export interface ProviderConfig {
  id: ProjectId;
  name: string;
  sourceUrl: string | null;
  parser: string;
  enabled: boolean;
}

export interface ProviderResult {
  project: string;
  projectId: ProjectId;
  online: number | null;
  status: ProjectStatus;
  checkedAt: Date;
  source: string | null;
  error: string | null;
  durationMs: number;
}

export const defaultProjects: ProviderConfig[] = [
  {
    id: "verba-online",
    name: "VERBA ONLINE",
    sourceUrl: "https://verba.online/",
    parser: "official-html",
    enabled: true,
  },
  {
    id: "ua-online",
    name: "UA ONLINE",
    sourceUrl: null,
    parser: "json",
    enabled: true,
  },
  {
    id: "ukraine-gta",
    name: "UKRAINE GTA",
    sourceUrl: "https://ukraine-gta.com.ua/",
    parser: "official-html",
    enabled: true,
  },
  {
    id: "trident-mobile",
    name: "TRIDENT MOBILE",
    sourceUrl: null,
    parser: "json",
    enabled: true,
  },
];

const playerCountKeys = [
  "online",
  "onlineplayers",
  "online_players",
  "currentplayers",
  "current_players",
  "playersonline",
  "players_online",
  "activeplayers",
  "active_players",
  "playercount",
  "player_count",
];

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export async function validatePublicHttpsUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Вкажіть коректну адресу джерела.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local")
  ) {
    throw new Error("Джерело має бути публічною HTTPS-адресою без даних авторизації.");
  }

  const literalIp = isIP(url.hostname);
  if (literalIp && isPrivateAddress(url.hostname)) {
    throw new Error("Приватні та локальні адреси джерел заборонені.");
  }
  if (!literalIp) {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
      throw new Error("Джерело має вказувати лише на публічні IP-адреси.");
    }
  }
  return url;
}

function getJsonOnlineCount(value: unknown, depth = 0): number | null {
  if (depth > 4 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  for (const key of playerCountKeys) {
    const match = Object.keys(record).find((candidate) => candidate.toLowerCase() === key);
    if (match) {
      const candidate = record[match];
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0) {
        return candidate;
      }
    }
  }

  if (typeof record.players === "number" && Number.isInteger(record.players) && record.players >= 0) {
    return record.players;
  }
  for (const key of ["data", "result", "server", "stats", "statistics"]) {
    const nested = getJsonOnlineCount(record[key], depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function extractOnlineFromOfficialHtml(projectId: ProjectId, html: string): number | null {
  const plainText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/\s+/g, " ");
  const matches = [...plainText.matchAll(/\b(\d{1,5})\s*\/\s*(\d{2,5})\b/g)]
    .map((match) => ({ online: Number(match[1]), capacity: Number(match[2]) }))
    .filter(
      (pair) =>
        Number.isInteger(pair.online) &&
        Number.isInteger(pair.capacity) &&
        pair.capacity > 0 &&
        pair.capacity <= 2000 &&
        pair.online <= pair.capacity,
    );

  if (projectId === "verba-online" || projectId === "ukraine-gta") {
    // The official pages display one online/capacity pair per game server.
    // Requiring multiple rows avoids mistaking an unrelated page fraction for
    // player data.
    if (matches.length < 2) return null;
    return matches.reduce((total, pair) => total + pair.online, 0);
  }
  return null;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 400);
  return "Джерело не повернуло коректну відповідь.";
}

async function readOnce(config: ProviderConfig): Promise<{
  online: number;
  source: string;
}> {
  if (!config.sourceUrl) {
    throw new Error("Публічне джерело статистики ще не налаштоване.");
  }

  const url = await validatePublicHttpsUrl(config.sourceUrl);
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/html;q=0.9,*/*;q=0.5",
      "user-agent": "UA-Projects-Monitor/1.0",
    },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Офіційне джерело відповіло HTTP ${response.status}.`);
  }
  const body = await response.text();
  if (body.length > 2_000_000) {
    throw new Error("Відповідь джерела перевищує дозволений розмір.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") || config.parser === "json") {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error("Джерело не повернуло коректний JSON.");
    }
    const online = getJsonOnlineCount(json);
    if (online === null) {
      throw new Error("У відповіді API не знайдено числове поле онлайну.");
    }
    return { online, source: `JSON API · ${url.hostname}` };
  }

  const online = extractOnlineFromOfficialHtml(config.id, body);
  if (online === null) {
    throw new Error("На офіційній сторінці не знайдено перевірюваних лічильників серверів.");
  }
  return { online, source: `Офіційний сайт · ${url.hostname}` };
}

export async function collectConfiguredProject(config: ProviderConfig): Promise<ProviderResult> {
  const startedAt = Date.now();
  const checkedAt = new Date();
  if (!config.enabled) {
    return {
      project: config.name,
      projectId: config.id,
      online: null,
      status: "UNKNOWN",
      checkedAt,
      source: null,
      error: "Джерело вимкнене адміністратором.",
      durationMs: 0,
    };
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await readOnce(config);
      return {
        project: config.name,
        projectId: config.id,
        online: result.online,
        status: result.online > 0 ? "ONLINE" : "OFFLINE",
        checkedAt,
        source: result.source,
        error: null,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  return {
    project: config.name,
    projectId: config.id,
    online: null,
    status: "UNKNOWN",
    checkedAt,
    source: config.sourceUrl,
    error: safeErrorMessage(lastError),
    durationMs: Date.now() - startedAt,
  };
}

export async function collectProject(config: ProviderConfig): Promise<ProviderResult> {
  switch (config.id) {
    case "verba-online":
      return (await import("./providers/verba-online")).collectVerbaOnline(config);
    case "ua-online":
      return (await import("./providers/ua-online")).collectUaOnline(config);
    case "ukraine-gta":
      return (await import("./providers/ukraine-gta")).collectUkraineGta(config);
    case "trident-mobile":
      return (await import("./providers/trident-mobile")).collectTridentMobile(config);
  }
}
