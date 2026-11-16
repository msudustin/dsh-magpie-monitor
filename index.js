// Host half of @local/dsh-magpie-monitor.
//
// The Magpie gateway (default http://127.0.0.1:3425) does not send CORS
// headers, so the Web page cannot call it directly. This plugin reads the
// gateway on the Host and republishes it under the Harness origin:
//
//   GET /magpie-monitor/api/config            -> effective settings
//   GET /magpie-monitor/api/data?path=<key>   -> one raw upstream payload
//   GET /magpie-monitor/api/snapshot          -> merged, trimmed, cached view
//   GET /magpie-monitor/api/alert-sound       -> one of the system wavs (?tone=)
//   POST /magpie-monitor/api/alert-flash      -> blink the taskbar button
//
// The snapshot is the whole data source for both the sidebar widget and the
// `magpie_usage` agent tool, so the panel and the model read one implementation
// instead of two. Only fixed upstream paths are reachable and only a small set
// of query parameters are forwarded, so none of these routes is an open proxy.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  /** Base URL of the local Magpie gateway. */
  gatewayUrl: z.string().default('http://127.0.0.1:3425').volatile()
    .description('Magpie 网关根地址（不带 /v1），默认 http://127.0.0.1:3425'),
  /**
   * Discover the gateway address from Magpie's own `gateway.json` when the
   * configured URL does not answer. Magpie writes the live listen address
   * there (`{"addr":"127.0.0.1:3425","pid":...}`), so a user who moved the
   * port is found without touching the settings. 0 disables discovery.
   */
  discover: z.boolean().default(true).volatile()
    .description('网关连不上时自动从 Magpie 的 gateway.json 重新发现端口，默认 true'),
  /** Panel auto-refresh interval in milliseconds. */
  refreshMs: z.number().default(5000).volatile()
    .description('自动刷新间隔（毫秒），1000–120000，默认 5000'),
  /** How many recent requests the routing table asks for. */
  requestLimit: z.number().default(40).volatile()
    .description('实时路由表拉取的最近请求条数，5–200，默认 40'),
  /** Default statistics window for the panel and the tool. */
  period: z.string().default('today').volatile()
    .description('默认统计周期：today（按小时）/ 7d / 30d / all，默认 today'),
  /**
   * The ledger prices in USD. A positive cnyRate converts every cost for
   * display; 0 leaves the USD numbers alone. Quota balances are not touched —
   * those arrive as strings in each provider's own currency.
   */
  cnyRate: z.number().default(0).volatile()
    .description('成本折算汇率（1 USD = N CNY）；0 表示保留美元，默认 0'),
  /** Register the magpie_usage agent tool alongside the panel. */
  tool: z.boolean().default(true).volatile()
    .description('是否注册 magpie_usage 代理工具，默认 true'),
  /**
   * Magpie's own "Task done alert" (its prefs field is turnDoneAlert): ring when
   * a task that ran at least this long finishes. Seconds; 0 turns it off. The
   * panel offers Magpie's 1 / 3 / 10 minutes and accepts any other value.
   */
  turnDoneAlert: z.number().default(0).volatile()
    .description('任务完成提醒阈值（秒）：一次任务跑了至少这么久才提醒，0 关闭；与 Magpie 的 Task done alert 一致，默认 0'),
  /**
   * Which of the machine's own wavs the alert rings. Magpie rides the
   * Windows "Notification" event, whose stock sound is a 1.3 s chime that is
   * easy to miss; the panel keeps that one and defaults to the loudest
   * pattern Windows ships. Everything comes out of %SystemRoot%\media.
   */
  alertTone: z.string().default('alarm').volatile()
    .description('提醒音色：alarm（警报，默认）/ ring（铃声）/ bell（钟声）/ chime（系统通知音），都取自 Windows 自带 wav'),
  /** Blink the taskbar button when the alert rings, the way Magpie flashes. */
  alertFlash: z.boolean().default(true).volatile()
    .description('任务完成时闪烁 DSH 的任务栏按钮（Windows），默认 true'),
})

const CONFIG_ROUTE = '/magpie-monitor/api/config'
const DATA_ROUTE = '/magpie-monitor/api/data'
const SNAPSHOT_ROUTE = '/magpie-monitor/api/snapshot'
const ALERT_ROUTE = '/magpie-monitor/api/alert-sound'
const ALERT_FLASH_ROUTE = '/magpie-monitor/api/alert-flash'

const UPSTREAM = {
  root: '/',
  usage: '/v1/magpie/usage',
  requests: '/v1/magpie/usage/requests',
  quotas: '/v1/magpie/quotas',
  history: '/v1/magpie/quotas/history',
  statusline: '/v1/magpie/statusline',
  route: '/v1/magpie/route',
  trace: '/v1/magpie/trace',
  models: '/v1/models',
}

/**
 * Per-endpoint query rules. A flat allow-list would forward `period` to
 * `/v1/magpie/quotas` (which ignores it) and `limit` to `/v1/magpie/route`
 * (which wants `session`), so each endpoint declares what it accepts.
 * `required` names must be present or the request is refused locally.
 */
const QUERY_RULES = {
  root: { allowed: [] },
  usage: { allowed: ['period'] },
  requests: { allowed: ['limit', 'offset', 'period'] },
  quotas: { allowed: [] },
  history: { allowed: [] },
  statusline: { allowed: [] },
  route: { allowed: ['session'], required: ['session'] },
  trace: { allowed: ['session'], required: ['session'] },
  models: { allowed: [] },
}

// Kept for the /data route's own lookup and for the tests that pin the
// forwarded set: it is the union of every endpoint's allowed keys.
const PASS_QUERY = new Set(Object.values(QUERY_RULES).flatMap((rule) => rule.allowed))
const PERIODS = new Set(['today', '7d', '30d', 'all'])
const DEFAULT_GATEWAY = 'http://127.0.0.1:3425'

// Per-endpoint budgets. Quota reads ask every provider and one unreachable host
// can hold the whole call, so they get a longer leash than the ledger read.
const TIMEOUT_MS = 8000
const QUOTA_TIMEOUT_MS = 16000
const REQUESTS_TIMEOUT_MS = 12000
// Two reads of the gateway inside this window share one result (panel + tool +
// reload), so a manual refresh right after an auto tick does not double-fetch.
const CACHE_MS = 1500
const CACHE_MAX = 8

function clampNumber(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

// cordis resolves `.volatile()` config fields into `{ get(): T }` references
// (cosmokit createVolatile) so a running plugin can observe hot updates. Reading
// the field directly yields the reference object, not the value — every type
// guard below would fall back and silently drop the user's setting. Unwrap first.
function unwrap(value) {
  return value && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

function normalizeGateway(value) {
  try {
    const url = new URL(String(value || DEFAULT_GATEWAY))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Magpie keeps the address of its live gateway in `~/.config/magpie/gateway.json`
 * (`{"addr":"127.0.0.1:3425","pid":26544,"serves":"tray","version":"..."}`).
 * Reading it is the only reliable way to find the port when the user moved it:
 * `settings.json` holds UI preferences and has no address at all.
 *
 * Candidates are ordered: explicit env, the file, then the historical default.
 * Returns null when nothing usable is found so the caller can fall back.
 */
// gateway.json only changes when magpie restarts on another port, but the
// panel reads it several times a second during a refresh. A short memo keeps
// discovery honest without putting a synchronous disk read on the request
// path; a connection failure clears it so a moved port is still recovered on
// the next attempt.
const DISCOVERY_MS = 4000
let discoveredBases = null
let discoveredAt = 0

function invalidateDiscovery() {
  discoveredBases = null
  discoveredAt = 0
}

function discoverGatewayBases(now = Date.now()) {
  if (discoveredBases !== null && now - discoveredAt < DISCOVERY_MS) return discoveredBases.slice()
  const bases = []
  const push = (value) => {
    const origin = normalizeGateway(value)
    if (origin !== null && !bases.includes(origin)) bases.push(origin)
  }
  for (const env of [process.env.MAGPIE_URL, process.env.MAGPIE_BASE_URL]) push(env)
  try {
    const home = os.homedir()
    const file = path.join(home, '.config', 'magpie', 'gateway.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const addr = typeof raw?.addr === 'string' ? raw.addr : ''
    if (addr !== '') {
      // `addr` is a host:port pair; assume loopback because the gateway is local.
      push(/:\d+$/.test(addr) ? `http://${addr}` : `http://${addr}:3425`)
    }
  } catch {
    /* no gateway.json, unreadable, or malformed JSON: keep the other candidates */
  }
  push(DEFAULT_GATEWAY)
  discoveredBases = bases
  discoveredAt = now
  return bases.slice()
}

/**
 * Only same-machine requests may read the panel. A page on another origin
 * could otherwise piggy-back on the user's gateway; the Host header must be a
 * loopback literal, a cross-site fetch header is refused outright, and an
 * Origin (when present) must match the Host.
 */
function isTrustedRequest(req) {
  const headers = req?.headers ?? {}
  const host = String(headers.host ?? '').trim().toLowerCase()
  const hostname = host.replace(/:\d+$/, '')
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  if (!loopback) return 'unexpected host'
  if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 'cross-site request'
  const origin = str(headers.origin)
  if (origin !== undefined && origin !== 'null') {
    try {
      const originHost = new URL(origin).host.toLowerCase()
      if (originHost !== host) return 'origin mismatch'
    } catch {
      return 'bad origin'
    }
  }
  return null
}

/** Connection-phase failures mean "the gateway is not reachable", not "it said no". */
const CONNECTION_PHASE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET',
])

/** Marks an abort that came from the caller, so it is not blamed on the gateway. */
const CALLER_ABORTED = 'ERR_CALLER_ABORTED'

/**
 * Classify a failure into a stable, translatable shape. The client turns the
 * code into a sentence; the host never leaks a raw stack or URL to the UI.
 */
function classifyFailure(error) {
  if (error === null || error === undefined) return { code: 'unknown', message: 'unknown error' }
  const name = typeof error === 'object' && typeof error.name === 'string' ? error.name : ''
  const message = describe(error)
  // The caller went away (panel closed, tool cancelled): that is not a gateway
  // fault, so it must not be reported as one.
  if (typeof error === 'object' && error?.code === CALLER_ABORTED) return { code: 'aborted', message: '读取被中断' }
  if (name === 'AbortError' || name === 'TimeoutError' || /\btimed?\s*out\b|\btimeout\b/i.test(message)) {
    return { code: 'timeout', message: '网关响应超时' }
  }
  if (CONNECTION_PHASE_CODES.has(name) || /\bECONN[A-Z]+\b|\bENOTFOUND\b|\bEAI_AGAIN\b/i.test(message)) {
    return { code: 'connection', message: '连不上 Magpie 网关' }
  }
  const status = typeof error?.status === 'number' ? error.status : undefined
  if (status === 401) return { code: 'unauthorized', message: '网关拒绝：凭据无效' }
  if (status === 403) return { code: 'forbidden', message: '网关拒绝：权限或风控拦截' }
  if (status === 429) return { code: 'rate_limited', message: '网关限流，请稍后再试' }
  if (status !== undefined && status >= 500) return { code: 'server_error', message: `网关内部错误 HTTP ${status}` }
  if (status !== undefined && status >= 400) return { code: 'bad_request', message: `网关拒绝请求 HTTP ${status}` }
  return { code: 'unknown', message }
}

/** Trim to a finite number, or 0. Gateway counters are sometimes absent on old rows. */
function num(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Keep only non-empty strings; everything else becomes undefined. */
function str(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A timestamp the panel can parse whichever shape the gateway used. */
function stamp(value) {
  const text = str(value)
  if (text !== undefined) return text
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return new Date(n < 1e12 ? n * 1000 : n).toISOString()
}

/** Env override for the alert wav, for machines without the stock sound. */
const ALERT_SOUND_ENV = 'MAGPIE_MONITOR_ALERT_WAV'

/**
 * The wavs this panel may ring, best first per tone, all of them files
 * Windows ships. `chime` is what Magpie's toast actually plays — the
 * "Notification.Default" app event points at Windows Notify System Generic —
 * so it stays available, but the default is a longer alarm pattern because a
 * 1.3 s chime is easy to miss when you are looking at another window.
 */
const ALERT_TONES = {
  alarm: ['Alarm01.wav', 'Alarm02.wav', 'Alarm03.wav'],
  ring: ['Ring05.wav', 'Ring02.wav', 'Ring01.wav'],
  bell: ['Windows Notify Calendar.wav', 'Windows Notify Email.wav', 'Windows Foreground.wav'],
  chime: ['Windows Notify System Generic.wav', 'Windows Notify.wav', 'notify.wav'],
}
const ALERT_TONE_ORDER = ['alarm', 'ring', 'bell', 'chime']
const ALERT_TONE_DEFAULT = 'alarm'

/** A tone name from config or a query string, minus anything unrecognised. */
function alertToneKey(value) {
  const key = str(value)
  return key !== undefined && Object.prototype.hasOwnProperty.call(ALERT_TONES, key) ? key : ALERT_TONE_DEFAULT
}

/** `?tone=` on the alert-sound route, falling back to the configured tone. */
function alertToneParam(req, fallback) {
  try {
    const url = new URL(req?.url || '/', 'http://localhost')
    const asked = url.searchParams.get('tone')
    return asked === null ? fallback : alertToneKey(asked)
  } catch {
    return fallback
  }
}

/**
 * Where the alert wav may live, best first.
 *
 * Magpie raises a Windows toast with `ms-winsoundevent:Notification.Default`,
 * so what the user actually hears is the file the Notification app event points
 * at — on a stock install `%SystemRoot%\media\Windows Notify System Generic.wav`.
 * Serving that same file lets the panel ring exactly like Magpie instead of
 * shipping a tone of its own.
 */
function alertSoundCandidates(tone) {
  const out = []
  const override = str(process.env[ALERT_SOUND_ENV])
  if (override) out.push(override)
  const media = path.join(str(process.env.SystemRoot) || 'C:\\Windows', 'media')
  for (const name of ALERT_TONES[alertToneKey(tone)]) out.push(path.join(media, name))
  // A machine missing this tone still rings the file Magpie would have
  // played, so the alert degrades to the stock chime instead of silence.
  if (alertToneKey(tone) !== 'chime') {
    for (const name of ALERT_TONES.chime) out.push(path.join(media, name))
  }
  return out
}

/** tone -> { file, bytes } | null, read once per tone. @type {Map<string, { file: string, bytes: Buffer } | null>} */
const alertSoundCache = new Map()

/** The notification wav, read once; null when this machine has none. */
function alertSound(tone) {
  const key = alertToneKey(tone)
  if (alertSoundCache.has(key)) return alertSoundCache.get(key)
  for (const candidate of alertSoundCandidates(key)) {
    try {
      const bytes = fs.readFileSync(candidate)
      // 44 bytes is a bare wav header; anything shorter is not a sound, and a
      // file without RIFF is not one we can hand to an <audio> element.
      if (bytes.length > 44 && bytes.toString('latin1', 0, 4) === 'RIFF') {
        const found = { file: candidate, bytes }
        alertSoundCache.set(key, found)
        return found
      }
    } catch {
      /* not here — try the next candidate */
    }
  }
  alertSoundCache.set(key, null)
  return null
}

/** tone -> whether this machine has a file for it. */
function alertToneAvailability() {
  const out = {}
  for (const key of ALERT_TONE_ORDER) out[key] = alertSound(key) !== null
  return out
}

// The flash helper. One fixed script next to this module, no arguments, no
// shell: a request can ask for the blink but cannot steer it, and a machine
// without Windows simply reports that there is nothing to flash.
/** Absolute path of the blink helper, or null where this module has no URL. */
function flashScriptPath() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools', 'flash-taskbar.ps1')
  } catch {
    return null
  }
}
const FLASH_MIN_GAP_MS = 1500
const FLASH_KILL_MS = 15000
let lastFlashAt = 0

/** Start the taskbar blink; false when this platform or this moment cannot. */
function flashTaskbar() {
  if (process.platform !== 'win32') return false
  const script = flashScriptPath()
  if (script === null) return false
  const now = Date.now()
  if (now - lastFlashAt < FLASH_MIN_GAP_MS) return false
  lastFlashAt = now
  try {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    ], { windowsHide: true, stdio: 'ignore', detached: false })
    // The helper exits on its own; this is only a leash on a stuck one.
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, FLASH_KILL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    child.on('error', () => {})
    child.on('exit', () => clearTimeout(timer))
    if (typeof child.unref === 'function') child.unref()
    return true
  } catch {
    // no launcher here: the sound and the notification still land
    return false
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(payload))
}

function describe(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? 'unknown' : message
}

/** One conversion point: every cost in the snapshot passes through here. */
function toDisplay(rate, value) {
  return num(value) * rate
}

function trimUsage(usage, rate) {
  const timed = num(usage.timed)
  const decodeMs = num(usage.decode_ms)
  const decodeOut = num(usage.decode_out)
  const input = num(usage.input)
  const cacheRead = num(usage.cache_read)
  return {
    period: str(usage.period) ?? '',
    since: str(usage.since) ?? '',
    bucket: str(usage.bucket) ?? '',
    calls: num(usage.calls),
    errors: num(usage.errors),
    retried: num(usage.retried),
    canceled: num(usage.canceled),
    input,
    output: num(usage.output),
    cacheRead,
    cacheWrite: num(usage.cache_write),
    reasoning: num(usage.reasoning),
    cost: toDisplay(rate, usage.cost),
    unpriced: num(usage.unpriced),
    timed,
    avgTtftMs: timed > 0 ? num(usage.ttft_ms) / timed : null,
    avgTokensPerSecond: decodeMs > 0 ? decodeOut / (decodeMs / 1000) : null,
    cacheHitPct: input + cacheRead > 0 ? (cacheRead / (input + cacheRead)) * 100 : null,
  }
}

function trimSeries(series, rate) {
  if (!Array.isArray(series)) return []
  return series.map((row) => ({
    label: str(row.label) ?? '',
    time: str(row.time) ?? '',
    calls: num(row.calls),
    errors: num(row.errors),
    input: num(row.input),
    output: num(row.output),
    cacheRead: num(row.cache_read),
    cost: toDisplay(rate, row.cost),
  }))
}

/**
 * Per-model throughput the gateway measured itself: tokens per second and
 * time to first token. `/usage` has no such field, so this is the one place
 * the panel can show real decoding speed instead of a derived guess.
 */
function trimSpeeds(speeds, rate) {
  if (!Array.isArray(speeds)) return []
  return speeds.slice(0, 8).map((row) => ({
    model: str(row.model) ?? '',
    name: str(row.name) ?? str(row.model) ?? '',
    requests: num(row.requests),
    tps: num(row.tps),
    tpsN: num(row.tps_n),
    ttftMs: num(row.ttft_ms),
    cost: toDisplay(rate, row.cost),
  }))
}

/**
 * Where the traffic came through: the gateway itself (`through`), a direct
 * client (`direct`) or an upstream report (`reported`). All zero except
 * `through` means everything is proxied by the gateway, which is the normal
 * case for the harness.
 */
function trimChannels(payload, rate) {
  const pick = (key) => {
    const row = payload?.[key]
    if (row === null || typeof row !== 'object') return null
    return {
      calls: num(row.calls),
      errors: num(row.errors),
      cost: toDisplay(rate, row.cost),
    }
  }
  return {
    through: pick('through'),
    direct: pick('direct'),
    reported: pick('reported'),
  }
}

function trimQuotas(quotas) {
  const rows = Array.isArray(quotas?.data) ? quotas.data : []
  return rows.map((row) => ({
    provider: str(row.provider) ?? '',
    name: str(row.name) ?? str(row.provider) ?? '',
    kind: str(row.kind) ?? '',
    plan: str(row.plan),
    user: str(row.user),
    alias: str(row.alias),
    readAt: stamp(row.readAt),
    until: stamp(row.until),
    renew: stamp(row.renew),
    error: str(row.error),
    windows: Array.isArray(row.windows)
      ? row.windows.map((window) => ({
          name: str(window.name) ?? '',
          // Provider windows arrive as raw floats (38.552566…). used is a
          // percentage (used + remaining = 100); one decimal is all it means.
          used: Math.round(num(window.used) * 10) / 10,
          remaining: Math.round(num(window.remaining) * 10) / 10,
          resetsAt: stamp(window.resetsAt),
          display: str(window.display),
          amount: num(window.amount),
          limit: num(window.limit),
          unit: str(window.unit),
          holdsWhy: str(window.holdsWhy),
          runsOutAt: str(window.runsOutAt),
        }))
      : [],
  }))
}

function trimHistory(history) {
  const rows = Array.isArray(history?.data) ? history.data : []
  return rows.map((row) => ({
    provider: str(row.provider) ?? '',
    user: str(row.user),
    lines: Array.isArray(row.lines)
      ? row.lines.map((line) => ({
          name: str(line.name) ?? '',
          points: Array.isArray(line.points)
            ? line.points.map((point) => ({ at: str(point.at) ?? '', left: num(point.left) }))
            : [],
        }))
      : [],
  }))
}

function trimRequests(payload, limit, rate) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  return rows.slice(0, limit).map((row) => ({
    route_id: str(row.route_id) ?? '',
    t: stamp(row.t) ?? '',
    agent: str(row.agent) ?? '',
    agentName: str(row.agentName) ?? str(row.agent) ?? '',
    provider: str(row.provider) ?? '',
    providerName: str(row.providerName) ?? str(row.provider) ?? '',
    providerAccount: str(row.providerAccount),
    model: str(row.model) ?? '',
    req: str(row.req) ?? '',
    served: str(row.served),
    in: num(row.in),
    out: num(row.out),
    cacheRead: num(row.cache_read),
    reasoning: num(row.reasoning),
    ms: num(row.ms),
    ttftMs: num(row.ttft_ms),
    status: num(row.status),
    cost: toDisplay(rate, row.cost),
    priced: row.priced !== false,
    ep: str(row.ep) ?? '',
    access: str(row.access),
    session: str(row.session),
  }))
}

function trimModels(usage, limit, rate) {
  const rows = Array.isArray(usage.models) ? usage.models.slice() : []
  rows.sort((a, b) => num(b.cost) - num(a.cost) || num(b.calls) - num(a.calls))
  return rows.slice(0, limit).map((row) => ({
    id: str(row.id) ?? '',
    provider: str(row.provider) ?? '',
    model: str(row.model) ?? '',
    name: str(row.name) ?? str(row.model) ?? '',
    sub: str(row.sub) ?? str(row.provider) ?? '',
    calls: num(row.calls),
    errors: num(row.errors),
    input: num(row.input),
    output: num(row.output),
    cacheRead: num(row.cache_read),
    cost: toDisplay(rate, row.cost),
    unpriced: num(row.unpriced),
  }))
}

function trimHealth(root) {
  if (root === null || typeof root !== 'object') return null
  return {
    name: str(root.name) ?? '',
    version: str(root.version) ?? '',
    serves: str(root.serves),
    models: num(root.models),
    pid: num(root.pid),
  }
}

// ---------- text report (the model's view of one snapshot) ----------

function compact(value) {
  const n = num(value)
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`
  return String(Math.round(n))
}

function money(value, symbol = '$') {
  const n = num(value)
  if (n >= 1000) return `${symbol}${Math.round(n)}`
  if (n >= 1) return `${symbol}${n.toFixed(2)}`
  return `${symbol}${n.toFixed(4)}`
}

function elapsed(ms) {
  const n = num(ms)
  if (n <= 0) return '—'
  if (n < 1000) return `${Math.round(n)}ms`
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`
  return `${Math.floor(n / 60000)}m${String(Math.round((n % 60000) / 1000)).padStart(2, '0')}s`
}

function at(iso) {
  if (typeof iso !== 'string' || iso === '') return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function report(value, recent) {
  const usage = value.usage ?? {}
  const currency = value.currency ?? { code: 'USD', symbol: '$', rate: 1 }
  const cash = (amount) => money(amount, currency.symbol)
  const converted = currency.code === 'CNY' ? `（成本按 1 USD = ${currency.symbol}${currency.rate} 折算）` : ''
  const lines = []
  lines.push(`Magpie 用量 · ${value.period}${usage.since === '' ? '' : `（自 ${usage.since}）`} · 读取于 ${at(value.fetchedAt)}${converted}`)
  lines.push(`调用 ${compact(usage.calls)}（错误 ${compact(usage.errors)}${num(usage.retried) > 0 ? `，重试 ${compact(usage.retried)}` : ''}）· 成本 ${cash(usage.cost)}${num(usage.unpriced) > 0 ? ` · ${compact(usage.unpriced)} 条未计价` : ''}`)
  lines.push(`输入 ${compact(usage.input)} · 输出 ${compact(usage.output)} · 缓存读取 ${compact(usage.cacheRead)} · 缓存写入 ${compact(usage.cacheWrite)} · 推理 ${compact(usage.reasoning)}`)
  if (usage.avgTtftMs !== null && usage.avgTtftMs !== undefined) {
    const speed = usage.avgTokensPerSecond === null || usage.avgTokensPerSecond === undefined
      ? ''
      : ` · 解码 ${Number(usage.avgTokensPerSecond).toFixed(1)} tok/s`
    lines.push(`平均首字 ${elapsed(usage.avgTtftMs)}${speed}`)
  }
  if (value.statusline !== '') lines.push(`状态行：${value.statusline}`)

  const quotas = (value.quotas ?? []).filter((quota) => quota.windows.length > 0 || quota.error !== undefined)
  if (quotas.length > 0) {
    lines.push('额度：')
    for (const quota of quotas.slice(0, 10)) {
      const windows = quota.windows.map((window) => `${window.name} 已用 ${num(window.used)}%`).join(' / ')
      const parts = [windows, quota.error === undefined ? '' : `读数失败：${quota.error}`]
      lines.push(`  - ${quota.name || quota.provider}${quota.alias ? `（${quota.alias}）` : ''}：${parts.filter(Boolean).join(' · ')}`)
    }
  }

  if ((value.models ?? []).length > 0) {
    lines.push('模型（按成本）：')
    for (const model of value.models.slice(0, 5)) {
      lines.push(`  - ${model.model || model.name}（${model.sub || model.provider}）：${compact(model.calls)} 次 · ${cash(model.cost)} · 入 ${compact(model.input)} / 出 ${compact(model.output)}`)
    }
  }

  const rows = (value.requests ?? []).slice(0, recent)
  if (rows.length > 0) {
    lines.push(`最近 ${rows.length} 条请求：`)
    for (const row of rows) {
      lines.push(`  - ${at(row.t)} ${row.agentName || row.agent} · ${row.req || row.model} → ${row.served || row.model} · ${row.status} · ${elapsed(row.ms)} · ${row.priced === false ? '未计价' : cash(row.cost)}`)
    }
  }

  if ((value.problems ?? []).length > 0) {
    const items = value.problems.map((p) => (p && typeof p === 'object'
      ? `${p.what}读取失败：${p.message}`
      : String(p)))
    lines.push(`读数提示：${items.join('；')}`)
  }
  return lines.join('\n')
}

export function apply(ctx, config) {
  const settings = () => {
    const rate = Number(unwrap(config.cnyRate))
    const cny = Number.isFinite(rate) && rate > 0 ? rate : 0
    const askedPeriod = str(unwrap(config.period))
    return {
      gatewayUrl: normalizeGateway(unwrap(config.gatewayUrl)) || DEFAULT_GATEWAY,
      discover: unwrap(config.discover) !== false,
      refreshMs: clampNumber(unwrap(config.refreshMs), 5000, 1000, 120000),
      requestLimit: clampNumber(unwrap(config.requestLimit), 40, 5, 200),
      period: PERIODS.has(askedPeriod) ? askedPeriod : 'today',
      cnyRate: cny,
      tool: unwrap(config.tool) !== false,
      turnDoneAlert: clampNumber(unwrap(config.turnDoneAlert), 0, 0, 86400),
      alertTone: alertToneKey(unwrap(config.alertTone)),
      alertTones: alertToneAvailability(),
      alertFlash: unwrap(config.alertFlash) !== false,
      alertSound: alertSound(alertToneKey(unwrap(config.alertTone))) !== null,
      currency: cny > 0
        ? { code: 'CNY', symbol: '¥', rate: cny, base: 'USD' }
        : { code: 'USD', symbol: '$', rate: 1, base: 'USD' },
    }
  }

  /** @type {Map<string, { at: number, value: unknown }>} */
  const cache = new Map()

  /**
   * Reads that have not settled yet, keyed like the cache. Callers that ask
   * while one is running join it instead of stampeding the gateway.
   * @type {Map<string, { controller: AbortController, waiters: number, promise: Promise<unknown> }>}
   */
  const inflight = new Map()

  /**
   * The gateway address the last successful read used. When the configured
   * URL stops answering, discovery may find a different port; remember it so
   * the next read goes straight there.
   */
  let resolvedGateway = null

  /**
   * Candidate bases in probe order: the configured URL, then what discovery
   * found, then the historical default. The configured URL wins every time —
   * discovery is a fallback, not an override.
   */
  function gatewayCandidates() {
    const bases = [settings().gatewayUrl]
    if (settings().discover) {
      for (const base of discoverGatewayBases()) {
        if (!bases.includes(base)) bases.push(base)
      }
    }
    if (resolvedGateway !== null && !bases.includes(resolvedGateway)) bases.unshift(resolvedGateway)
    return bases
  }

  async function readUpstream(path, signal, accept, budget, base) {
    const target = new URL(path, base)
    let response
    try {
      response = await fetch(target, {
        headers: { accept },
        signal: AbortSignal.any([signal, AbortSignal.timeout(budget)]),
      })
    } catch (error) {
      // The caller's signal, not the endpoint budget, is what fired: report an
      // interruption instead of a gateway timeout.
      if (signal?.aborted) {
        const aborted = new Error('read aborted by caller')
        aborted.name = 'AbortError'
        aborted.code = CALLER_ABORTED
        throw aborted
      }
      // Keep the status so classifyFailure can tell a refused connection from
      // a rejected request.
      const failure = new Error(describe(error))
      failure.name = error instanceof Error ? error.name : 'Error'
      failure.status = error?.status
      throw failure
    }
    if (!response.ok) {
      const failure = new Error(`${path} answered HTTP ${response.status}`)
      failure.status = response.status
      throw failure
    }
    return response
  }

  async function readJson(path, signal, budget = TIMEOUT_MS, base = null) {
    const response = await readUpstream(path, signal, 'application/json', budget, base ?? settings().gatewayUrl)
    return await response.json()
  }

  async function readText(path, signal, budget = TIMEOUT_MS, base = null) {
    const response = await readUpstream(path, signal, 'text/plain', budget, base ?? settings().gatewayUrl)
    return await response.text()
  }

  /**
   * Read the gateway and trim it. `/usage` is the only required endpoint: a
   * gateway that answers it and not the others is still worth drawing, so the
   * rest settle independently and any failure is reported beside the numbers
   * instead of replacing them.
   *
   * When the required read fails with a connection error and discovery is
   * enabled, the other candidate bases are tried once. Magpie writes its live
   * listen address to `gateway.json`, so a moved port is recovered here
   * instead of leaving the panel blank.
   */
  async function snapshotAt(period, recent, signal, base) {
    const cfg = settings()
    const rate = cfg.currency.rate
    const usage = await readJson(`/v1/magpie/usage?period=${encodeURIComponent(period)}`, signal, TIMEOUT_MS, base)
    const [root, quotas, history, statusline, requests] = await Promise.allSettled([
      readJson('/', signal, TIMEOUT_MS, base),
      readJson('/v1/magpie/quotas', signal, QUOTA_TIMEOUT_MS, base),
      readJson('/v1/magpie/quotas/history', signal, QUOTA_TIMEOUT_MS, base),
      readText('/v1/magpie/statusline', signal, TIMEOUT_MS, base),
      // period matters here too: speeds/channels are scoped to the window, and
      // without it the gateway falls back to its widest default.
      readJson(`/v1/magpie/usage/requests?period=${encodeURIComponent(period)}&limit=${recent}`, signal, REQUESTS_TIMEOUT_MS, base),
    ])
    // Problems carry the failure code as well as a sentence, so the panel can
    // translate the reason instead of showing a raw host string.
    const problems = []
    const note = (what, reason) => {
      const failure = classifyFailure(reason)
      problems.push({ what, code: failure.code, message: failure.message })
    }
    if (root.status === 'rejected') note('网关身份', root.reason)
    if (quotas.status === 'rejected') note('额度', quotas.reason)
    if (history.status === 'rejected') note('额度历史', history.reason)
    if (statusline.status === 'rejected') note('状态行', statusline.reason)
    if (requests.status === 'rejected') note('最近请求', requests.reason)
    return {
      ok: true,
      gateway: base,
      fetchedAt: new Date().toISOString(),
      period,
      config: cfg,
      currency: cfg.currency,
      health: root.status === 'fulfilled' ? trimHealth(root.value) : null,
      usage: trimUsage(usage ?? {}, rate),
      series: trimSeries(usage?.series, rate),
      quotas: quotas.status === 'fulfilled' ? trimQuotas(quotas.value) : [],
      history: history.status === 'fulfilled' ? trimHistory(history.value) : [],
      statusline: statusline.status === 'fulfilled' ? String(statusline.value ?? '').trim() : '',
      models: trimModels(usage ?? {}, 6, rate),
      requests: requests.status === 'fulfilled' ? trimRequests(requests.value, recent, rate) : [],
      // The requests endpoint measures per-model speed and knows which channel
      // the traffic used; /usage has neither.
      speeds: requests.status === 'fulfilled' ? trimSpeeds(requests.value?.speeds, rate) : [],
      channels: requests.status === 'fulfilled' ? trimChannels(requests.value, rate) : null,
      problems,
    }
  }

  async function snapshot(period, recent, signal) {
    const candidates = gatewayCandidates()
    let lastError = null
    for (const base of candidates) {
      try {
        const value = await snapshotAt(period, recent, signal, base)
        resolvedGateway = base
        return value
      } catch (error) {
        lastError = error
        const failure = classifyFailure(error)
        if (failure.code === 'aborted') break
        // A refused connection may mean magpie restarted on another port, so
        // let the next read look at gateway.json again.
        if (failure.code === 'connection') invalidateDiscovery()
        // Only a missing gateway is worth another candidate; an HTTP error
        // means the base answered, so trying others would be noise.
        if (failure.code !== 'connection' && failure.code !== 'timeout') break
        if (signal?.aborted) break
      }
    }
    throw lastError ?? new Error('gateway unreachable')
  }

  const cacheKeyOf = (base, period, recent) => `${base}|${period}|${recent}`

  function rememberCache(key, value) {
    cache.set(key, { at: Date.now(), value })
    if (cache.size > CACHE_MAX) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest !== undefined) cache.delete(oldest[0])
    }
  }

  /**
   * Join one shared read. A caller that goes away only leaves the room: the
   * read is cancelled once nobody is waiting on it any more, so a closing
   * panel cannot take the agent tool's read down with it.
   */
  function joinRead(read, signal) {
    read.waiters += 1
    let left = false
    const leave = () => {
      if (left) return
      left = true
      read.waiters -= 1
      if (read.waiters <= 0) read.controller.abort()
    }
    read.promise.then(leave, leave)
    if (!signal) return read.promise
    if (signal.aborted) {
      leave()
      const aborted = new Error('read aborted by caller')
      aborted.name = 'AbortError'
      aborted.code = CALLER_ABORTED
      return Promise.reject(aborted)
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        leave()
        const aborted = new Error('read aborted by caller')
        aborted.name = 'AbortError'
        aborted.code = CALLER_ABORTED
        reject(aborted)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      read.promise.then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error) },
      )
    })
  }

  /**
   * Read the gateway once per key per window, and once per key in flight.
   * The panel tick, a manual refresh, a reload and the agent tool all ask in
   * the same second; without this they each opened their own read.
   */
  function cachedSnapshot(period, recent, signal, fresh) {
    // The cache key follows the gateway the panel last read successfully, so a
    // discovered port keeps its own entry instead of colliding with the
    // configured one.
    const base = resolvedGateway ?? settings().gatewayUrl
    const key = cacheKeyOf(base, period, recent)
    if (fresh) cache.delete(key)
    const hit = cache.get(key)
    if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value)
    const running = inflight.get(key)
    if (running !== undefined) return joinRead(running, signal)
    const read = { controller: new AbortController(), waiters: 0, promise: null }
    read.promise = snapshot(period, recent, read.controller.signal)
      .then((value) => {
        // Discovery may have answered from another port; store the entry under
        // the key the next lookup will compute, and drop the one we missed on.
        const settled = cacheKeyOf(value.gateway ?? base, period, recent)
        rememberCache(settled, value)
        if (settled !== key) cache.delete(key)
        return value
      })
      .finally(() => {
        if (inflight.get(key) === read) inflight.delete(key)
      })
    inflight.set(key, read)
    return joinRead(read, signal)
  }

  function parseQuery(req) {
    try {
      return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    } catch {
      return new URLSearchParams()
    }
  }

  const configHandler = async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
    const untrusted = isTrustedRequest(req)
    if (untrusted !== null) return sendJson(res, 403, { ok: false, error: untrusted })
    sendJson(res, 200, { ok: true, config: settings() })
  }

  const dataHandler = async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
    const untrusted = isTrustedRequest(req)
    if (untrusted !== null) return sendJson(res, 403, { ok: false, error: untrusted })
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad request url' })
    }
    const key = url.searchParams.get('path') || ''
    const upstreamPath = Object.prototype.hasOwnProperty.call(UPSTREAM, key) ? UPSTREAM[key] : null
    if (!upstreamPath) return sendJson(res, 400, { ok: false, error: `unknown path key: ${key}` })
    const rule = QUERY_RULES[key]
    const cfg = settings()

    // Same base the snapshot used: after discovery moved the port, the detail
    // reads must follow it instead of the configured URL.
    const target = new URL(upstreamPath, resolvedGateway ?? cfg.gatewayUrl)
    for (const [name, value] of url.searchParams) {
      if (name === 'path') continue
      if (!rule.allowed.includes(name)) continue
      target.searchParams.set(name, value)
    }
    for (const name of rule.required ?? []) {
      if (!target.searchParams.has(name)) {
        return sendJson(res, 400, { ok: false, error: `missing required query: ${name}` })
      }
    }

    try {
      // The panel closes this read when the user switches away, so stop the
      // upstream request too instead of leaving it to burn its budget.
      const stop = new AbortController()
      req.on('close', () => stop.abort())
      const budget = AbortSignal.timeout(10000)
      const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([stop.signal, budget]) : budget
      const response = await fetch(target, {
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5' },
        signal,
      })
      const text = await response.text()
      if (!response.ok) {
        return sendJson(res, 502, {
          ok: false,
          error: `gateway HTTP ${response.status}`,
          code: response.status >= 500 ? 'server_error' : 'bad_request',
          body: text.slice(0, 400),
        })
      }
      let data = null
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
      return sendJson(res, 200, {
        ok: true,
        key,
        data,
        text: data === null ? text : undefined,
        fetchedAt: Date.now(),
      })
    } catch (error) {
      const failure = classifyFailure(error)
      return sendJson(res, 502, { ok: false, error: failure.message, code: failure.code })
    }
  }

  const snapshotHandler = async (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      return sendJson(res, 405, { ok: false, error: 'GET only' })
    }
    const untrusted = isTrustedRequest(req)
    if (untrusted !== null) return sendJson(res, 403, { ok: false, error: untrusted })
    const params = parseQuery(req)
    const cfg = settings()
    const asked = params.get('period')
    const period = PERIODS.has(asked) ? asked : cfg.period
    // `?? undefined` matters: Number(null) is 0, which would clamp to 1 instead
    // of falling back to the configured requestLimit.
    const recent = clampNumber(params.get('recent') ?? undefined, cfg.requestLimit, 1, 200)
    const fresh = params.get('fresh') === '1'
    const controller = new AbortController()
    req.on('close', () => controller.abort())
    try {
      const body = await cachedSnapshot(period, recent, controller.signal, fresh)
      sendJson(res, 200, body)
    } catch (error) {
      const failure = classifyFailure(error)
      sendJson(res, 502, {
        ok: false,
        error: controller.signal.aborted ? 'aborted' : failure.message,
        code: controller.signal.aborted ? 'aborted' : failure.code,
        gateway: cfg.gatewayUrl,
        fetchedAt: new Date().toISOString(),
      })
    }
  }

  // The alert wav is a local file the browser cannot reach on its own, so the
  // Host streams it under its own origin. Cached for a day: it never changes.
  const alertHandler = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD')
      return sendJson(res, 405, { ok: false, error: 'GET only' })
    }
    const untrusted = isTrustedRequest(req)
    if (untrusted !== null) return sendJson(res, 403, { ok: false, error: untrusted })
    const wav = alertSound(alertToneParam(req, alertToneKey(unwrap(config.alertTone))))
    if (wav === null) {
      return sendJson(res, 404, {
        ok: false,
        code: 'no_sound',
        error: 'no system notification sound here (point ' + ALERT_SOUND_ENV + ' at a .wav)',
      })
    }
    res.statusCode = 200
    res.setHeader('content-type', 'audio/wav')
    res.setHeader('content-length', String(wav.bytes.length))
    res.setHeader('cache-control', 'private, max-age=86400')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(req.method === 'HEAD' ? undefined : wav.bytes)
  }

  // The taskbar button belongs to the desktop shell, and the shell only
  // paints it: no page can blink it. Windows' own answer is FlashWindowEx on
  // the shell's window, which is what flashTaskbar() asks the helper to do.
  const alertFlashHandler = async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST')
      return sendJson(res, 405, { ok: false, error: 'POST only' })
    }
    const untrusted = isTrustedRequest(req)
    if (untrusted !== null) return sendJson(res, 403, { ok: false, error: untrusted })
    if (unwrap(config.alertFlash) === false) return sendJson(res, 200, { ok: true, flashed: false, code: 'off' })
    const flashed = flashTaskbar()
    const code = flashed ? 'flashed' : process.platform === 'win32' ? 'throttled' : 'unsupported'
    sendJson(res, 200, { ok: true, flashed, code })
  }

  // webServer only exists in profiles that serve the Web UI; stay inert in
  // headless/TUI profiles instead of failing activation.
  ctx.inject(['webServer'], (webCtx) => {
    const routes = [
      { kind: 'exact', path: CONFIG_ROUTE, handler: configHandler },
      { kind: 'exact', path: DATA_ROUTE, handler: dataHandler },
      { kind: 'exact', path: SNAPSHOT_ROUTE, handler: snapshotHandler },
      { kind: 'exact', path: ALERT_ROUTE, handler: alertHandler },
      { kind: 'exact', path: ALERT_FLASH_ROUTE, handler: alertFlashHandler },
    ]
    webCtx.effect(() => {
      const disposers = routes.map((route) => {
        try {
          return webCtx.webServer.register(route)
        } catch (error) {
          webCtx.logger?.warn?.(`magpie-monitor: route ${route.path} failed: ${describe(error)}`)
          return () => {}
        }
      })
      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.()
          } catch {
            /* unloading must not throw */
          }
        }
      }
    }, 'magpie-monitor: browser routes')
  })

  // The agent tool reads the same cached snapshot as the panel. Registration is
  // decided once at apply time; toggling `tool` later needs a profile restart.
  if (settings().tool) {
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.effect(() => {
        const definition = {
          name: 'magpie_usage',
          description:
            '查本机 Magpie 网关的用量与额度：调用次数、成本（按配置汇率折算）、输入/输出/缓存 token、各 provider 的额度窗口、模型成本排行、最近请求。'
            + 'period 缺省取面板设置（today 按小时分桶 / 7d / 30d / all）；recent 是最近请求条数，默认 5。',
          parameters: {
            type: 'object',
            properties: {
              period: { type: 'string', enum: ['today', '7d', '30d', 'all'], description: '统计周期，缺省取面板设置' },
              recent: { type: 'integer', description: '最近请求条数，1–50，缺省 5' },
            },
            required: [],
            additionalProperties: false,
          },
          timeoutMs: 22000,
          isConcurrencySafe: () => true,
          // `output` is mandatory: the schema validates the returned value and
          // `render` is what the model reads. One lossless string keeps both
          // honest and costs far fewer tokens than the raw ledger.
          output: {
            schema: { type: 'string' },
            render(_args, value) {
              return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
            },
          },
          async execute(args, exec) {
            const cfg = settings()
            const asked = typeof args?.period === 'string' && PERIODS.has(args.period) ? args.period : cfg.period
            const recent = Number.isInteger(args?.recent) ? Math.min(Math.max(args.recent, 1), 50) : 5
            const signal = exec?.signal ?? new AbortController().signal
            const value = await cachedSnapshot(asked, Math.max(recent, 5), signal, false)
            return report(value, recent)
          },
        }
        try {
          return toolCtx.tools.register(definition)
        } catch (error) {
          toolCtx.logger?.warn?.(`magpie-monitor: tool registration failed: ${describe(error)}`)
          return () => {}
        }
      }, 'magpie-monitor: agent tool')
    })
  }
}