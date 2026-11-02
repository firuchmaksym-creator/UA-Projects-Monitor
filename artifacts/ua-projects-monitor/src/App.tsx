import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown, Clock3, Command, Database, History, LoaderCircle, LogOut, RefreshCw, Settings2, ShieldCheck, Signal, Trophy, Users, Wifi, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  getGetAdminStatusQueryKey, getGetLeaderboardQueryKey, getGetMeasurementHistoryQueryKey, getGetMonitorOverviewQueryKey, getGetStatisticsQueryKey, getHealthCheckQueryKey,
  useGetAdminStatus, useGetLeaderboard, useGetMeasurementHistory, useGetMonitorOverview, useGetStatistics, useHealthCheck,
  useRunManualCollection, useUpdateMonitorSettings, useUpdateProjectConfig,
} from '@workspace/api-client-react';
import type { GetMeasurementHistoryParams, GetStatisticsParams, Measurement, ProjectId, ProjectSummary, Range, StatisticsSeries } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const projectColors: Record<string, string> = { 'verba-online': '#a98cff', 'ua-online': '#5cc9de', 'ukraine-gta': '#ed79b3', 'trident-mobile': '#e6c468' };
const navItems = [
  { href: '/', label: 'Overview', icon: Activity },
  { href: '/statistics', label: 'Statistics', icon: BarChart3 },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/history', label: 'History', icon: History },
];
const rangeOptions: { value: Range; label: string }[] = [
  { value: '1h', label: '1 hour' }, { value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: 'all', label: 'All time' },
];

function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
function formatCount(value: number | null | undefined) { return value == null ? 'UNKNOWN' : value.toLocaleString('en-US'); }
function formatDate(value?: string | null, compact = false) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', compact ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function StatusBadge({ status }: { status: string }) {
  const state = status.toLowerCase();
  const styles = state === 'online' ? 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20' : state === 'offline' ? 'text-rose-300 bg-rose-400/10 border-rose-400/20' : 'text-amber-200 bg-amber-300/10 border-amber-300/20';
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[.12em] ${styles}`}><i className={`h-1.5 w-1.5 rounded-full ${state === 'online' ? 'bg-emerald-300' : state === 'offline' ? 'bg-rose-300' : 'bg-amber-200'}`} />{status}</span>;
}
function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`panel rounded-2xl ${className}`}>{children}</section>; }
function PageTitle({ kicker, title, description, right }: { kicker: string; title: string; description: string; right?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow mb-3">{kicker}</p><h1 className="text-3xl font-semibold tracking-[-.04em] text-slate-100 sm:text-[40px]">{title}</h1><p className="mt-2 max-w-xl text-sm text-slate-400">{description}</p></div>{right}</div>;
}
function LoadingPanel() { return <div className="grid gap-4 md:grid-cols-2"><div className="panel h-48 animate-pulse rounded-2xl bg-white/[.025]" /><div className="panel h-48 animate-pulse rounded-2xl bg-white/[.025]" /></div>; }
function ErrorPanel({ message = 'Could not reach the monitor service.', onRetry }: { message?: string; onRetry: () => void }) {
  return <div className="panel flex flex-col items-start gap-3 rounded-2xl p-7"><span className="eyebrow text-rose-300">Connection interrupted</span><p className="text-sm text-slate-300">{message}</p><button onClick={onRetry} className="button-secondary"><RefreshCw size={14} /> Retry connection</button></div>;
}
function EmptyPanel({ title, text }: { title: string; text: string }) { return <div className="panel rounded-2xl px-6 py-14 text-center"><div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full border border-slate-600/40 bg-white/[.03] text-slate-400"><Signal size={18} /></div><h3 className="font-semibold text-slate-200">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{text}</p></div>; }

function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60_000 } });
  const ready = health.data?.status?.toLowerCase() === 'ok' || health.data?.status?.toLowerCase() === 'healthy';
  return <div className="min-h-[100dvh] text-slate-100">
    <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[410px] opacity-70"><div className="monitor-grid absolute inset-0" /></div>
    <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#111321]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-[1440px] items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3" data-testid="link-brand"><div className="grid h-9 w-9 place-items-center rounded-xl border border-violet-300/30 bg-violet-400/10 text-violet-200"><Command size={18} /></div><div><div className="text-[13px] font-bold tracking-[.12em] text-slate-100">UA PROJECTS</div><div className="font-mono-ui text-[9px] tracking-[.18em] text-violet-300">LIVE MONITOR</div></div></Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors ${location === href ? 'bg-white/[.07] text-white' : 'text-slate-400 hover:bg-white/[.04] hover:text-slate-200'}`}><Icon size={15} />{label}</Link>)}<Link href="/admin" data-testid="link-nav-admin" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors ${location === '/admin' ? 'bg-white/[.07] text-white' : 'text-slate-400 hover:bg-white/[.04] hover:text-slate-200'}`}><Settings2 size={15} />Admin</Link></nav>
        <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-white/[.08] bg-white/[.025] px-3 py-1.5 sm:flex"><i className={`h-1.5 w-1.5 rounded-full ${ready ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.6)]' : 'bg-amber-300'}`} /><span className="font-mono-ui text-[10px] tracking-wide text-slate-400">{ready ? 'SYSTEM LIVE' : health.isLoading ? 'CHECKING' : 'HEALTH UNKNOWN'}</span></div>
          <Show when="signed-out"><Link href="/sign-in" className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-violet-300/40 hover:text-white" data-testid="link-sign-in">Admin sign in</Link></Show>
          <Show when="signed-in"><div className="hidden text-right sm:block"><div className="text-xs font-semibold text-slate-200">{user?.firstName || user?.primaryEmailAddress?.emailAddress}</div><div className="text-[10px] text-slate-500">Monitor administrator</div></div><button className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-400 hover:text-white" aria-label="Sign out" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={15} /></button></Show>
          <button onClick={() => setMobileOpen(!mobileOpen)} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-300 md:hidden" aria-label="Toggle navigation">{mobileOpen ? <X size={17} /> : <ChevronDown size={17} />}</button></div>
      </div>
      {mobileOpen && <nav className="grid grid-cols-2 gap-2 border-t border-white/[.06] px-4 py-3 md:hidden">{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${location === href ? 'bg-violet-400/10 text-violet-200' : 'text-slate-400'}`}><Icon size={15} />{label}</Link>)}<Link href="/admin" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400"><Settings2 size={15} />Admin</Link></nav>}
    </header>
    <main className="relative z-10 mx-auto min-h-[calc(100dvh-130px)] max-w-[1440px] px-4 pb-16 pt-8 sm:px-8 sm:pt-11">{children}</main>
    <footer className="relative z-10 border-t border-white/[.06]"><div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-2 px-4 py-5 text-[11px] text-slate-500 sm:flex-row sm:px-8"><span>UA PROJECTS MONITOR <span className="text-slate-700">/</span> Live measurements, no estimates.</span><span className="font-mono-ui tracking-wide">LIVE CHECKS · UA REGION</span></div></footer>
  </div>;
}

function ProjectCard({ project, index, series }: { project: ProjectSummary; index: number; series?: StatisticsSeries }) {
  const miniData = series?.points.map((point) => ({ online: point.online })) ?? [];
  return <Link href={`/projects/${project.id}`} data-testid={`card-project-${project.id}`} className="panel group scanline fade-up relative rounded-2xl p-5 transition duration-300 hover:-translate-y-1 hover:border-violet-300/25 sm:p-6" style={{ animationDelay: `${index * 70}ms` }}>
    <div className="relative z-10 flex items-start justify-between"><div><div className="eyebrow mb-2">{project.id.replaceAll('-', ' ')}</div><h2 className="text-lg font-semibold tracking-tight text-slate-100">{project.project}</h2></div><StatusBadge status={project.status} /></div>
    <div className="relative z-10 mt-7 flex items-end justify-between"><div><div className="eyebrow mb-2">Players online</div><div className={`mono text-4xl font-medium tracking-[-.06em] ${project.online == null ? 'text-amber-200/80 text-[26px] tracking-[.08em]' : 'text-slate-100'}`}>{formatCount(project.online)}</div></div><div className="text-right"><div className="eyebrow mb-2">Last checked</div><div className="font-mono-ui text-[11px] text-slate-400">{formatDate(project.checkedAt, true)}</div></div></div>
    <div className="relative z-10 mt-4 h-11" aria-label={`${project.project} recent online trend`}>
      {miniData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={miniData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}><Area type="monotone" dataKey="online" stroke={projectColors[project.id]} fill="none" strokeWidth={1.6} dot={miniData.length === 1 ? { r: 2 } : false} isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <div className="flex h-full items-center border-t border-dashed border-white/[.07] pt-2 font-mono-ui text-[9px] text-slate-600">NO CONFIRMED TREND</div>}
    </div>
    <div className="relative z-10 mt-3 border-t border-white/[.07] pt-3 text-[11px] text-slate-500"><div className="flex items-end justify-between gap-3"><div><div className="eyebrow mb-1">Historical maximum</div><div className="mono text-sm text-slate-200">{formatCount(project.historicalMax)}</div></div><div className="text-right">{project.status === 'UNKNOWN' ? <span>{project.source ? 'Source unavailable' : 'No source configured'}</span> : <span className="inline-flex items-center gap-1.5"><Wifi size={12} className="text-cyan-300" />Confirmed source</span>}<span className="mt-1 flex items-center justify-end gap-1 text-violet-300 opacity-75 group-hover:opacity-100">Details <ArrowRight size={13} /></span></div></div>{project.status === 'UNKNOWN' && project.error && <p className="mt-2 truncate text-[10px] text-rose-200/70" title={project.error}>{project.error}</p>}</div>
  </Link>;
}

function OverviewPage() {
  const query = useGetMonitorOverview({ query: { queryKey: getGetMonitorOverviewQueryKey(), refetchInterval: 30_000 } });
  const sparkParams = useMemo<GetStatisticsParams>(() => ({ range: '1h' }), []);
  const sparkQuery = useGetStatistics(sparkParams, { query: { queryKey: getGetStatisticsQueryKey(sparkParams), refetchInterval: 30_000 } });
  const summary = query.data?.summary;
  const change = summary?.changeSincePrevious;
  return <>
    <PageTitle kicker="PUBLIC MONITOR / LIVE SNAPSHOT" title="Ukrainian GTA, in real time." description="A transparent view of active players across four Ukrainian GTA projects. Counts are shown only when a source confirms them." right={<div className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 py-2 text-xs text-slate-400"><RefreshCw size={13} className="text-violet-300" /> Auto-refresh · {query.data?.refreshIntervalSeconds ?? '—'}s</div>} />
    {query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : summary ? <>
      <div className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="relative overflow-hidden p-5 sm:p-6"><div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-violet-400/[.08] blur-3xl" /><div className="eyebrow">Players online</div><div className="mt-3 flex items-end gap-3"><strong className="mono text-4xl font-medium tracking-[-.06em] text-white">{summary.knownProjects === 0 ? 'UNKNOWN' : summary.knownOnlineTotal.toLocaleString()}</strong><span className="mb-1 text-xs text-slate-500">{summary.knownProjects === 0 ? 'no confirmed counts' : summary.totalIsPartial ? 'partial total' : 'all sources reporting'}</span></div><div className="mt-4 flex items-center gap-2 text-xs">{change == null ? <span className="text-slate-500">Previous comparison unavailable</span> : <span className={change >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{change >= 0 ? <ArrowUpRight size={13} className="mr-1 inline" /> : <ArrowDownRight size={13} className="mr-1 inline" />}{Math.abs(change).toLocaleString()} since previous check</span>}</div></Card>
        <Metric label="Sources reporting" value={`${summary.availableProjects} / ${summary.totalProjects}`} note={`${summary.knownProjects} with known counts`} icon={<Signal size={16} />} color="text-cyan-300" />
        <Metric label="Current leader" value={summary.leaderProject || 'UNKNOWN'} note="Highest confirmed count" icon={<Trophy size={16} />} color="text-amber-200" small />
        <Metric label="Last checked" value={formatDate(summary.lastUpdatedAt, true)} note="Most recent source attempt" icon={<Clock3 size={16} />} color="text-violet-300" small />
      </div>
      <div className="mb-4 flex items-center justify-between"><div><p className="eyebrow">Project network</p><h2 className="mt-1 text-lg font-semibold text-slate-100">Live project status</h2></div><span className="font-mono-ui text-[10px] text-slate-500">04 PROJECT NODES</span></div>
      {(query.data?.projects || []).length === 0 ? <EmptyPanel title="No project measurements yet" text="The monitor has not received any project records." /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{(query.data?.projects || []).map((project, i) => <ProjectCard key={project.id} project={project} index={i} series={sparkQuery.data?.series.find(item => item.projectId === project.id)} />)}</div>}
      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-white/[.06] bg-white/[.018] px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span><span className="mr-2 text-amber-200">!</span>UNKNOWN means no verified count is available. We never substitute estimates or stale placeholders.</span><Link href="/statistics" className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white">Explore measurements <ArrowRight size={13} /></Link></div>
    </> : <EmptyPanel title="Monitor data unavailable" text="The service did not return a current overview." />}
  </>;
}
function Metric({ label, value, note, icon, color, small = false }: { label: string; value: string; note: string; icon: ReactNode; color: string; small?: boolean }) {
  return <Card className="p-5 sm:p-6"><div className="flex items-center justify-between"><div className="eyebrow">{label}</div><span className={color}>{icon}</span></div><div className={`mt-4 truncate font-semibold tracking-[-.04em] text-slate-100 ${small ? 'text-[19px]' : 'text-2xl'}`}>{value}</div><div className="mt-2 text-xs text-slate-500">{note}</div></Card>;
}

function RangeTabs({ value, onChange }: { value: Range; onChange: (value: Range) => void }) {
  return <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-white/[.08] bg-[#10121f] p-1">{rangeOptions.map(option => <button key={option.value} data-testid={`button-range-${option.value}`} onClick={() => onChange(option.value)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition ${value === option.value ? 'bg-violet-400/15 text-violet-200 shadow-inner shadow-violet-300/5' : 'text-slate-500 hover:text-slate-200'}`}>{option.label}</button>)}</div>;
}
function ChartTip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-white/10 bg-[#181a2b] px-3 py-2.5 shadow-xl"><div className="mb-1 font-mono-ui text-[10px] text-slate-500">{label}</div>{payload.map(item => <div key={item.name} className="flex items-center gap-2 text-xs text-slate-200"><i className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />{item.name}: <b className="mono">{item.value.toLocaleString()}</b></div>)}</div>;
}
function SeriesChart({ series, compact = false }: { series: StatisticsSeries; compact?: boolean }) {
  const data = series.points.map(point => ({ time: formatDate(point.measuredAt, true), online: point.online, measuredAt: point.measuredAt }));
  return <div className={compact ? 'h-[225px]' : 'h-[300px]'}>{data.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}><defs><linearGradient id={`fill-${series.projectId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={projectColors[series.projectId]} stopOpacity={.24} /><stop offset="95%" stopColor={projectColors[series.projectId]} stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(150,160,200,.1)" vertical={false} /><XAxis dataKey="time" tick={{ fill: '#707791', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} minTickGap={25} /><YAxis tick={{ fill: '#707791', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} width={48} /><Tooltip content={<ChartTip />} /><Area type="monotone" dataKey="online" name={series.project} stroke={projectColors[series.projectId]} strokeWidth={2} fill={`url(#fill-${series.projectId})`} activeDot={{ r: 4, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-slate-500">No successful measurements in this range.</div>}</div>;
}
function StatisticsPage() {
  const [range, setRange] = useState<Range>('24h');
  const params = useMemo<GetStatisticsParams>(() => ({ range }), [range]);
  const query = useGetStatistics(params, { query: { queryKey: getGetStatisticsQueryKey(params), refetchInterval: 30_000, refetchOnWindowFocus: false } });
  const series = query.data?.series || [];
  return <>
    <PageTitle kicker="MEASUREMENT ANALYTICS" title="Statistics" description="Compare confirmed player counts across time. Every line comes from recorded source measurements." right={<RangeTabs value={range} onChange={setRange} />} />
    {query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : <>
      <Card className="mb-5 p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow">Comparison / all projects</p><h2 className="mt-1 text-base font-semibold">Player activity · {rangeOptions.find(r => r.value === range)?.label}</h2></div><div className="flex flex-wrap gap-x-4 gap-y-2">{series.map(item => <span key={item.projectId} className="inline-flex items-center gap-2 text-[11px] text-slate-400"><i className="h-1.5 w-1.5 rounded-full" style={{ background: projectColors[item.projectId] }} />{item.project}</span>)}</div></div>
        {series.every(item => !item.points.length) ? <EmptyPanel title="No measurements for this period" text="Try a longer range or check again after the next successful source collection." /> : <CombinedChart series={series} />}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">{series.map(item => <Card key={item.projectId} className="p-5"><div className="mb-4 flex items-start justify-between"><div><p className="eyebrow">Project series</p><h3 className="mt-1 font-semibold">{item.project}</h3></div><StatusBadge status={item.status} /></div><SeriesChart series={item} compact /><div className="grid grid-cols-3 gap-2 border-t border-white/[.06] pt-4">{[['HIGH', item.highestOnline], ['LOW', item.lowestOnline], ['AVERAGE', item.averageOnline]].map(([label, value]) => <div key={String(label)}><div className="eyebrow text-[9px]">{label}</div><div className="mono mt-1 text-sm text-slate-200">{formatCount(value as number | null)}</div></div>)}</div></Card>)}</div>
      {series.length === 0 && <EmptyPanel title="No project series" text="There are no projects with measurements in the selected range." />}
    </>}
  </>;
}
function CombinedChart({ series }: { series: StatisticsSeries[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, Record<string, string | number>>();
    for (const line of series) for (const point of line.points) {
      const key = point.measuredAt; const row = map.get(key) || { time: formatDate(key, true), measuredAt: key };
      row[line.projectId] = point.online; map.set(key, row);
    }
    return [...map.values()].sort((a, b) => String(a.measuredAt).localeCompare(String(b.measuredAt)));
  }, [series]);
  return <div className="h-[320px]">{rows.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}><CartesianGrid stroke="rgba(150,160,200,.1)" vertical={false} /><XAxis dataKey="time" tick={{ fill: '#707791', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} minTickGap={32} /><YAxis tick={{ fill: '#707791', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} width={48} /><Tooltip content={<ChartTip />} />{series.map(item => <Line key={item.projectId} type="monotone" dataKey={item.projectId} name={item.project} stroke={projectColors[item.projectId]} strokeWidth={2} dot={false} connectNulls={false} activeDot={{ r: 4, strokeWidth: 0 }} />)}</LineChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-slate-500">No successful measurements in this range.</div>}</div>;
}

function LeaderboardPage() {
  const query = useGetLeaderboard({ query: { queryKey: getGetLeaderboardQueryKey(), refetchInterval: 30_000 } });
  return <>
    <PageTitle kicker="CURRENT RANKINGS" title="Leaderboard" description="Ranked by current confirmed player counts. Unknown projects are intentionally excluded." />
    {query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : query.data ? <>
      <Card className="overflow-hidden"><div className="flex flex-col justify-between gap-3 border-b border-white/[.07] px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div><div className="eyebrow">Live player count</div><div className="mt-1 text-sm text-slate-400">{query.data.entries.length} ranked · {query.data.unknownProjects} unknown</div></div><div className="font-mono-ui text-[10px] text-slate-500">UPDATED {formatDate(query.data.updatedAt, true)}</div></div>
        {query.data.entries.length ? <div className="divide-y divide-white/[.055]">{query.data.entries.map(entry => <Link href={`/projects/${entry.id}`} key={entry.id} className="group flex items-center gap-4 px-5 py-5 transition hover:bg-white/[.025] sm:px-6"><div className={`mono grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-sm ${entry.rank === 1 ? 'border-amber-300/25 bg-amber-300/10 text-amber-200' : 'border-white/[.08] bg-white/[.025] text-slate-400'}`}>{String(entry.rank).padStart(2, '0')}</div><div className="min-w-0 flex-1"><div className="truncate font-semibold text-slate-100">{entry.project}</div><div className="mt-1 font-mono-ui text-[10px] text-slate-500">CONFIRMED · {formatDate(entry.checkedAt, true)}</div></div><div className="text-right"><div className="mono text-2xl font-medium tracking-tight text-white">{entry.online.toLocaleString()}</div><div className="eyebrow mt-1">players</div></div><ArrowRight size={15} className="ml-2 text-slate-600 transition group-hover:translate-x-1 group-hover:text-violet-300" /></Link>)}</div> : <div className="p-6"><EmptyPanel title="No confirmed counts to rank" text="Leaderboard entries appear only when a project has a current known player count." /></div>}
      </Card><p className="mt-4 text-center text-[11px] text-slate-600">Ranking is based on current measurements only. No estimates or historical values are used.</p>
    </> : <EmptyPanel title="Leaderboard unavailable" text="No leaderboard data was returned." />}
  </>;
}

function MeasurementTable({ items, loading = false }: { items: Measurement[]; loading?: boolean }) {
  if (loading) return <div className="space-y-2 p-5">{[0, 1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[.035]" />)}</div>;
  if (!items.length) return <div className="p-5"><EmptyPanel title="No successful measurements yet" text="When a source returns a valid count, it will appear here with its measurement time." /></div>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left"><thead><tr className="border-b border-white/[.07] text-[10px] uppercase tracking-[.13em] text-slate-500"><th className="px-5 py-3 font-medium">Project</th><th className="px-5 py-3 font-medium">Players</th><th className="px-5 py-3 font-medium">Source</th><th className="px-5 py-3 font-medium">Measured at</th><th className="px-5 py-3 font-medium">Status</th></tr></thead><tbody className="divide-y divide-white/[.05]">{items.map(item => <tr key={item.id} className="transition hover:bg-white/[.02]"><td className="px-5 py-3.5"><Link href={`/projects/${item.projectId}`} className="font-medium text-slate-200 hover:text-violet-200">{item.projectId.replaceAll('-', ' ')}</Link></td><td className="mono px-5 py-3.5 text-slate-100">{item.online.toLocaleString()}</td><td className="px-5 py-3.5 text-xs text-slate-400">{item.source || 'UNKNOWN'}</td><td className="px-5 py-3.5 font-mono-ui text-[11px] text-slate-400">{formatDate(item.measuredAt, true)}</td><td className="px-5 py-3.5"><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div>;
}
function HistoryPage() {
  const [offset, setOffset] = useState(0); const limit = 25;
  const params = useMemo<GetMeasurementHistoryParams>(() => ({ limit, offset }), [offset]);
  const query = useGetMeasurementHistory(params, { query: { queryKey: getGetMeasurementHistoryQueryKey(params), refetchInterval: 30_000 } });
  return <>
    <PageTitle kicker="AUDIT TRAIL" title="Measurement history" description="Browse successful readings, with the originating source and exact collection time." />
    {query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4"><div><div className="eyebrow">Successful measurements</div><div className="mt-1 text-xs text-slate-500">{query.data?.total ?? '—'} records in archive</div></div><History size={16} className="text-violet-300" /></div><MeasurementTable items={query.data?.items || []} loading={query.isLoading} /><div className="flex items-center justify-between border-t border-white/[.07] px-5 py-3"><span className="font-mono-ui text-[10px] text-slate-500">{query.data?.total ? `${offset + 1}–${Math.min(offset + limit, query.data.total)} of ${query.data.total}` : '0 records'}</span><div className="flex gap-2"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="button-secondary disabled:opacity-30"><ArrowLeft size={13} /> Previous</button><button disabled={!query.data || offset + limit >= query.data.total} onClick={() => setOffset(offset + limit)} className="button-secondary disabled:opacity-30">Next <ArrowRight size={13} /></button></div></div></Card>}
  </>;
}

function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const safeId = (['verba-online', 'ua-online', 'ukraine-gta', 'trident-mobile'].includes(projectId || '') ? projectId : undefined) as ProjectId | undefined;
  const overview = useGetMonitorOverview({ query: { queryKey: getGetMonitorOverviewQueryKey(), refetchInterval: 30_000 } });
  const [range, setRange] = useState<Range>('7d');
  const statsParams = useMemo<GetStatisticsParams>(() => ({ range, projectId: safeId }), [range, safeId]);
  const historyParams = useMemo<GetMeasurementHistoryParams>(() => ({ projectId: safeId, limit: 30, offset: 0 }), [safeId]);
  const stats = useGetStatistics(statsParams, { query: { queryKey: getGetStatisticsQueryKey(statsParams), enabled: !!safeId, refetchInterval: 30_000 } });
  const history = useGetMeasurementHistory(historyParams, { query: { queryKey: getGetMeasurementHistoryQueryKey(historyParams), enabled: !!safeId, refetchInterval: 30_000 } });
  const project = overview.data?.projects.find(item => item.id === safeId);
  const series = stats.data?.series.find(item => item.projectId === safeId);
  if (!safeId) return <EmptyPanel title="Project not found" text="This project identifier is not part of the monitor." />;
  return <>
    <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"><ArrowLeft size={14} /> All projects</Link>
    {overview.isLoading ? <LoadingPanel /> : overview.isError ? <ErrorPanel onRetry={() => overview.refetch()} /> : project ? <>
      <PageTitle kicker={`PROJECT NODE / ${project.id.toUpperCase()}`} title={project.project} description={project.source ? `Verified data from ${project.source}.` : 'No verified source is currently available for this project.'} right={<StatusBadge status={project.status} />} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5"><div className="eyebrow">Current players</div><div className={`mono mt-3 text-3xl ${project.online == null ? 'text-[22px] tracking-[.08em] text-amber-200' : 'text-white'}`}>{formatCount(project.online)}</div><div className="mt-2 text-xs text-slate-500">Latest source check · {formatDate(project.checkedAt, true)}</div></Card>
        <Metric label="Historical maximum" value={formatCount(project.historicalMax)} note="Highest successful reading" icon={<Trophy size={16} />} color="text-amber-200" />
        <Metric label="24h / 7d peaks" value={`${formatCount(project.peak24h)} / ${formatCount(project.peak7d)}`} note="Player peak by window" icon={<BarChart3 size={16} />} color="text-cyan-300" small />
        <Metric label="Average players" value={formatCount(project.averageOnline)} note="Across successful measurements" icon={<Users size={16} />} color="text-violet-300" />
      </div>
      {project.error && <div className="mb-5 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4 text-xs text-amber-100/80"><span className="font-mono-ui mr-2 text-amber-200">SOURCE NOTE</span>{project.error}</div>}
      <Card className="mb-5 p-5 sm:p-6"><div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="eyebrow">History / {project.project}</p><h2 className="mt-1 text-base font-semibold">Confirmed player activity</h2></div><RangeTabs value={range} onChange={setRange} /></div>{stats.isLoading ? <div className="h-[300px] animate-pulse rounded-xl bg-white/[.03]" /> : stats.isError ? <ErrorPanel onRetry={() => stats.refetch()} /> : series ? <SeriesChart series={series} /> : <EmptyPanel title="No historical readings" text="This source has not produced successful counts for the selected period." />}</Card>
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4"><div><p className="eyebrow">Recent readings</p><h2 className="mt-1 font-semibold">Successful measurements</h2></div><Link href="/history" className="text-xs text-violet-300 hover:text-violet-200">Full archive <ArrowRight size={13} className="ml-1 inline" /></Link></div>{history.isError ? <div className="p-5"><ErrorPanel onRetry={() => history.refetch()} /></div> : <MeasurementTable items={history.data?.items || []} loading={history.isLoading} />}</Card>
    </> : <EmptyPanel title="Project data unavailable" text="The project does not have an overview record." />}
  </>;
}

function AdminPage() {
  return <><Show when="signed-in"><AdminContent /></Show><Show when="signed-out"><div className="mx-auto max-w-xl py-16"><Card className="relative overflow-hidden p-8 text-center sm:p-12"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-violet-300/20 bg-violet-300/[.08] text-violet-200"><ShieldCheck size={24} /></div><p className="eyebrow mt-6">Restricted console</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Administrator access</h1><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">Configure trusted sources and collection cadence. Sign in with your Clerk account to continue.</p><Link href="/sign-in" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-[#13111e] hover:bg-violet-300">Sign in to admin <ArrowRight size={15} /></Link></Card></div></Show></>;
}
function AdminContent() {
  const client = useQueryClient();
  const query = useGetAdminStatus({ query: { queryKey: getGetAdminStatusQueryKey(), refetchInterval: 30_000 } });
  const manual = useRunManualCollection();
  const settings = useUpdateMonitorSettings();
  const updateConfig = useUpdateProjectConfig();
  const [interval, setInterval] = useState('60');
  const [sources, setSources] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  useEffect(() => { if (query.data) setInterval(String(query.data.refreshIntervalSeconds)); }, [query.data?.refreshIntervalSeconds]);
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: getGetAdminStatusQueryKey() }),
    client.invalidateQueries({ queryKey: getGetMonitorOverviewQueryKey() }),
    client.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() }),
    client.invalidateQueries({ queryKey: getGetStatisticsQueryKey() }),
    client.invalidateQueries({ queryKey: getGetMeasurementHistoryQueryKey() }),
  ]);
  const doManual = () => manual.mutate(undefined, { onSuccess: async result => { setNotice(`Collection completed · ${result.results.length} project checks`); await refresh(); }, onError: () => setNotice('Collection failed. Review source health and retry.') });
  const saveInterval = (event: FormEvent) => { event.preventDefault(); const n = Number(interval); if (n < 30 || n > 600) { setNotice('Polling interval must be between 30 and 600 seconds.'); return; } settings.mutate({ data: { refreshIntervalSeconds: n } }, { onSuccess: async () => { setNotice('Polling interval saved.'); await refresh(); }, onError: () => setNotice('Could not update polling interval.') }); };
  const saveProject = (id: ProjectId, sourceUrl: string, enabled: boolean) => updateConfig.mutate({ projectId: id, data: { sourceUrl: sourceUrl.trim() || null, enabled } }, { onSuccess: async () => { setNotice('Project source configuration saved.'); await refresh(); }, onError: () => setNotice('Could not save project configuration.') });
  return <>
    <PageTitle kicker="SYSTEM CONTROL / AUTHORIZED" title="Admin console" description="Manage trusted source endpoints, collection cadence, and collector health." />
    {query.isLoading ? <LoadingPanel /> : query.isError ? <ErrorPanel message="Admin status could not be loaded. Your session may need to be refreshed." onRetry={() => query.refetch()} /> : query.data ? <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-4 p-5"><div className={`grid h-10 w-10 place-items-center rounded-xl ${query.data.database === 'healthy' ? 'bg-emerald-300/10 text-emerald-300' : 'bg-rose-300/10 text-rose-300'}`}><Database size={18} /></div><div><div className="eyebrow">Database</div><div className="mt-1 font-semibold capitalize">{query.data.database}</div></div></Card>
        <Card className="flex items-center gap-4 p-5"><div className={`grid h-10 w-10 place-items-center rounded-xl ${query.data.collectorRunning ? 'bg-cyan-300/10 text-cyan-300' : 'bg-slate-300/10 text-slate-400'}`}><Activity size={18} /></div><div><div className="eyebrow">Collector</div><div className="mt-1 font-semibold">{query.data.collectorRunning ? 'Running' : 'Stopped'}</div></div></Card>
        <Card className="flex items-center justify-between gap-4 p-5"><div><div className="eyebrow">Manual collection</div><div className="mt-1 text-xs text-slate-500">Run a source check now</div></div><button disabled={manual.isPending} onClick={doManual} className="button-primary">{manual.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <RefreshCw size={15} />} Collect</button></Card>
      </div>
      {notice && <div role="status" className="mb-5 flex items-center justify-between rounded-xl border border-violet-300/15 bg-violet-300/[.05] px-4 py-3 text-xs text-violet-100"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14} /></button></div>}
      <div className="grid gap-5 xl:grid-cols-[.78fr_1.22fr]">
        <div className="space-y-5"><Card className="p-5 sm:p-6"><div className="mb-4 flex items-center gap-2"><Clock3 size={15} className="text-violet-300" /><h2 className="font-semibold">Polling interval</h2></div><p className="mb-4 text-xs leading-5 text-slate-500">How often the monitor refreshes project source measurements. Allowed range: 30–600 seconds.</p><form onSubmit={saveInterval} className="flex gap-2"><input type="number" min="30" max="600" value={interval} onChange={e => setInterval(e.target.value)} className="field-control mono w-full" aria-label="Polling interval in seconds" data-testid="input-polling-interval" /><button disabled={settings.isPending} className="button-secondary" type="submit">{settings.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} />} Save</button></form><div className="mt-2 font-mono-ui text-[10px] text-slate-600">CURRENT · {query.data.refreshIntervalSeconds}s</div></Card>
          <Card className="p-5 sm:p-6"><div className="mb-4 flex items-center gap-2"><Database size={15} className="text-cyan-300" /><h2 className="font-semibold">Database status</h2></div><div className="flex items-center justify-between border-t border-white/[.06] pt-4 text-xs"><span className="text-slate-400">Connection health</span><StatusBadge status={query.data.database === 'healthy' ? 'ONLINE' : 'OFFLINE'} /></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-400">Project sources configured</span><span className="mono text-slate-200">{query.data.projects.length}</span></div></Card></div>
        <Card className="overflow-hidden"><div className="border-b border-white/[.07] px-5 py-4"><p className="eyebrow">Trusted source registry</p><h2 className="mt-1 font-semibold">Project configurations</h2></div><div className="divide-y divide-white/[.06]">{query.data.projects.map(project => <ProjectConfigRow key={project.id} project={project} sourceValue={sources[project.id] ?? project.sourceUrl ?? ''} setSource={value => setSources(current => ({ ...current, [project.id]: value }))} saving={updateConfig.isPending} onSave={source => saveProject(project.id, source, project.enabled)} onToggle={enabled => saveProject(project.id, sources[project.id] ?? project.sourceUrl ?? '', enabled)} />)}</div></Card>
      </div>
      <Card className="mt-5 overflow-hidden"><div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4"><div><p className="eyebrow">Recent source checks</p><h2 className="mt-1 font-semibold">Collector activity</h2></div><span className="font-mono-ui text-[10px] text-slate-500">{query.data.recentChecks.length} recent</span></div>{query.data.recentChecks.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead><tr className="border-b border-white/[.06] text-[10px] uppercase tracking-widest text-slate-500"><th className="px-5 py-3">Project</th><th className="px-5 py-3">Result</th><th className="px-5 py-3">Count</th><th className="px-5 py-3">Duration</th><th className="px-5 py-3">Checked</th></tr></thead><tbody className="divide-y divide-white/[.05]">{query.data.recentChecks.map(check => <tr key={check.id}><td className="px-5 py-3 text-sm text-slate-300">{check.projectId.replaceAll('-', ' ')}</td><td className="px-5 py-3"><StatusBadge status={check.success ? check.status : 'UNKNOWN'} /></td><td className="mono px-5 py-3 text-sm">{formatCount(check.online)}</td><td className="mono px-5 py-3 text-xs text-slate-400">{check.durationMs} ms</td><td className="px-5 py-3 font-mono-ui text-[11px] text-slate-400">{formatDate(check.checkedAt, true)}{check.error && <div className="mt-1 max-w-[240px] truncate text-[10px] text-rose-300/70">{check.error}</div>}</td></tr>)}</tbody></table></div> : <div className="p-6"><EmptyPanel title="No collector checks yet" text="Recent source checks will be listed here after collection runs." /></div>}</Card>
    </> : <EmptyPanel title="Admin status unavailable" text="No configuration data was returned." />}
  </>;
}
function ProjectConfigRow({ project, sourceValue, setSource, saving, onSave, onToggle }: { project: { id: ProjectId; project: string; parser: string; sourceUrl: string | null; enabled: boolean; status: string; online: number | null; lastCheckedAt: string | null; lastSuccessAt: string | null; consecutiveFailures: number; lastLatencyMs: number | null; error: string | null }; sourceValue: string; setSource: (value: string) => void; saving: boolean; onSave: (url: string) => void; onToggle: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(project.enabled);
  useEffect(() => setEnabled(project.enabled), [project.enabled]);
  return <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold text-slate-100">{project.project}</div><div className="mt-1 font-mono-ui text-[10px] text-slate-500">{project.parser} parser · {project.lastLatencyMs == null ? 'latency unknown' : `${project.lastLatencyMs}ms`}</div></div><div className="flex items-center gap-2"><StatusBadge status={project.status} /><label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); onToggle(e.target.checked); }} data-testid={`input-enabled-${project.id}`} />Enabled</label></div></div>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="url" value={sourceValue} onChange={e => setSource(e.target.value)} placeholder="https://source.example/status" aria-label={`${project.project} source URL`} className="field-control min-w-0 flex-1 text-xs" data-testid={`input-source-${project.id}`} /><button disabled={saving} onClick={() => onSave(sourceValue)} className="button-secondary shrink-0"><Check size={13} /> Save source</button></div>
    <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-slate-500"><span>Last check: {formatDate(project.lastCheckedAt, true)} · Last success: {formatDate(project.lastSuccessAt, true)}</span><span className={project.consecutiveFailures ? 'text-amber-200' : 'text-emerald-300/70'}>{project.consecutiveFailures} consecutive failures</span></div>{project.error && <div className="mt-2 truncate text-[10px] text-rose-300/70">{project.error}</div>}
  </div>;
}

function SignInPage() { return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>; }
function SignUpPage() { return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>; }
function AuthFrame({ children }: { children: ReactNode }) { return <div className="monitor-grid flex min-h-[100dvh] items-center justify-center bg-[#111321] px-4 py-10"><div className="w-full">{children}</div></div>; }
const clerkAppearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#a98cff', colorForeground: '#e4e6f0', colorMutedForeground: '#8b91ad', colorDanger: '#f07979', colorBackground: '#191b2b', colorInput: '#111321', colorInputForeground: '#e4e6f0', colorNeutral: '#41445c', fontFamily: 'Space Grotesk, sans-serif', borderRadius: '0.8rem' },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#191b2b] rounded-2xl w-[440px] max-w-full overflow-hidden border border-white/10 shadow-2xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-slate-100 font-semibold', headerSubtitle: 'text-slate-400', socialButtonsBlockButtonText: 'text-slate-200',
    formFieldLabel: 'text-slate-300', footerActionLink: 'text-violet-300', footerActionText: 'text-slate-400', dividerText: 'text-slate-500',
    identityPreviewEditButton: 'text-violet-300', formFieldSuccessText: 'text-emerald-300', alertText: 'text-rose-200',
    logoBox: 'rounded-xl', logoImage: 'rounded-md', socialButtonsBlockButton: 'border border-white/10 bg-white/[.03] hover:bg-white/[.07]',
    formButtonPrimary: 'bg-violet-400 text-[#161322] hover:bg-violet-300', formFieldInput: 'bg-[#111321] border border-white/10 text-slate-100',
    footerAction: 'text-slate-400', dividerLine: 'bg-white/10', alert: 'border-rose-300/20 bg-rose-300/5', otpCodeFieldInput: 'bg-[#111321] border-white/10 text-white',
    formFieldRow: 'text-slate-300', main: 'text-slate-200',
  },
};
function Routes() {
  const [, setLocation] = useLocation();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${base}/sign-in`} signUpUrl={`${base}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to manage the monitor.' } }, signUp: { start: { title: 'Create your account', subtitle: 'Access the UA Projects control room.' } } }} routerPush={(to: string) => setLocation(stripBase(to))} routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}>
    <Switch>
      <Route path="/" component={() => <Shell><OverviewPage /></Shell>} />
      <Route path="/statistics" component={() => <Shell><StatisticsPage /></Shell>} />
      <Route path="/leaderboard" component={() => <Shell><LeaderboardPage /></Shell>} />
      <Route path="/history" component={() => <Shell><HistoryPage /></Shell>} />
      <Route path="/projects/:projectId" component={() => <Shell><ProjectPage /></Shell>} />
      <Route path="/admin" component={() => <Shell><AdminPage /></Shell>} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  </ClerkProvider>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><Routes /></WouterRouter></QueryClientProvider>;
}
export default App;
