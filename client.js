/*
 * dsh-magpie-monitor — client half (browser).
 *
 * Registers three slots:
 *   - sidebar.footer.action : the live Magpie widget (rail when narrow, panel when wide).
 *   - settings.section      : a "Magpie" page in Settings (display style + content + host config).
 *   - plugins.bundle.config : the same settings component on the plugin detail page.
 *
 * Display style/content + mask/auto live in a module-level uiStore persisted to localStorage,
 * shared by the footer and the settings page so edits apply live everywhere. Host config
 * (gateway/refresh/limit/period/cny/tool) is edited through ctx.configForms (host-persisted).
 * The settings preview reuses the real presentation component (MagpieBody) with sample data.
 *
 * Only theme tokens are used for color; no Harness client package is imported; React comes
 * from the browser module table. All resources are registered inside apply() via ctx.effect.
 */
'use strict'

const NS = 'dsh-magpie-monitor'
const WIDGET_ID = 'magpie-monitor'
const API = '/magpie-monitor/api'
const STORE_KEY = 'dsh-magpie-monitor:v1'
const DISPLAY_KEY = 'dsh-magpie-monitor:display:v1'
const PERIODS = ['today', '7d', '30d']
const SAVE_EVERY_MS = 15000
const SAVE_MAX_CHARS = 300000
const STYLES = ['standard', 'compact', 'minimal']
const BLOCKS = ['route', 'usage', 'chart', 'metrics', 'quotas', 'spark', 'models', 'requests']

const EN = {
  'widget.title': 'Magpie',
  'widget.rail': 'Magpie monitor',
  'rail.tip': 'Magpie · {calls} calls · {cost} · {model}',
  'btn.mask': 'Mask amounts & accounts',
  'btn.auto': 'Auto refresh',
  'btn.refresh': 'Refresh',
  'status.online': 'Online',
  'status.offline': 'Offline',
  'status.live': 'Live',
  'status.paused': 'Paused',
  'update.live': 'Auto refresh on — click to refresh now',
  'update.paused': 'Auto refresh off — click to refresh',
  'update.busy': 'Refreshing…',
  'update.offline': 'Gateway offline — click to retry',
  'latest.rate': 'Output rate',
  'banner': 'Magpie gateway unreachable. Showing last known data.',
  'banner.first': 'Magpie gateway unreachable. Check that it is running.',
  'stale': 'Refresh failed — showing last good data from {time}.',
  'problems': 'Partial data',
  'retry': 'Retry',
  'latest': 'Latest route',
  'latest.none': 'No routed request yet',
  'usage.calls': 'calls',
  'usage.tokens': 'tokens',
  'usage.cost': 'cost',
  'metrics.errors': 'errors',
  'metrics.ttft': 'TTFT',
  'metrics.tps': 'tok/s',
  'metrics.cache': 'cache',
  'period.today': 'Today',
  'period.7d': '7 days',
  'period.30d': '30 days',
  'chart.tip': '{label} · {calls} calls · {cost}',
  'quota.title': 'Quotas',
  'quota.account': 'Account',
  'quota.plan': 'Plan',
  'quota.resets': 'Resets',
  'quota.expires': 'Expires',
  'quota.none': 'No quota windows',
  'expand.more': 'More',
  'expand.less': 'Less',
  'detail.recent': 'Recent requests',
  'detail.models': 'Top models by cost',
  'detail.quota': 'All quotas',
  'empty.recent': 'No requests yet',
  'empty.models': 'No model usage yet',
  'req.ttft': 'TTFT',
  'req.cache': 'cache',
  'updated': 'Updated {time}',
  'settings.nav': 'Magpie',
  'settings.title': 'Magpie Monitor',
  'settings.subtitle': 'Customize the sidebar widget. Changes apply instantly and are saved automatically.',
  'settings.style': 'Display style',
  'settings.style.standard': 'Standard',
  'settings.style.standard.desc': 'Full panel: stats, chart, quotas and details.',
  'settings.style.compact': 'Compact',
  'settings.style.compact.desc': 'Tighter spacing and fewer rows.',
  'settings.style.minimal': 'Minimal',
  'settings.style.minimal.desc': 'A single line: calls, cost and top quota.',
  'settings.content': 'Display content',
  'settings.content.route': 'Latest route',
  'settings.content.route.desc': 'The most recent routed request.',
  'settings.content.usage': 'Usage stats',
  'settings.content.usage.desc': 'Calls, tokens and cost for the period.',
  'settings.content.chart': 'Activity chart',
  'settings.content.chart.desc': 'Per-bucket call bars.',
  'settings.content.metrics': 'Derived metrics',
  'settings.content.metrics.desc': 'Errors, TTFT, tokens/s and cache hit.',
  'settings.content.quotas': 'Quota bars',
  'settings.content.quotas.desc': 'Remaining quota per account window.',
  'settings.content.spark': 'Quota history',
  'settings.content.spark.desc': 'Sparkline of remaining quota over time.',
  'settings.content.models': 'Top models',
  'settings.content.models.desc': 'Models ranked by cost (in details).',
  'settings.content.requests': 'Recent requests',
  'settings.content.requests.desc': 'Recent routed requests (in details).',
  'settings.preview': 'Live preview',
  'settings.preview.note': 'Preview uses sample data.',
  'settings.data': 'Data & refresh',
  'settings.data.gateway': 'Gateway URL',
  'settings.data.refresh': 'Refresh interval',
  'settings.data.limit': 'Recent request count',
  'settings.data.period': 'Default period',
  'settings.data.cny': 'CNY rate',
  'settings.data.cny.hint': '0 keeps USD; >0 converts amounts to CNY.',
  'settings.data.tool': 'Agent tool',
  'settings.data.tool.desc': 'Expose magpie_usage to the agent (restart to apply).',
  'settings.data.unavailable': 'Configuration service unavailable. Display settings still work.',
  'settings.data.readonly': 'Read-only',
  'settings.prefs': 'Preferences',
  'settings.prefs.mask': 'Mask amounts & accounts',
  'settings.prefs.auto': 'Auto refresh',
  'settings.reset': 'Reset display settings',
  'settings.saved': 'Saved',
  'units.ms': 'ms',
}

const ZH = {
  'widget.title': 'Magpie',
  'widget.rail': 'Magpie 监控',
  'rail.tip': 'Magpie · {calls} 次调用 · {cost} · {model}',
  'btn.mask': '打码金额与账号',
  'btn.auto': '自动刷新',
  'btn.refresh': '刷新',
  'status.online': '在线',
  'status.offline': '离线',
  'status.live': '实时',
  'status.paused': '已暂停',
  'update.live': '实时刷新中 · 点击立即刷新',
  'update.paused': '自动刷新已关闭 · 点击刷新',
  'update.busy': '刷新中…',
  'update.offline': '网关离线 · 点击重试',
  'latest.rate': '输出速率',
  'banner': 'Magpie 网关不可达，显示最近一次数据。',
  'banner.first': 'Magpie 网关不可达，请确认它正在运行。',
  'stale': '刷新失败 — 显示 {time} 的最近正常数据。',
  'problems': '部分数据',
  'retry': '重试',
  'latest': '最新路由',
  'latest.none': '暂无路由请求',
  'usage.calls': '调用',
  'usage.tokens': ' tokens',
  'usage.cost': '成本',
  'metrics.errors': '错误',
  'metrics.ttft': 'TTFT',
  'metrics.tps': 'tok/s',
  'metrics.cache': '缓存',
  'period.today': '今日',
  'period.7d': '7 天',
  'period.30d': '30 天',
  'chart.tip': '{label} · {calls} 次调用 · {cost}',
  'quota.title': '额度',
  'quota.account': '账号',
  'quota.plan': '套餐',
  'quota.resets': '重置',
  'quota.expires': '到期',
  'quota.none': '暂无额度窗口',
  'expand.more': '更多',
  'expand.less': '收起',
  'detail.recent': '最近请求',
  'detail.models': '模型成本排行',
  'detail.quota': '全部额度',
  'empty.recent': '暂无请求',
  'empty.models': '暂无模型用量',
  'req.ttft': 'TTFT',
  'req.cache': '缓存',
  'updated': '更新于 {time}',
  'settings.nav': 'Magpie',
  'settings.title': 'Magpie 监控',
  'settings.subtitle': '自定义侧边栏小组件。更改即时生效并自动保存。',
  'settings.style': '展示样式',
  'settings.style.standard': '标准',
  'settings.style.standard.desc': '完整面板：统计、图表、额度与详情。',
  'settings.style.compact': '紧凑',
  'settings.style.compact.desc': '更小的间距、更少的行数。',
  'settings.style.minimal': '极简',
  'settings.style.minimal.desc': '单行：调用、成本与额度。',
  'settings.content': '展示内容',
  'settings.content.route': '最新路由',
  'settings.content.route.desc': '最近一次路由请求。',
  'settings.content.usage': '用量统计',
  'settings.content.usage.desc': '该周期的调用、tokens 与成本。',
  'settings.content.chart': '调用分布图',
  'settings.content.chart.desc': '按时间桶的调用柱状图。',
  'settings.content.metrics': '派生指标',
  'settings.content.metrics.desc': '错误、TTFT、tokens/s 与缓存命中。',
  'settings.content.quotas': '额度进度条',
  'settings.content.quotas.desc': '各账号窗口的剩余额度。',
  'settings.content.spark': '额度历史曲线',
  'settings.content.spark.desc': '剩余额度随时间的迷你曲线。',
  'settings.content.models': '模型排行',
  'settings.content.models.desc': '按成本排序的模型（在详情中）。',
  'settings.content.requests': '最近请求',
  'settings.content.requests.desc': '最近的路由请求（在详情中）。',
  'settings.preview': '实时预览',
  'settings.preview.note': '预览使用示例数据。',
  'settings.data': '数据与刷新',
  'settings.data.gateway': '网关地址',
  'settings.data.refresh': '刷新间隔',
  'settings.data.limit': '最近请求条数',
  'settings.data.period': '默认周期',
  'settings.data.cny': '人民币汇率',
  'settings.data.cny.hint': '0 保留美元；>0 将金额折算为人民币。',
  'settings.data.tool': 'Agent 工具',
  'settings.data.tool.desc': '向 agent 暴露 magpie_usage（重启后生效）。',
  'settings.data.unavailable': '配置服务不可用。展示设置仍可正常使用。',
  'settings.data.readonly': '只读',
  'settings.prefs': '偏好',
  'settings.prefs.mask': '打码金额与账号',
  'settings.prefs.auto': '自动刷新',
  'settings.reset': '重置展示设置',
  'settings.saved': '已保存',
  'units.ms': '毫秒',
}

// ---- formatting -----------------------------------------------------------

const compactFmt = (() => {
  try { return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }) }
  catch { return null }
})()

function fmtInt(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return String(Math.round(v))
}
function fmtCompact(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  if (compactFmt) return compactFmt.format(v)
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(Math.round(v))
}
function fmtMs(ms) {
  const v = Number(ms)
  if (!Number.isFinite(v) || v <= 0) return '0 ms'
  if (v >= 1000) return (v / 1000).toFixed(1) + ' s'
  return Math.round(v) + ' ms'
}
function fmtClock(ts) {
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes())
}
function fmtRelative(ts) {
  const t = Number(ts)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return Math.round(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago'
  return Math.round(diff / 86400000) + 'd ago'
}
function shortAccount(s) {
  const str = String(s || '')
  const at = str.split('@')[0]
  return at.length > 14 ? at.slice(0, 13) + '…' : at
}
function maskAccount(s) {
  const str = shortAccount(s)
  if (str.length <= 2) return '•••'
  return str.slice(0, 2) + '•••'
}
function statusOk(code) {
  const n = Number(code)
  return Number.isFinite(n) && n >= 200 && n < 300
}
function servedOf(row) {
  return row && (row.served || row.model) ? String(row.served || row.model) : ''
}
async function getJson(url, signal) {
  const res = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

// ---- snapshot sanitizing (whitelist rebuild) ------------------------------

function sanitizeSnapshot(raw) {
  if (!raw || raw.ok !== true || !raw.usage) return null
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const nn = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  const s = (v) => (v == null ? '' : String(v))
  const arr = (v, cap) => (Array.isArray(v) ? v.slice(0, cap) : [])
  const u = raw.usage || {}
  const usage = {
    period: s(u.period), since: nn(u.since), bucket: s(u.bucket),
    calls: num(u.calls), errors: num(u.errors), retried: num(u.retried), canceled: num(u.canceled),
    input: num(u.input), output: num(u.output), cacheRead: num(u.cacheRead), cacheWrite: num(u.cacheWrite),
    reasoning: num(u.reasoning), cost: num(u.cost), unpriced: num(u.unpriced), timed: num(u.timed),
    avgTtftMs: num(u.avgTtftMs), avgTokensPerSecond: num(u.avgTokensPerSecond), cacheHitPct: num(u.cacheHitPct),
  }
  const c = raw.config || {}
  const config = {
    gatewayUrl: s(c.gatewayUrl), refreshMs: num(c.refreshMs), requestLimit: num(c.requestLimit),
    period: s(c.period), cnyRate: num(c.cnyRate), tool: c.tool !== false,
  }
  const cur = raw.currency || {}
  const currency = { code: s(cur.code) || 'USD', symbol: s(cur.symbol) || '$', rate: num(cur.rate) || 1 }
  const h = raw.health || {}
  const health = { name: s(h.name), version: s(h.version), serves: s(h.serves), models: num(h.models), pid: nn(h.pid) }
  const series = arr(raw.series, 40).map((b) => ({
    label: s(b && b.label), time: nn(b && b.time), calls: num(b && b.calls), errors: num(b && b.errors),
    input: num(b && b.input), output: num(b && b.output), cacheRead: num(b && b.cacheRead),
    cacheWrite: num(b && b.cacheWrite), reasoning: num(b && b.reasoning), cost: num(b && b.cost), unpriced: num(b && b.unpriced),
  }))
  const quotas = arr(raw.quotas, 40).map((q) => ({
    provider: s(q && q.provider), name: s(q && q.name), kind: s(q && q.kind), plan: s(q && q.plan),
    user: s(q && q.user), alias: s(q && q.alias), readAt: nn(q && q.readAt), until: nn(q && q.until), renew: nn(q && q.renew),
    windows: arr(q && q.windows, 12).map((w) => ({
      name: s(w && w.name), used: num(w && w.used), remaining: num(w && w.remaining), resetsAt: nn(w && w.resetsAt),
      display: s(w && w.display), amount: nn(w && w.amount), limit: nn(w && w.limit), unit: s(w && w.unit),
      holdsWhy: s(w && w.holdsWhy), runsOutAt: nn(w && w.runsOutAt),
    })),
  }))
  const history = arr(raw.history, 40).map((a) => ({
    provider: s(a && a.provider), user: s(a && a.user),
    lines: arr(a && a.lines, 12).map((l) => ({
      name: s(l && l.name),
      points: arr(l && l.points, 60).map((p) => ({ at: nn(p && p.at), left: num(p && p.left) })),
    })),
  }))
  const requests = arr(raw.requests, 200).map((r) => ({
    route_id: s(r && r.route_id), t: nn(r && r.t), agent: s(r && r.agent), agentName: s(r && r.agentName),
    provider: s(r && r.provider), providerName: s(r && r.providerName), providerAccount: s(r && r.providerAccount),
    model: s(r && r.model), req: s(r && r.req), served: s(r && r.served), ep: s(r && r.ep), access: s(r && r.access),
    session: s(r && r.session), in: num(r && r.in), out: num(r && r.out), cacheRead: num(r && r.cacheRead),
    reasoning: num(r && r.reasoning), ms: num(r && r.ms), ttftMs: num(r && r.ttftMs), status: nn(r && r.status),
    cost: num(r && r.cost), priced: r && r.priced !== false,
  }))
  const models = arr(raw.models, 12).map((m) => ({
    id: s(m && m.id), provider: s(m && m.provider), model: s(m && m.model), host: s(m && m.host),
    name: s(m && m.name), sub: s(m && m.sub), calls: num(m && m.calls), errors: num(m && m.errors),
    input: num(m && m.input), output: num(m && m.output), cacheRead: num(m && m.cacheRead),
    cost: num(m && m.cost), unpriced: num(m && m.unpriced),
  }))
  return {
    ok: true, gateway: s(raw.gateway), fetchedAt: nn(raw.fetchedAt), period: s(raw.period),
    config, currency, health, usage, series, quotas, history, requests, models,
    statusline: s(raw.statusline),
    problems: arr(raw.problems, 8).map((p) => s(p)),
  }
}

function sanitizePrefs(raw) {
  const p = raw || {}
  return {
    period: PERIODS.indexOf(p.period) >= 0 ? p.period : null,
    masked: p.masked === true,
    auto: p.auto !== false,
  }
}

function loadPersisted() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { prefs: sanitizePrefs(null), snap: null, savedAt: null }
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return { prefs: sanitizePrefs(null), snap: null, savedAt: null }
    const env = JSON.parse(raw)
    if (!env || env.v !== 1) return { prefs: sanitizePrefs(null), snap: null, savedAt: null }
    return { prefs: sanitizePrefs(env.prefs), snap: sanitizeSnapshot(env.snap), savedAt: Number(env.savedAt) || null }
  } catch {
    return { prefs: sanitizePrefs(null), snap: null, savedAt: null }
  }
}

// ---- display / UI prefs store (shared by footer + settings) ---------------

function sanitizeUi(raw) {
  const r = raw || {}
  const style = STYLES.indexOf(r.style) >= 0 ? r.style : 'standard'
  const show = {}
  const src = r.show || {}
  for (const k of BLOCKS) show[k] = src[k] !== false
  return { style, show, masked: r.masked === true, auto: r.auto !== false }
}

function loadUi() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return sanitizeUi(null)
    const raw = window.localStorage.getItem(DISPLAY_KEY)
    if (raw) {
      const env = JSON.parse(raw)
      if (env && env.v === 1) return sanitizeUi(env.ui)
    }
    // migrate mask/auto from the legacy snapshot envelope on first run
    const old = window.localStorage.getItem(STORE_KEY)
    if (old) {
      const env = JSON.parse(old)
      if (env && env.v === 1 && env.prefs) return sanitizeUi({ masked: env.prefs.masked, auto: env.prefs.auto })
    }
    return sanitizeUi(null)
  } catch {
    return sanitizeUi(null)
  }
}

function createUiStore() {
  let current = null
  const listeners = new Set()
  const ensure = () => { if (current === null) current = loadUi(); return current }
  function persist() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      window.localStorage.setItem(DISPLAY_KEY, JSON.stringify({ v: 1, ui: current }))
    } catch { /* storage full or unavailable — keep in-memory */ }
  }
  function emit() { for (const fn of listeners) { try { fn() } catch { /* listener error */ } } }
  return {
    get() { return ensure() },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(patch) {
      const p = patch || {}
      const c = ensure()
      current = sanitizeUi({ ...c, ...p, show: { ...c.show, ...(p.show || {}) } })
      persist(); emit()
    },
    resetDisplay() {
      const c = ensure()
      current = sanitizeUi({ style: 'standard', show: {}, masked: c.masked, auto: c.auto })
      persist(); emit()
    },
  }
}

const uiStore = createUiStore()

// ---- styles ---------------------------------------------------------------

const css = [
  '.mgp-footstack{display:flex;flex-direction:column;gap:var(--mgp-gap,6px);padding:8px 10px 9px;border-top:1px solid var(--dsw-alias-border-l1,#2a2a2a);color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:1.35;max-height:min(38dvh,320px);overflow:auto;box-sizing:border-box;}',
  '.mgp-footstack > *{width:100%;box-sizing:border-box;min-width:0;}',
  '.mgp-footstack.rail{flex:0 0 auto;max-height:none;overflow:visible;border-top:none;padding:6px;}',
  '.mgp-footstack[data-density="normal"]{--mgp-gap:6px;--mgp-cellpad:6px 8px;--mgp-tval:16px;--mgp-chart:26px;}',
  '.mgp-footstack[data-density="tight"]{--mgp-gap:5px;--mgp-cellpad:5px 7px;--mgp-tval:15px;--mgp-chart:22px;}',
  '.mgp-footstack[data-density="short"]{--mgp-gap:4px;--mgp-cellpad:4px 6px;--mgp-tval:14px;--mgp-chart:18px;}',
  '.mgp-footstack[data-style="compact"]{--mgp-gap:4px;--mgp-cellpad:4px 6px;--mgp-tval:14px;--mgp-chart:18px;}',
  ':has(> [data-slot="sidebar.footer.action"] > .mgp-footstack){flex-wrap:wrap;}',
  '[data-slot="sidebar.footer.action"]:has(> .mgp-footstack){flex:1 1 100%;min-width:0;}',
  '[data-slot="sidebar.footer.action"]:has(> .mgp-footstack.rail){flex:0 0 auto;}',
  '.mgp-fhead{display:flex;align-items:center;gap:6px;}',
  '.mgp-ftitle{display:flex;align-items:center;gap:6px;font-weight:600;flex:1 1 auto;min-width:0;}',
  '.mgp-fbtn{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);cursor:pointer;font-size:13px;line-height:1;padding:3px 5px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;min-width:24px;min-height:24px;}',
  '.mgp-fbtn:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff14);color:var(--dsw-alias-label-primary,#e6e6e6);}',
  '.mgp-fbtn[aria-pressed="true"]{color:var(--dsw-alias-brand-primary,#7aa2ff);}',
  '.mgp-fbtn:disabled{opacity:.5;cursor:default;}',
  '.mgp-statusbtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:24px;min-width:24px;padding:3px 6px;margin:-3px -2px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);cursor:pointer;font-size:12px;line-height:1;flex:0 0 auto;transition:background .15s ease,color .15s ease;}',
  '.mgp-statusbtn:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff14);color:var(--dsw-alias-label-primary,#e6e6e6);}',
  '.mgp-statusbtn:disabled{opacity:.6;cursor:default;}',
  '.mgp-statusbtn-label{white-space:nowrap;}',
  '.mgp-statusbtn-compact{padding:3px;margin:-3px;min-width:24px;}',
  '.mgp-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-idle-primary,#666);}',
  '.mgp-dot-on{background:var(--dsw-alias-state-success-primary,#3fb950);}',
  '.mgp-dot-off{background:var(--dsw-alias-state-error-primary,#f85149);}',
  '.mgp-dot-paused{background:var(--dsw-alias-state-warn-primary,#d29922);}',
  '.mgp-dot-live{box-shadow:0 0 0 0 rgba(63,185,80,.5);animation:mgp-pulse 2s infinite;}',
  '@keyframes mgp-pulse{0%{box-shadow:0 0 0 0 rgba(63,185,80,.45);}70%{box-shadow:0 0 0 5px rgba(63,185,80,0);}100%{box-shadow:0 0 0 0 rgba(63,185,80,0);}}',
  '.mgp-latest{display:flex;flex-direction:column;gap:2px;width:100%;box-sizing:border-box;padding:var(--mgp-cellpad,6px 8px);background:var(--dsw-alias-bg-layer-1,#161616);border:1px solid var(--dsw-alias-border-l1,#2a2a2a);border-radius:8px;}',
  '.mgp-latest-top{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;}',
  '.mgp-latest-label{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#777);}',
  '.mgp-latest-route{font-family:var(--ds-font-family-code,monospace);font-size:11px;white-space:normal;overflow-wrap:anywhere;line-height:1.4;}',
  '.mgp-latest-meta{display:flex;gap:8px;font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-recent{display:flex;flex-direction:column;gap:3px;width:100%;}',
  '.mgp-rline{display:flex;align-items:center;gap:6px;font-size:11px;min-width:0;width:100%;}',
  '.mgp-rline-dim{opacity:.75;}',
  '.mgp-rmeta{margin-left:auto;display:flex;gap:6px;color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:10px;white-space:nowrap;}',
  '.mgp-tabs{display:flex;gap:4px;}',
  '.mgp-tab{appearance:none;border:1px solid var(--dsw-alias-border-l1,#2a2a2a);background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);cursor:pointer;font-size:10px;padding:3px 9px;min-height:24px;border-radius:999px;}',
  '.mgp-tab-on{background:var(--dsw-alias-brand-primary,#7aa2ff);border-color:var(--dsw-alias-brand-primary,#7aa2ff);color:#0d0d0d;font-weight:600;}',
  '.mgp-today{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--mgp-gap,6px);}',
  '.mgp-tcell{display:flex;flex-direction:column;gap:1px;padding:var(--mgp-cellpad,6px 8px);background:var(--dsw-alias-bg-layer-1,#161616);border:1px solid var(--dsw-alias-border-l1,#2a2a2a);border-radius:8px;min-width:0;}',
  '.mgp-tval{font-size:var(--mgp-tval,16px);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-tlab{font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-metrics{display:flex;flex-wrap:wrap;gap:8px;font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-metrics .mgp-warn{color:var(--dsw-alias-state-warn-primary,#d29922);}',
  '.mgp-chart{display:flex;align-items:flex-end;gap:2px;height:var(--mgp-chart,26px);}',
  '.mgp-bar{flex:1 1 0;min-width:2px;background:var(--dsw-alias-brand-primary,#7aa2ff);border-radius:2px 2px 0 0;min-height:2px;}',
  '.mgp-bar-err{background:var(--dsw-alias-state-warn-primary,#d29922);}',
  '.mgp-qwrap{display:flex;flex-direction:column;gap:5px;width:100%;}',
  '.mgp-qbar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px;width:100%;}',
  '.mgp-qname{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-qpct{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-spark{display:block;}',
  '.mgp-track{grid-column:1 / -1;height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-2,#222);overflow:hidden;}',
  '.mgp-fill{height:100%;background:var(--dsw-alias-state-success-primary,#3fb950);border-radius:3px;}',
  '.mgp-fill-warn{background:var(--dsw-alias-state-warn-primary,#d29922);}',
  '.mgp-fill-danger{background:var(--dsw-alias-state-error-primary,#f85149);}',
  '.mgp-expand{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);cursor:pointer;font-size:10px;padding:2px 0;min-height:24px;text-align:left;}',
  '.mgp-expand:hover{color:var(--dsw-alias-label-primary,#e6e6e6);}',
  '.mgp-detail{display:flex;flex-direction:column;gap:8px;width:100%;}',
  '.mgp-detail > *{width:100%;box-sizing:border-box;min-width:0;}',
  '.mgp-dhead{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#777);}',
  '.mgp-mline{display:flex;align-items:center;gap:6px;font-size:11px;width:100%;}',
  '.mgp-mono{font-family:var(--ds-font-family-code,monospace);}',
  '.mgp-muted{color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-req{display:flex;align-items:center;gap:5px;font-size:11px;min-width:0;}',
  '.mgp-arrow{color:var(--dsw-alias-label-tertiary,#777);}',
  '.mgp-served{font-family:var(--ds-font-family-code,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-num{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#9a9a9a);white-space:nowrap;}',
  '.mgp-status{width:6px;height:6px;border-radius:50%;flex:0 0 auto;}',
  '.mgp-status-ok{background:var(--dsw-alias-state-success-primary,#3fb950);}',
  '.mgp-status-err{background:var(--dsw-alias-state-error-primary,#f85149);}',
  '.mgp-empty{font-size:11px;color:var(--dsw-alias-label-tertiary,#777);}',
  '.mgp-banner{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#161616);border:1px solid var(--dsw-alias-state-error-primary,#f85149);font-size:11px;}',
  '.mgp-stale{padding:5px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#161616);border:1px solid var(--dsw-alias-state-warn-primary,#d29922);font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-banner-text{flex:1 1 auto;min-width:0;}',
  '.mgp-problems{font-size:10px;color:var(--dsw-alias-state-warn-primary,#d29922);}',
  '.mgp-retry{appearance:none;border:1px solid var(--dsw-alias-border-l2,#3a3a3a);background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;font-size:10px;padding:2px 8px;min-height:24px;border-radius:6px;}',
  '.mgp-updated{font-size:10px;color:var(--dsw-alias-label-tertiary,#777);}',
  '.mgp-railwrap{position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;cursor:default;}',
  '.mgp-railwrap:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff14);}',
  '.mgp-raildot{position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-radius:50%;border:1px solid var(--dsw-alias-bg-base,#0d0d0d);}',
  '.mgp-minimal{display:flex;align-items:center;gap:8px;font-size:12px;min-width:0;}',
  '.mgp-min-num{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#9a9a9a);white-space:nowrap;}',
  '.mgp-min-cost{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;}',
  '.mgp-min-quota{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  // ---- settings page ----
  '.mgp-set{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;line-height:1.5;padding:4px 2px 24px;max-width:920px;box-sizing:border-box;}',
  '.mgp-set-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:18px;}',
  '.mgp-set-headtext{display:flex;flex-direction:column;gap:3px;min-width:0;}',
  '.mgp-set-title{font-size:18px;font-weight:600;}',
  '.mgp-set-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-set-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start;}',
  '@media (max-width:760px){.mgp-set-grid{grid-template-columns:minmax(0,1fr);}}',
  '.mgp-set-col{display:flex;flex-direction:column;gap:16px;min-width:0;}',
  '.mgp-set-card{background:var(--dsw-alias-bg-layer-1,#161616);border:1px solid var(--dsw-alias-border-l1,#2a2a2a);border-radius:12px;padding:16px;}',
  '.mgp-set-cardtitle{font-size:13px;font-weight:600;margin:0 0 12px;}',
  '.mgp-style-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;}',
  '.mgp-style-card{position:relative;display:flex;flex-direction:column;gap:8px;align-items:stretch;text-align:left;appearance:none;cursor:pointer;background:var(--dsw-alias-bg-base,#0d0d0d);border:1px solid var(--dsw-alias-border-l1,#2a2a2a);border-radius:10px;padding:10px;color:inherit;font:inherit;}',
  '.mgp-style-card:hover{border-color:var(--dsw-alias-border-l2,#3a3a3a);}',
  '.mgp-style-card-on{border-color:var(--dsw-alias-brand-primary,#7aa2ff);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#7aa2ff);}',
  '.mgp-style-name{font-size:12px;font-weight:600;}',
  '.mgp-style-desc{font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);line-height:1.4;}',
  '.mgp-style-radio{position:absolute;top:8px;right:8px;width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,#3a3a3a);box-sizing:border-box;}',
  '.mgp-style-radio-on{border-color:var(--dsw-alias-brand-primary,#7aa2ff);background:var(--dsw-alias-brand-primary,#7aa2ff);box-shadow:inset 0 0 0 2px var(--dsw-alias-bg-base,#0d0d0d);}',
  '.mgp-mini{display:flex;flex-direction:column;gap:4px;height:56px;padding:6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#222);overflow:hidden;}',
  '.mgp-mini-head{display:flex;align-items:center;gap:4px;}',
  '.mgp-mini-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb950);flex:0 0 auto;}',
  '.mgp-mini-line{height:5px;flex:1 1 auto;border-radius:3px;background:var(--dsw-alias-border-l2,#3a3a3a);}',
  '.mgp-mini-cells{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;}',
  '.mgp-mini-cells i{height:12px;border-radius:3px;background:var(--dsw-alias-border-l1,#2a2a2a);}',
  '.mgp-mini-chart{display:flex;align-items:flex-end;gap:2px;height:14px;}',
  '.mgp-mini-chart i{flex:1 1 0;background:var(--dsw-alias-brand-primary,#7aa2ff);border-radius:1px;}',
  '.mgp-mini-bars{display:flex;flex-direction:column;gap:3px;}',
  '.mgp-mini-bars i{height:4px;border-radius:2px;background:var(--dsw-alias-state-success-primary,#3fb950);}',
  '.mgp-mini-compact{gap:3px;}',
  '.mgp-mini-minimal{flex-direction:row;align-items:center;height:56px;}',
  '.mgp-mini-minimal .mgp-mini-line{flex:1 1 auto;}',
  '.mgp-mini-pill{width:26px;height:10px;border-radius:5px;background:var(--dsw-alias-brand-primary,#7aa2ff);flex:0 0 auto;}',
  '.mgp-toggle-list{display:flex;flex-direction:column;}',
  '.mgp-toggle-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2a2a);}',
  '.mgp-toggle-row:last-child{border-bottom:none;}',
  '.mgp-toggle-text{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0;}',
  '.mgp-toggle-label{font-size:12px;}',
  '.mgp-toggle-desc{font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-switch{position:relative;appearance:none;border:none;cursor:pointer;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l2,#3a3a3a);flex:0 0 auto;padding:0;transition:background .15s;}',
  '.mgp-switch-on{background:var(--dsw-alias-brand-primary,#7aa2ff);}',
  '.mgp-switch:disabled{opacity:.5;cursor:default;}',
  '.mgp-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;}',
  '.mgp-switch-on .mgp-switch-thumb{left:18px;}',
  '.mgp-field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;}',
  '.mgp-field{display:flex;flex-direction:column;gap:5px;min-width:0;}',
  '.mgp-field-label{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  '.mgp-field-hint{font-size:10px;color:var(--dsw-alias-label-tertiary,#777);}',
  '.mgp-input,.mgp-select{appearance:none;width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base,#0d0d0d);border:1px solid var(--dsw-alias-border-l1,#2a2a2a);border-radius:8px;color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:12px;padding:7px 9px;}',
  '.mgp-input:focus,.mgp-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#7aa2ff);}',
  '.mgp-input:disabled,.mgp-select:disabled{opacity:.6;}',
  '.mgp-field-inline{display:flex;align-items:center;gap:8px;}',
  '.mgp-note{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-base,#0d0d0d);border:1px solid var(--dsw-alias-border-l1,#2a2a2a);}',
  '.mgp-set-actions{display:flex;align-items:center;gap:10px;margin-top:12px;}',
  '.mgp-btn{appearance:none;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#3a3a3a);background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:12px;padding:6px 12px;border-radius:8px;}',
  '.mgp-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff14);}',
  '.mgp-saved{font-size:11px;color:var(--dsw-alias-state-success-primary,#3fb950);}',
  '.mgp-set-preview{position:sticky;top:12px;display:flex;flex-direction:column;gap:8px;}',
  '.mgp-set-preview-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;}',
  '.mgp-preview-frame{border:1px solid var(--dsw-alias-border-l1,#2a2a2a);border-radius:12px;background:var(--dsw-alias-bg-base,#0d0d0d);overflow:hidden;}',
  '.mgp-preview-frame .mgp-footstack{border-top:none;max-height:340px;}',
  '.mgp-preview-note{font-size:10px;color:var(--dsw-alias-label-tertiary,#777);}',
  '.mgp-set-fallback{padding:16px;font-size:12px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  // ---- readability floor: no data text below 12px, values keep their own scale ----
  '.mgp-latest-label,.mgp-latest-meta,.mgp-latest-route,.mgp-rmeta,.mgp-tab,.mgp-tlab,.mgp-metrics,.mgp-expand,.mgp-dhead,.mgp-stale,.mgp-problems,.mgp-retry,.mgp-updated,.mgp-min-quota{font-size:12px;}',
  '.mgp-qname,.mgp-qpct,.mgp-rline,.mgp-mline,.mgp-req,.mgp-empty,.mgp-banner{font-size:12px;}',
  '.mgp-style-name,.mgp-toggle-label{font-size:13px;}',
  '.mgp-style-desc,.mgp-toggle-desc,.mgp-field-label,.mgp-field-hint,.mgp-note,.mgp-preview-note,.mgp-saved{font-size:12px;}',
  '.mgp-switch{width:44px;height:24px;}',
  '.mgp-switch-thumb{width:20px;height:20px;}',
  '.mgp-switch-on .mgp-switch-thumb{left:22px;}',
  '.mgp-set{max-width:1100px;}',
  '.mgp-set-grid{grid-template-columns:minmax(0,1fr) 340px;}',
  '@media (max-width:760px){.mgp-set-grid{grid-template-columns:minmax(0,1fr);}}',
  '@media (max-width:480px){.mgp-style-grid{grid-template-columns:1fr;}}',
].join('\n')

// ---- plugin ---------------------------------------------------------------

window.__ModuleLoader__.load({
  id: '@local/dsh-magpie-monitor',

  factory(require) {
    const React = require('react')
    const h = React.createElement

    class SlotErrorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false } }
      static getDerivedStateFromError() { return { failed: true } }
      componentDidCatch(err) { try { console.error('[dsh-magpie-monitor]', err) } catch { /* noop */ } }
      render() {
        if (this.state.failed) return this.props.fallback || null
        return this.props.children
      }
    }

    return {
      name: NS,
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), NS + ': locale')
        const t = ctx.locale.bind(NS)

        function useLocaleTick() {
          const [, force] = React.useReducer((x) => x + 1, 0)
          React.useEffect(() => ctx.locale.subscribe(force), [])
        }

        function MagpieIcon({ size, active }) {
          const s = size || 18
          return h('svg', {
            width: s, height: s, viewBox: '0 0 64 64', fill: 'none',
            'aria-hidden': true, style: { flex: '0 0 auto', opacity: active === false ? 0.55 : 1 },
          },
            h('path', { d: 'M14 40c0-12 9-22 21-22 7 0 12 3 15 8l8-3-5 8c1 2 1 4 1 6 0 12-9 21-21 21-6 0-11-2-15-6l-9 3 5-8c-1-2-1-4-1-7z', fill: 'var(--dsw-alias-brand-primary,#7aa2ff)' }),
            h('circle', { cx: 40, cy: 30, r: 2.4, fill: 'var(--dsw-alias-bg-base,#0d0d0d)' }),
            h('path', { d: 'M20 44c4 3 9 4 14 3', stroke: 'var(--dsw-alias-bg-base,#0d0d0d)', strokeWidth: 2, strokeLinecap: 'round' }),
          )
        }

        function useDensity() {
          const calc = () => {
            const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
            const cap = Math.min(vh * 0.38, 320)
            return cap < 180 ? 'short' : cap < 260 ? 'tight' : 'normal'
          }
          const [density, setDensity] = React.useState(calc)
          React.useEffect(() => {
            let raf = 0
            const onResize = () => {
              if (raf) return
              raf = requestAnimationFrame(() => { raf = 0; setDensity(calc()) })
            }
            window.addEventListener('resize', onResize)
            return () => { window.removeEventListener('resize', onResize); if (raf) cancelAnimationFrame(raf) }
          }, [])
          return density
        }

        const ROW_LIMITS = {
          normal: { recent: 3, quota: 2, more: 6, moreQuota: 6 },
          tight: { recent: 2, quota: 2, more: 5, moreQuota: 4 },
          short: { recent: 2, quota: 1, more: 4, moreQuota: 3 },
        }

        function useUi() {
          const [ui, setUi] = React.useState(uiStore.get)
          React.useEffect(() => uiStore.subscribe(() => setUi(uiStore.get())), [])
          return ui
        }

        // ---- data hook ----
        function useMonitor() {
          const persisted = loadPersisted()
          const ui = useUi()
          const auto = ui.auto
          const masked = ui.masked
          const [snap, setSnap] = React.useState(persisted.snap)
          const [updatedAt, setUpdatedAt] = React.useState(persisted.savedAt)
          const [failed, setFailed] = React.useState(false)
          const [period, setPeriod] = React.useState(persisted.prefs.period)
          const [manualBusy, setManualBusy] = React.useState(false)

          const cfgRef = React.useRef(null)
          const busyRef = React.useRef(false)
          const pendingRef = React.useRef(null)
          const aliveRef = React.useRef(true)
          const abortRef = React.useRef(null)
          const lastSaveRef = React.useRef(0)
          const snapRef = React.useRef(snap)
          const autoRef = React.useRef(auto)
          const maskedRef = React.useRef(masked)
          const periodRef = React.useRef(period)
          snapRef.current = snap
          autoRef.current = auto
          maskedRef.current = masked
          periodRef.current = period

          const hostPeriod = snap && snap.config ? snap.config.period : 'today'
          const effPeriod = period || hostPeriod

          const persist = React.useCallback((force, snapOverride) => {
            const now = Date.now()
            if (!force && now - lastSaveRef.current < SAVE_EVERY_MS) return
            lastSaveRef.current = now
            try {
              if (typeof window === 'undefined' || !window.localStorage) return
              const s = snapOverride !== undefined ? snapOverride : snapRef.current
              const env = { v: 1, savedAt: now, prefs: { period: periodRef.current, masked: maskedRef.current, auto: autoRef.current }, snap: s }
              const text = JSON.stringify(env)
              if (text.length > SAVE_MAX_CHARS) { env.snap = null; window.localStorage.setItem(STORE_KEY, JSON.stringify(env)) }
              else window.localStorage.setItem(STORE_KEY, text)
            } catch { /* storage unavailable */ }
          }, [])

          const refresh = React.useCallback((manual) => {
            if (busyRef.current) { pendingRef.current = manual || pendingRef.current; return }
            busyRef.current = true
            if (manual) setManualBusy(true)
            const controller = new AbortController()
            abortRef.current = controller
            const cfg = cfgRef.current
            const p = periodRef.current || (cfg && cfg.period) || 'today'
            const recent = (cfg && cfg.requestLimit) || 40
            const url = API + '/snapshot?period=' + encodeURIComponent(p) + '&recent=' + encodeURIComponent(recent) + (manual ? '&fresh=1' : '')
            getJson(url, controller.signal).then((res) => {
              if (!aliveRef.current) return
              const clean = sanitizeSnapshot(res)
              if (!clean) { setFailed(true); return }
              cfgRef.current = clean.config
              setSnap(clean)
              setUpdatedAt(clean.fetchedAt || Date.now())
              setFailed(false)
              persist(false, clean)
            }).catch((err) => {
              if (!aliveRef.current) return
              if (err && err.name === 'AbortError') return
              setFailed(true)
            }).finally(() => {
              busyRef.current = false
              abortRef.current = null
              if (aliveRef.current) setManualBusy(false)
              const next = pendingRef.current
              pendingRef.current = null
              if (next !== null && aliveRef.current) refresh(next)
            })
          }, [persist])

          React.useEffect(() => { aliveRef.current = true; refresh(false); return () => { aliveRef.current = false } }, [refresh])

          const refreshMs = (snap && snap.config && snap.config.refreshMs) || 5000
          React.useEffect(() => {
            if (!auto) return undefined
            const id = setInterval(() => {
              if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
              refresh(false)
            }, Math.max(1000, refreshMs))
            return () => clearInterval(id)
          }, [auto, refreshMs, refresh])

          React.useEffect(() => {
            const onVis = () => {
              if (document.visibilityState === 'visible') refresh(false)
              else persist(true)
            }
            document.addEventListener('visibilitychange', onVis)
            return () => document.removeEventListener('visibilitychange', onVis)
          }, [refresh, persist])

          const changePeriod = React.useCallback((p) => {
            if (PERIODS.indexOf(p) < 0) return
            setPeriod(p); periodRef.current = p
            persist(true)
            refresh(true)
          }, [persist, refresh])

          const toggleMask = React.useCallback(() => {
            uiStore.set({ masked: !maskedRef.current })
            setTimeout(() => persist(true), 0)
          }, [persist])

          const toggleAuto = React.useCallback(() => {
            uiStore.set({ auto: !autoRef.current })
            setTimeout(() => persist(true), 0)
          }, [persist])

          React.useEffect(() => () => {
            aliveRef.current = false
            if (abortRef.current) { try { abortRef.current.abort() } catch { /* noop */ } }
            persist(true)
          }, [persist])

          return { snap, updatedAt, failed, auto, toggleAuto, period, changePeriod, masked, toggleMask, manualBusy, refresh }
        }

        // ---- small presentation pieces ----
        function StatusDot({ online, live }) {
          return h('span', { className: 'mgp-dot ' + (online ? 'mgp-dot-on' : 'mgp-dot-off') + (live && online ? ' mgp-dot-live' : '') })
        }
        // One control carries both the connection state and the refresh affordance:
        // the dot says live / paused / offline, clicking it always refreshes now.
        function StatusButton({ online, auto, busy, compact, onRefresh }) {
          const mode = !online ? 'offline' : busy ? 'busy' : auto ? 'live' : 'paused'
          const label = mode === 'offline' ? t('status.offline')
            : mode === 'busy' ? t('update.busy')
              : mode === 'live' ? t('status.live') : t('status.paused')
          const hint = mode === 'offline' ? t('update.offline')
            : mode === 'busy' ? t('update.busy')
              : mode === 'live' ? t('update.live') : t('update.paused')
          const dotCls = 'mgp-dot ' + (mode === 'offline' ? 'mgp-dot-off'
            : mode === 'paused' ? 'mgp-dot-paused' : 'mgp-dot-on') + (mode === 'live' ? ' mgp-dot-live' : '')
          return h('button', {
            type: 'button',
            className: 'mgp-statusbtn' + (compact ? ' mgp-statusbtn-compact' : ''),
            title: hint,
            'aria-label': hint,
            disabled: !!busy,
            onClick: onRefresh,
          }, h('span', { className: dotCls }), compact ? null : h('span', { className: 'mgp-statusbtn-label' }, label))
        }
        function rateOf(row) {
          const out = Number(row && row.out) || 0
          const ms = Number(row && row.ms) || 0
          return out > 0 && ms > 0 ? Math.round(out / (ms / 1000)) : 0
        }
        function StatusChip({ row }) {
          const ok = statusOk(row && row.status)
          return h('span', { className: 'mgp-status ' + (ok ? 'mgp-status-ok' : 'mgp-status-err') })
        }
        function RouteLine({ row, dim, masked, symbol }) {
          if (!row) return null
          const served = servedOf(row)
          const req = row.req || row.model || ''
          const cost = row.priced ? (symbol || '$') + Number(row.cost || 0).toFixed(2) : ''
          const title = [req + ' → ' + served, t('req.ttft') + ' ' + fmtMs(row.ttftMs), t('req.cache') + ' ' + fmtCompact(row.cacheRead), fmtCompact(row.in) + '→' + fmtCompact(row.out)].join(' · ')
          return h('div', { className: 'mgp-req' + (dim ? ' mgp-rline-dim' : ''), title },
            h(StatusChip, { row }),
            h('span', { className: 'mgp-served', style: { flex: '0 1 auto' } }, served || req),
            row.req && row.served && row.req !== row.served ? h('span', { className: 'mgp-arrow' }, '←') : null,
            row.req && row.served && row.req !== row.served ? h('span', { className: 'mgp-muted', style: { fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, row.req) : null,
            h('span', { className: 'mgp-num' }, masked ? '••••' : cost),
          )
        }
        function Spark({ points }) {
          if (!points || points.length < 2) return null
          const w = 40, ht = 12
          const xs = points.map((p, i) => (i / (points.length - 1)) * w)
          const ys = points.map((p) => ht - (Math.max(0, Math.min(100, Number(p.left) || 0)) / 100) * ht)
          const d = xs.map((x, i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ')
          return h('svg', { className: 'mgp-spark', width: w, height: ht, viewBox: '0 0 ' + w + ' ' + ht, 'aria-hidden': true },
            h('path', { d, fill: 'none', stroke: 'var(--dsw-alias-brand-primary,#7aa2ff)', strokeWidth: 1.2 }))
        }
        function QuotaBar({ q, w, spark, masked }) {
          const pct = Math.max(0, Math.min(100, Number(w.used) || 0))
          const remaining = 100 - pct
          const cls = remaining <= 10 ? 'mgp-fill-danger' : remaining <= 30 ? 'mgp-fill-warn' : ''
          const acct = q.alias || q.user || q.name
          const title = [
            t('quota.account') + ': ' + (masked ? maskAccount(acct) : shortAccount(acct)),
            q.plan ? t('quota.plan') + ': ' + q.plan : '',
            w.display || '',
            w.resetsAt ? t('quota.resets') + ': ' + fmtClock(w.resetsAt) : '',
            w.runsOutAt ? t('quota.expires') + ': ' + fmtClock(w.runsOutAt) : '',
          ].filter(Boolean).join(' · ')
          return h('div', { className: 'mgp-qbar', title, role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': w.name },
            h('span', { className: 'mgp-qname' }, (q.provider ? q.provider + ' · ' : '') + w.name),
            spark ? h(Spark, { points: spark }) : null,
            h('span', { className: 'mgp-qpct' }, pct.toFixed(0) + '%'),
            h('div', { className: 'mgp-track' }, h('div', { className: 'mgp-fill ' + cls, style: { width: pct + '%' } })),
          )
        }
        function collectQuotas(quotas, history, limit) {
          const out = []
          const hist = Array.isArray(history) ? history : []
          for (const q of (quotas || [])) {
            for (const w of (q.windows || [])) {
              let spark = null
              const acct = hist.find((a) => a.provider === q.provider && a.user === q.user)
              if (acct) {
                const line = (acct.lines || []).find((l) => l.name === w.name)
                if (line && line.points && line.points.length >= 2) spark = line.points
              }
              out.push({ q, w, spark })
            }
          }
          out.sort((a, b) => (Number(b.w.used) || 0) - (Number(a.w.used) || 0))
          return out.slice(0, limit)
        }
        function MiniChart({ series, masked, symbol }) {
          if (!series || !series.length) return null
          const max = Math.max(1, ...series.map((b) => Number(b.calls) || 0))
          return h('div', { className: 'mgp-chart', role: 'img', 'aria-label': 'activity' },
            series.map((b, i) => {
              const calls = Number(b.calls) || 0
              const ht = Math.max(8, (calls / max) * 100)
              const cost = (symbol || '$') + Number(b.cost || 0).toFixed(2)
              const title = t('chart.tip', { label: b.label || '', calls: fmtInt(calls), cost: masked ? '••••' : cost })
              return h('div', {
                key: i, className: 'mgp-bar' + ((Number(b.errors) || 0) > 0 ? ' mgp-bar-err' : ''),
                style: { height: ht + '%', opacity: calls > 0 ? 1 : 0.25 }, title,
              })
            }))
        }
        function ModelLine({ m, masked, symbol }) {
          const cost = (symbol || '$') + Number(m.cost || 0).toFixed(2)
          return h('div', { className: 'mgp-mline' },
            h('span', { className: 'mgp-served', style: { flex: '1 1 auto' } }, m.name || m.model || m.id),
            h('span', { className: 'mgp-muted', style: { fontSize: '10px', whiteSpace: 'nowrap' } }, fmtCompact(m.calls) + ' ' + t('usage.calls')),
            h('span', { className: 'mgp-num', style: { marginLeft: '6px' } }, masked ? '••••' : cost),
          )
        }
        function PeriodTabs({ value, onChange }) {
          return h('div', { className: 'mgp-tabs', role: 'tablist' },
            PERIODS.map((p) => h('button', {
              key: p, type: 'button', role: 'tab', 'aria-selected': value === p,
              className: 'mgp-tab' + (value === p ? ' mgp-tab-on' : ''), onClick: () => onChange(p),
            }, t('period.' + p))))
        }

        // ---- pure presentation (shared by footer + settings preview) ----
        function MagpieBody(props) {
          const snap = props.snap
          const display = props.display || { style: 'standard', show: {} }
          const show = display.show || {}
          const style = STYLES.indexOf(display.style) >= 0 ? display.style : 'standard'
          const masked = props.masked
          const auto = props.auto
          const density = props.density || 'normal'
          const expanded = props.expanded
          const usage = snap && snap.usage
          const health = snap && snap.health
          const currency = (snap && snap.currency) || { symbol: '$' }
          const symbol = currency.symbol || '$'
          const online = health && health.name === 'magpie' && !props.failed
          const cash = (v) => (masked ? '••••' : symbol + Number(v || 0).toFixed(2))
          const effDensity = style === 'compact' ? 'tight' : density
          const limits = ROW_LIMITS[effDensity] || ROW_LIMITS.normal
          const quotas = collectQuotas(snap && snap.quotas, snap && snap.history, expanded ? limits.moreQuota : limits.quota)
          const requests = (snap && snap.requests) || []
          const models = (snap && snap.models) || []
          const series = (snap && snap.series) || []
          const latest = requests[0]
          const periodLabel = t('period.' + (props.period || 'today'))

          // minimal: a single summary line
          if (style === 'minimal') {
            const top = quotas[0]
            return h('div', { className: 'mgp-footstack', 'data-style': 'minimal', 'data-density': density },
              h('style', null, css),
              h('div', { className: 'mgp-minimal' },
                h(MagpieIcon, { size: 15, active: online }),
                show.usage && usage ? h('span', { className: 'mgp-min-num' }, periodLabel + ' ' + fmtCompact(usage.calls)) : null,
                show.usage && usage ? h('span', { className: 'mgp-min-cost' }, cash(usage.cost)) : null,
                show.quotas && top ? h('span', { className: 'mgp-min-quota', title: top.w.name }, top.w.name + ' ' + (Number(top.w.used) || 0).toFixed(0) + '%') : null,
                h(StatusButton, { online, auto, busy: props.manualBusy, compact: true, onRefresh: props.onRefresh }),
              ))
          }

          const showUsageSection = (show.usage || show.metrics || show.chart) && usage
          const showExpand = show.requests || show.models || show.quotas
          const dataStyle = style === 'compact' ? 'compact' : undefined

          return h('div', { className: 'mgp-footstack', 'data-density': density, 'data-style': dataStyle },
            h('style', null, css),
            // header
            h('div', { className: 'mgp-fhead' },
              h('div', { className: 'mgp-ftitle' },
                h(MagpieIcon, { size: 16, active: online }),
                h('span', null, t('widget.title')),
              ),
              h('button', { type: 'button', className: 'mgp-fbtn', title: t('btn.mask'), 'aria-pressed': masked, onClick: props.onToggleMask, 'aria-label': t('btn.mask') }, '◐'),
              h(StatusButton, { online, auto, busy: props.manualBusy, onRefresh: props.onRefresh }),
            ),
            // failure banners
            props.failed && !snap ? h('div', { className: 'mgp-banner' },
              h('span', { className: 'mgp-banner-text' }, t('banner.first')),
              h('button', { type: 'button', className: 'mgp-retry', onClick: props.onRefresh }, t('retry')),
            ) : null,
            props.failed && snap ? h('div', { className: 'mgp-stale' }, t('stale', { time: fmtRelative(props.updatedAt) })) : null,
            snap && snap.problems && snap.problems.length ? h('div', { className: 'mgp-problems' }, t('problems') + ': ' + snap.problems.join('; ')) : null,
            // latest route
            show.route ? h('div', { className: 'mgp-latest' },
              h('div', { className: 'mgp-latest-top' },
                h('span', { className: 'mgp-latest-label' }, t('latest')),
                latest ? h('span', { className: 'mgp-latest-meta', title: t('latest.rate') + ' · ' + t('req.ttft') + ' ' + fmtMs(latest.ttftMs) }, h(StatusChip, { row: latest }), h('span', null, rateOf(latest) > 0 ? fmtInt(rateOf(latest)) + ' ' + t('metrics.tps') : '—')) : null,
              ),
              latest ? h('div', { className: 'mgp-latest-route' }, (latest.req || latest.model || '') + ' → ' + servedOf(latest)) : h('div', { className: 'mgp-empty' }, t('latest.none')),
            ) : null,
            // usage section
            showUsageSection ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--mgp-gap,6px)' } },
              show.usage ? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
                h(PeriodTabs, { value: props.period || 'today', onChange: props.onChangePeriod }),
              ) : null,
              show.usage ? h('div', { className: 'mgp-today' },
                h('div', { className: 'mgp-tcell' }, h('span', { className: 'mgp-tval' }, fmtCompact(usage.calls)), h('span', { className: 'mgp-tlab' }, t('usage.calls'))),
                h('div', { className: 'mgp-tcell' }, h('span', { className: 'mgp-tval' }, fmtCompact((Number(usage.input) || 0) + (Number(usage.output) || 0))), h('span', { className: 'mgp-tlab' }, t('usage.tokens'))),
                h('div', { className: 'mgp-tcell' }, h('span', { className: 'mgp-tval' }, cash(usage.cost)), h('span', { className: 'mgp-tlab' }, t('usage.cost'))),
              ) : null,
              show.metrics ? h('div', { className: 'mgp-metrics' },
                h('span', { className: (Number(usage.errors) || 0) > 0 ? 'mgp-warn' : '' }, t('metrics.errors') + ' ' + fmtInt(usage.errors)),
                h('span', null, t('metrics.ttft') + ' ' + fmtMs(usage.avgTtftMs)),
                h('span', null, fmtInt(usage.avgTokensPerSecond) + ' ' + t('metrics.tps')),
                h('span', null, t('metrics.cache') + ' ' + (Number(usage.cacheHitPct) || 0).toFixed(0) + '%'),
              ) : null,
              show.chart ? h(MiniChart, { series, masked, symbol }) : null,
            ) : null,
            // quota bars
            show.quotas ? h('div', { className: 'mgp-qwrap' },
              quotas.length ? quotas.map((item, i) => h(QuotaBar, { key: i, q: item.q, w: item.w, spark: show.spark ? item.spark : null, masked })) : h('div', { className: 'mgp-empty' }, t('quota.none')),
            ) : null,
            // expand / details
            showExpand ? h('button', { type: 'button', className: 'mgp-expand', onClick: props.onToggleExpand, 'aria-expanded': expanded }, expanded ? '▾ ' + t('expand.less') : '▸ ' + t('expand.more')) : null,
            showExpand && expanded ? h('div', { className: 'mgp-detail' },
              show.requests ? h('div', null,
                h('div', { className: 'mgp-dhead' }, t('detail.recent')),
                h('div', { className: 'mgp-recent' },
                  requests.length ? requests.slice(0, limits.more).map((r, i) => h(RouteLine, { key: i, row: r, dim: i > 0, masked, symbol })) : h('div', { className: 'mgp-empty' }, t('empty.recent')),
                )) : null,
              show.models ? h('div', null,
                h('div', { className: 'mgp-dhead' }, t('detail.models')),
                models.length ? models.slice(0, limits.more).map((m, i) => h(ModelLine, { key: i, m, masked, symbol })) : h('div', { className: 'mgp-empty' }, t('empty.models')),
              ) : null,
              show.quotas ? h('div', null,
                h('div', { className: 'mgp-dhead' }, t('detail.quota')),
                h('div', { className: 'mgp-qwrap' },
                  collectQuotas(snap && snap.quotas, snap && snap.history, limits.moreQuota + 6).map((item, i) => h(QuotaBar, { key: i, q: item.q, w: item.w, spark: show.spark ? item.spark : null, masked })),
                )) : null,
            ) : null,
            // updated
            props.updatedAt ? h('div', { className: 'mgp-updated' }, t('updated', { time: fmtClock(props.updatedAt) })) : null,
          )
        }

        // ---- footer widget ----
        function MagpieFooter(props) {
          useLocaleTick()
          const wide = props && props.wide
          const mon = useMonitor()
          const density = useDensity()
          const ui = useUi()
          const [expanded, setExpanded] = React.useState(false)
          const display = { style: ui.style, show: ui.show }

          if (!wide) {
            const usage = mon.snap && mon.snap.usage
            const health = mon.snap && mon.snap.health
            const online = health && health.name === 'magpie' && !mon.failed
            const symbol = (mon.snap && mon.snap.currency && mon.snap.currency.symbol) || '$'
            const calls = usage ? fmtCompact(usage.calls) : '0'
            const cost = usage ? (mon.masked ? '••••' : symbol + Number(usage.cost || 0).toFixed(2)) : ''
            const latest = mon.snap && mon.snap.requests && mon.snap.requests[0]
            const model = latest ? servedOf(latest) : ''
            const tip = t('rail.tip', { calls, cost, model })
            return h('div', { className: 'mgp-footstack rail' },
              h('style', null, css),
              h('div', { className: 'mgp-railwrap', title: tip },
                h(MagpieIcon, { size: 20, active: online }),
                h('span', { className: 'mgp-raildot ' + (online ? 'mgp-dot-on' : 'mgp-dot-off') }),
              ))
          }

          return h(MagpieBody, {
            snap: mon.snap, updatedAt: mon.updatedAt, failed: mon.failed, auto: mon.auto,
            period: mon.period || (mon.snap && mon.snap.config && mon.snap.config.period) || 'today',
            masked: mon.masked, manualBusy: mon.manualBusy, density, display, expanded,
            onToggleMask: mon.toggleMask, onToggleAuto: mon.toggleAuto, onRefresh: () => mon.refresh(true),
            onChangePeriod: mon.changePeriod, onToggleExpand: () => setExpanded((x) => !x),
          })
        }

        const footerFallback = h('div', { className: 'mgp-set-fallback' }, 'Magpie widget unavailable')
        const MagpieFooterSafe = (props) => h(SlotErrorBoundary, { fallback: footerFallback }, h(MagpieFooter, props))

        // ---- settings page ----
        function Switch({ checked, onChange, label, disabled }) {
          return h('button', {
            type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
            className: 'mgp-switch' + (checked ? ' mgp-switch-on' : ''), disabled,
            onClick: () => onChange(!checked),
          }, h('span', { className: 'mgp-switch-thumb' }))
        }
        function ToggleRow({ label, desc, checked, onChange, disabled }) {
          return h('div', { className: 'mgp-toggle-row' },
            h('div', { className: 'mgp-toggle-text' },
              h('span', { className: 'mgp-toggle-label' }, label),
              desc ? h('span', { className: 'mgp-toggle-desc' }, desc) : null),
            h(Switch, { checked, onChange, label, disabled }))
        }
        function StyleMini({ style }) {
          if (style === 'minimal') {
            return h('div', { className: 'mgp-mini mgp-mini-minimal' },
              h('span', { className: 'mgp-mini-dot' }), h('span', { className: 'mgp-mini-line' }), h('span', { className: 'mgp-mini-pill' }))
          }
          const bars = [40, 70, 55, 90, 60, 80, 45]
          return h('div', { className: 'mgp-mini' + (style === 'compact' ? ' mgp-mini-compact' : '') },
            h('div', { className: 'mgp-mini-head' }, h('span', { className: 'mgp-mini-dot' }), h('span', { className: 'mgp-mini-line' })),
            h('div', { className: 'mgp-mini-cells' }, h('i'), h('i'), h('i')),
            style === 'standard' ? h('div', { className: 'mgp-mini-chart' }, bars.map((b, i) => h('i', { key: i, style: { height: b + '%' } }))) : null,
            h('div', { className: 'mgp-mini-bars' }, h('i', { style: { width: '70%' } }), h('i', { style: { width: '45%' } })))
        }
        function StyleCard({ style, active, onSelect }) {
          return h('button', {
            type: 'button', role: 'radio', 'aria-checked': active,
            className: 'mgp-style-card' + (active ? ' mgp-style-card-on' : ''), onClick: () => onSelect(style),
          },
            h('span', { className: 'mgp-style-radio' + (active ? ' mgp-style-radio-on' : '') }),
            h(StyleMini, { style }),
            h('span', { className: 'mgp-style-name' }, t('settings.style.' + style)),
            h('span', { className: 'mgp-style-desc' }, t('settings.style.' + style + '.desc')))
        }
        // Hook-free input: draft state lives in MagpieSettings so this stays a
        // pure host element (the slot renderer flattens children without a hook
        // dispatcher). Commits on blur / Enter.
        function ConfigInput({ value, onChange, onBlur, onEnter, type, disabled, step, min, max }) {
          return h('input', {
            type: type || 'text', className: 'mgp-input', value, disabled, step, min, max,
            onChange, onBlur,
            onKeyDown: (e) => { if (e.key === 'Enter' && onEnter) onEnter() },
          })
        }
        function Field({ label, hint, children }) {
          return h('label', { className: 'mgp-field' },
            h('span', { className: 'mgp-field-label' }, label),
            children,
            hint ? h('span', { className: 'mgp-field-hint' }, hint) : null)
        }

        function useConfigForm() {
          const ctrlRef = React.useRef(null)
          const [state, setState] = React.useState(() => {
            if (!ctx.configForms || typeof ctx.configForms.get !== 'function') return { status: 'unavailable', value: null, writable: false }
            try { const c = ctx.configForms.get(WIDGET_ID); ctrlRef.current = c; return c.getSnapshot() }
            catch { return { status: 'unavailable', value: null, writable: false } }
          })
          React.useEffect(() => {
            const c = ctrlRef.current
            if (!c || typeof c.subscribe !== 'function') return undefined
            return c.subscribe(() => setState(c.getSnapshot()))
          }, [])
          const setField = React.useCallback((field, value) => {
            const c = ctrlRef.current
            if (c && typeof c.set === 'function') return c.set(field, value)
            return Promise.resolve(false)
          }, [])
          return { state, setField }
        }

        // sample data for the live preview (already in sanitized shape)
        const SAMPLE_SNAPSHOT = sanitizeSnapshot({
          ok: true, gateway: 'http://127.0.0.1:3425', fetchedAt: Date.now(), period: 'today',
          config: { gatewayUrl: 'http://127.0.0.1:3425', refreshMs: 5000, requestLimit: 40, period: 'today', cnyRate: 0, tool: true },
          currency: { code: 'USD', symbol: '$', rate: 1 },
          health: { name: 'magpie', version: '0.1.4207', serves: 'tray', models: 10 },
          usage: { period: 'today', bucket: 'hour', calls: 863, errors: 2, input: 1200000, output: 340000, cacheRead: 900000, cost: 2.65, avgTtftMs: 5293, avgTokensPerSecond: 83, cacheHitPct: 92 },
          series: [
            { label: '08', calls: 40, errors: 0, cost: 0.1 }, { label: '09', calls: 90, errors: 1, cost: 0.3 },
            { label: '10', calls: 120, errors: 0, cost: 0.4 }, { label: '11', calls: 70, errors: 0, cost: 0.2 },
            { label: '12', calls: 30, errors: 0, cost: 0.1 }, { label: '13', calls: 110, errors: 1, cost: 0.35 },
            { label: '14', calls: 150, errors: 0, cost: 0.5 }, { label: '15', calls: 95, errors: 0, cost: 0.3 },
          ],
          quotas: [
            { provider: 'qoder', name: 'Qoder', plan: 'Pro', user: 'u1', alias: '134****3762', windows: [{ name: '5h', used: 38.6, remaining: 61.4, display: '1156577 / 3000000', resetsAt: Date.now() + 3600000 }, { name: 'Weekly', used: 72, remaining: 28, display: '7.2M / 10M' }] },
            { provider: 'anthropic', name: 'Claude', plan: 'Max', user: 'u2', alias: 'dev@example.com', windows: [{ name: '5h', used: 12, remaining: 88, display: '120 / 1000' }] },
          ],
          history: [
            { provider: 'qoder', user: 'u1', lines: [{ name: '5h', points: [{ at: 1, left: 90 }, { at: 2, left: 75 }, { at: 3, left: 68 }, { at: 4, left: 61 }] }] },
          ],
          models: [
            { id: 'glm-5.3', name: 'glm-5.3', model: 'glm-5.3', calls: 400, cost: 1.4 },
            { id: 'claude', name: 'claude-opus', model: 'claude-opus', calls: 200, cost: 0.9 },
            { id: 'gpt', name: 'gpt-5', model: 'gpt-5', calls: 120, cost: 0.35 },
          ],
          requests: [
            { route_id: 'r1', t: Date.now(), req: 'glm-5.3', served: 'glm-5.3', model: 'glm-5.3', in: 12000, out: 3000, cacheRead: 9000, ms: 4200, ttftMs: 800, status: 200, cost: 0.05, priced: true },
            { route_id: 'r2', t: Date.now(), req: 'claude-opus', served: 'glm-5.3', model: 'claude-opus', in: 8000, out: 2000, cacheRead: 4000, ms: 3100, ttftMs: 600, status: 200, cost: 0.03, priced: true },
            { route_id: 'r3', t: Date.now(), req: 'gpt-5', served: 'gpt-5', model: 'gpt-5', in: 5000, out: 1500, cacheRead: 2000, ms: 2600, ttftMs: 500, status: 500, cost: 0, priced: false },
          ],
          problems: [],
        })

        function MagpieSettings() {
          useLocaleTick()
          const ui = useUi()
          const { state: cfgState, setField } = useConfigForm()
          const [previewExpanded, setPreviewExpanded] = React.useState(false)
          const [savedFlash, setSavedFlash] = React.useState(false)
          const flashTimer = React.useRef(0)
          const cfg = (cfgState.status === 'ready' && cfgState.value) ? cfgState.value : null
          const writable = !!(cfg && cfgState.writable)
          const noop = () => {}
          const [drafts, setDrafts] = React.useState({})
          const draftVal = (f) => (f in drafts ? drafts[f] : String(cfg && cfg[f] != null ? cfg[f] : ''))
          const editDraft = (f) => (e) => setDrafts((d) => ({ ...d, [f]: e.target.value }))
          const clearDraft = (f) => setDrafts((d) => { const n = { ...d }; delete n[f]; return n })
          const commitText = (f) => {
            const raw = draftVal(f)
            if (cfg && String(cfg[f] == null ? '' : cfg[f]) !== raw) setField(f, raw).then(flashSaved)
            clearDraft(f)
          }

          const flashSaved = () => {
            setSavedFlash(true)
            if (flashTimer.current) clearTimeout(flashTimer.current)
            flashTimer.current = setTimeout(() => setSavedFlash(false), 1500)
          }
          React.useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

          const setStyle = (s) => { uiStore.set({ style: s }); flashSaved() }
          const setShow = (k, v) => { uiStore.set({ show: { [k]: v } }); flashSaved() }
          const commitNum = (field, lo, hi) => {
            const n = Number(draftVal(field))
            if (cfg && Number.isFinite(n)) {
              const clamped = Math.max(lo, Math.min(hi, n))
              if (clamped !== cfg[field]) setField(field, clamped).then(flashSaved)
            }
            clearDraft(field)
          }

          const display = { style: ui.style, show: ui.show }

          return h('div', { className: 'mgp-set' },
            h('style', null, css),
            h('div', { className: 'mgp-set-head' },
              h(MagpieIcon, { size: 30, active: true }),
              h('div', { className: 'mgp-set-headtext' },
                h('div', { className: 'mgp-set-title' }, t('settings.title')),
                h('div', { className: 'mgp-set-sub' }, t('settings.subtitle')))),
            h('div', { className: 'mgp-set-grid' },
              h('div', { className: 'mgp-set-col' },
                // display style
                h('div', { className: 'mgp-set-card' },
                  h('div', { className: 'mgp-set-cardtitle' }, t('settings.style')),
                  h('div', { className: 'mgp-style-grid', role: 'radiogroup', 'aria-label': t('settings.style') },
                    STYLES.map((s) => h(StyleCard, { key: s, style: s, active: ui.style === s, onSelect: setStyle })))),
                // display content
                h('div', { className: 'mgp-set-card' },
                  h('div', { className: 'mgp-set-cardtitle' }, t('settings.content')),
                  h('div', { className: 'mgp-toggle-list' },
                    BLOCKS.map((k) => h(ToggleRow, {
                      key: k, label: t('settings.content.' + k), desc: t('settings.content.' + k + '.desc'),
                      checked: ui.show[k] !== false, onChange: (v) => setShow(k, v),
                    })))),
                // host config
                h('div', { className: 'mgp-set-card' },
                  h('div', { className: 'mgp-set-cardtitle' }, t('settings.data')),
                  cfgState.status !== 'ready' ? h('div', { className: 'mgp-note' }, t('settings.data.unavailable')) : null,
                  cfg ? h('div', { className: 'mgp-field-grid' },
                    h(Field, { label: t('settings.data.gateway') },
                      h(ConfigInput, { value: draftVal('gatewayUrl'), disabled: !writable, onChange: editDraft('gatewayUrl'), onBlur: () => commitText('gatewayUrl'), onEnter: () => commitText('gatewayUrl') })),
                    h(Field, { label: t('settings.data.refresh'), hint: t('units.ms') },
                      h(ConfigInput, { value: draftVal('refreshMs'), type: 'number', min: 1000, max: 120000, step: 500, disabled: !writable, onChange: editDraft('refreshMs'), onBlur: () => commitNum('refreshMs', 1000, 120000), onEnter: () => commitNum('refreshMs', 1000, 120000) })),
                    h(Field, { label: t('settings.data.limit') },
                      h(ConfigInput, { value: draftVal('requestLimit'), type: 'number', min: 5, max: 200, step: 1, disabled: !writable, onChange: editDraft('requestLimit'), onBlur: () => commitNum('requestLimit', 5, 200), onEnter: () => commitNum('requestLimit', 5, 200) })),
                    h(Field, { label: t('settings.data.period') },
                      h('select', { className: 'mgp-select', value: cfg.period || 'today', disabled: !writable, onChange: (e) => setField('period', e.target.value).then(flashSaved) },
                        PERIODS.map((p) => h('option', { key: p, value: p }, t('period.' + p))))),
                    h(Field, { label: t('settings.data.cny'), hint: t('settings.data.cny.hint') },
                      h(ConfigInput, { value: draftVal('cnyRate'), type: 'number', min: 0, max: 100, step: 0.1, disabled: !writable, onChange: editDraft('cnyRate'), onBlur: () => commitNum('cnyRate', 0, 100), onEnter: () => commitNum('cnyRate', 0, 100) })),
                    h(Field, { label: t('settings.data.tool'), hint: t('settings.data.tool.desc') },
                      h('div', { className: 'mgp-field-inline' },
                        h(Switch, { checked: cfg.tool !== false, disabled: !writable, label: t('settings.data.tool'), onChange: (v) => setField('tool', v).then(flashSaved) }),
                        !writable ? h('span', { className: 'mgp-field-hint' }, t('settings.data.readonly')) : null)),
                  ) : null),
                // preferences + reset
                h('div', { className: 'mgp-set-card' },
                  h('div', { className: 'mgp-set-cardtitle' }, t('settings.prefs')),
                  h('div', { className: 'mgp-toggle-list' },
                    h(ToggleRow, { label: t('settings.prefs.mask'), checked: ui.masked, onChange: (v) => { uiStore.set({ masked: v }); flashSaved() } }),
                    h(ToggleRow, { label: t('settings.prefs.auto'), checked: ui.auto, onChange: (v) => { uiStore.set({ auto: v }); flashSaved() } })),
                  h('div', { className: 'mgp-set-actions' },
                    h('button', { type: 'button', className: 'mgp-btn', onClick: () => { uiStore.resetDisplay(); flashSaved() } }, t('settings.reset')))),
              ),
              // live preview
              h('div', { className: 'mgp-set-preview' },
                h('div', { className: 'mgp-set-preview-head' },
                  h('span', null, t('settings.preview')),
                  savedFlash ? h('span', { className: 'mgp-saved' }, t('settings.saved')) : null),
                h('div', { className: 'mgp-preview-frame' },
                  h(MagpieBody, {
                    snap: SAMPLE_SNAPSHOT, updatedAt: SAMPLE_SNAPSHOT.fetchedAt, failed: false, auto: ui.auto,
                    period: 'today', masked: ui.masked, manualBusy: false, density: 'normal', display, expanded: previewExpanded,
                    onToggleMask: () => { uiStore.set({ masked: !ui.masked }); flashSaved() },
                    onToggleAuto: () => { uiStore.set({ auto: !ui.auto }); flashSaved() },
                    onRefresh: noop, onChangePeriod: noop, onToggleExpand: () => setPreviewExpanded((x) => !x),
                  })),
                h('div', { className: 'mgp-preview-note' }, t('settings.preview.note'))),
            ))
        }

        const settingsFallback = h('div', { className: 'mgp-set-fallback' }, 'Magpie settings unavailable')
        const MagpieSettingsSafe = (props) => h(SlotErrorBoundary, { fallback: settingsFallback }, h(MagpieSettings, props))

        // ---- registrations ----
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: WIDGET_ID, order: 100, label: () => t('widget.title'),
        }, MagpieFooterSafe)), NS + ': sidebar footer widget')

        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: WIDGET_ID, order: 35, label: () => t('settings.nav'), locale: NS, inject: () => ({}),
        }, MagpieSettingsSafe)), NS + ': settings section')

        ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: '@local/dsh-magpie-monitor', locale: NS, inject: () => ({}),
        }, MagpieSettingsSafe)), NS + ': plugin config')
      },
    }
  },
})