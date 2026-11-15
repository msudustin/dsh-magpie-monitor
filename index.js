// Host half of @local/dsh-magpie-monitor.
//
// The Magpie gateway (default http://127.0.0.1:3425) does not send CORS
// headers, so the Web page cannot call it directly. This plugin reads the
// gateway on the Host and republishes it under the Harness origin:
//
//   GET /magpie-monitor/api/config            -> effective settings
//   GET /magpie-monitor/api/data?path=<key>   -> one raw upstream payload
//   GET /magpie-monitor/api/snapshot          -> merged, trimmed, cached view
//
// The snapshot is the whole data source for both the sidebar widget and the
// `magpie_usage` agent tool, so the panel and the model read one implementation
// instead of two. Only fixed upstream paths are reachable and only a small set
// of query parameters are forwarded, so none of these routes is an open proxy.

import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  /** Base URL of the local Magpie gateway. */
  gatewayUrl: z.string().default('http://127.0.0.1:3425').volatile()
    .description('Magpie 网关根地址（不带 /v1），默认 http://127.0.0.1:3425'),
  /** Panel auto-refresh interval in milliseconds. */
  refreshMs: z.number().default(5000).volatile()
    .description('自动刷新间隔（毫秒），1000–120000，默认 5000'),
  /** How many recent requests the routing table asks for. */
  requestLimit: z.number().default(40).volatile()
    .description('实时路由表拉取的最近请求条数，5–200，默认 40'),
  /** Default statistics window for the panel and the tool. */
  period: z.string().default('today').volatile()
    .description('默认统计周期：today（按小时）/ 7d / 30d，默认 today'),
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
})

const CONFIG_ROUTE = '/magpie-monitor/api/config'
const DATA_ROUTE = '/magpie-monitor/api/data'
const SNAPSHOT_ROUTE = '/magpie-monitor/api/snapshot'

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

const PASS_QUERY = new Set(['limit', 'session', 'offset', 'period'])
const PERIODS = new Set(['today', '7d', '30d'])
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

/** Trim to a finite number, or 0. Gateway counters are sometimes absent on old rows. */
function num(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Keep only non-empty strings; everything else becomes undefined. */
function str(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
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

function trimQuotas(quotas) {
  const rows = Array.isArray(quotas?.data) ? quotas.data : []
  return rows.map((row) => ({
    provider: str(row.provider) ?? '',
    name: str(row.name) ?? str(row.provider) ?? '',
    kind: str(row.kind) ?? '',
    plan: str(row.plan),
    user: str(row.user),
    alias: str(row.alias),
    readAt: str(row.readAt),
    until: str(row.until),
    renew: str(row.renew),
    error: str(row.error),
    windows: Array.isArray(row.windows)
      ? row.windows.map((window) => ({
          name: str(window.name) ?? '',
          // Provider windows arrive as raw floats (38.552566…). used is a
          // percentage (used + remaining = 100); one decimal is all it means.
          used: Math.round(num(window.used) * 10) / 10,
          remaining: Math.round(num(window.remaining) * 10) / 10,
          resetsAt: str(window.resetsAt),
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
    t: str(row.t) ?? '',
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

  if ((value.problems ?? []).length > 0) lines.push(`读数提示：${value.problems.join('；')}`)
  return lines.join('\n')
}

export function apply(ctx, config) {
  const settings = () => {
    const rate = Number(unwrap(config.cnyRate))
    const cny = Number.isFinite(rate) && rate > 0 ? rate : 0
    const askedPeriod = str(unwrap(config.period))
    return {
      gatewayUrl: normalizeGateway(unwrap(config.gatewayUrl)) || DEFAULT_GATEWAY,
      refreshMs: clampNumber(unwrap(config.refreshMs), 5000, 1000, 120000),
      requestLimit: clampNumber(unwrap(config.requestLimit), 40, 5, 200),
      period: PERIODS.has(askedPeriod) ? askedPeriod : 'today',
      cnyRate: cny,
      tool: unwrap(config.tool) !== false,
      currency: cny > 0
        ? { code: 'CNY', symbol: '¥', rate: cny, base: 'USD' }
        : { code: 'USD', symbol: '$', rate: 1, base: 'USD' },
    }
  }

  /** @type {Map<string, { at: number, value: unknown }>} */
  const cache = new Map()

  async function readUpstream(path, signal, accept, budget) {
    const target = new URL(path, settings().gatewayUrl)
    const response = await fetch(target, {
      headers: { accept },
      signal: AbortSignal.any([signal, AbortSignal.timeout(budget)]),
    })
    if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`)
    return response
  }

  async function readJson(path, signal, budget = TIMEOUT_MS) {
    const response = await readUpstream(path, signal, 'application/json', budget)
    return await response.json()
  }

  async function readText(path, signal, budget = TIMEOUT_MS) {
    const response = await readUpstream(path, signal, 'text/plain', budget)
    return await response.text()
  }

  /**
   * Read the gateway and trim it. `/usage` is the only required endpoint: a
   * gateway that answers it and not the others is still worth drawing, so the
   * rest settle independently and any failure is reported beside the numbers
   * instead of replacing them.
   */
  async function snapshot(period, recent, signal) {
    const cfg = settings()
    const rate = cfg.currency.rate
    const usage = await readJson(`/v1/magpie/usage?period=${encodeURIComponent(period)}`, signal)
    const [root, quotas, history, statusline, requests] = await Promise.allSettled([
      readJson('/', signal),
      readJson('/v1/magpie/quotas', signal, QUOTA_TIMEOUT_MS),
      readJson('/v1/magpie/quotas/history', signal, QUOTA_TIMEOUT_MS),
      readText('/v1/magpie/statusline', signal),
      readJson(`/v1/magpie/usage/requests?limit=${recent}`, signal, REQUESTS_TIMEOUT_MS),
    ])
    const problems = []
    if (root.status === 'rejected') problems.push(`网关身份读取失败：${describe(root.reason)}`)
    if (quotas.status === 'rejected') problems.push(`额度读取失败：${describe(quotas.reason)}`)
    if (history.status === 'rejected') problems.push(`额度历史读取失败：${describe(history.reason)}`)
    if (statusline.status === 'rejected') problems.push(`状态行读取失败：${describe(statusline.reason)}`)
    if (requests.status === 'rejected') problems.push(`最近请求读取失败：${describe(requests.reason)}`)
    return {
      ok: true,
      gateway: cfg.gatewayUrl,
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
      problems,
    }
  }

  function cachedSnapshot(period, recent, signal, fresh) {
    const key = `${settings().gatewayUrl}|${period}|${recent}`
    if (fresh) cache.delete(key)
    const hit = cache.get(key)
    if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value)
    return snapshot(period, recent, signal).then((value) => {
      cache.set(key, { at: Date.now(), value })
      if (cache.size > CACHE_MAX) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (oldest !== undefined) cache.delete(oldest[0])
      }
      return value
    })
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
    sendJson(res, 200, { ok: true, config: settings() })
  }

  const dataHandler = async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad request url' })
    }
    const key = url.searchParams.get('path') || ''
    const upstreamPath = Object.prototype.hasOwnProperty.call(UPSTREAM, key) ? UPSTREAM[key] : null
    if (!upstreamPath) return sendJson(res, 400, { ok: false, error: `unknown path key: ${key}` })

    const target = new URL(upstreamPath, settings().gatewayUrl)
    for (const [name, value] of url.searchParams) {
      if (PASS_QUERY.has(name)) target.searchParams.set(name, value)
    }

    try {
      const response = await fetch(target, {
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5' },
        signal: AbortSignal.timeout(10000),
      })
      const text = await response.text()
      if (!response.ok) {
        return sendJson(res, 502, { ok: false, error: `gateway HTTP ${response.status}`, body: text.slice(0, 400) })
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
      return sendJson(res, 502, { ok: false, error: describe(error) })
    }
  }

  const snapshotHandler = async (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      return sendJson(res, 405, { ok: false, error: 'GET only' })
    }
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
      sendJson(res, 502, {
        ok: false,
        error: controller.signal.aborted ? 'aborted' : describe(error),
        gateway: cfg.gatewayUrl,
        fetchedAt: new Date().toISOString(),
      })
    }
  }

  // webServer only exists in profiles that serve the Web UI; stay inert in
  // headless/TUI profiles instead of failing activation.
  ctx.inject(['webServer'], (webCtx) => {
    const routes = [
      { kind: 'exact', path: CONFIG_ROUTE, handler: configHandler },
      { kind: 'exact', path: DATA_ROUTE, handler: dataHandler },
      { kind: 'exact', path: SNAPSHOT_ROUTE, handler: snapshotHandler },
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
            + 'period 缺省取面板设置（today 按小时分桶 / 7d / 30d）；recent 是最近请求条数，默认 5。',
          parameters: {
            type: 'object',
            properties: {
              period: { type: 'string', enum: ['today', '7d', '30d'], description: '统计周期，缺省取面板设置' },
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