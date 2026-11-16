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
// Shown in the settings header so a stale browser bundle is obvious at a glance.
// invariants.test.js keeps this equal to package.json.
const VERSION = '1.8.0'
const API = '/magpie-monitor/api'
const STORE_KEY = 'dsh-magpie-monitor:v1'
const DISPLAY_KEY = 'dsh-magpie-monitor:display:v1'
const PERIODS = ['today', '7d', '30d', 'all']
const SAVE_EVERY_MS = 15000
const SAVE_MAX_CHARS = 300000
const STYLES = ['standard', 'compact', 'minimal']
// blocks that own a whole section of the panel
const BLOCKS = ['flight', 'route', 'quotas', 'spark', 'models', 'requests', 'speeds', 'channels']
// fine print inside a section: the numbers a reader may want to hide
const DETAIL_BLOCKS = ['tabs', 'cells', 'metrics', 'chart', 'reqmeta']
// the usage section is one switch; the period tabs and the three totals are
// its children, so the settings page never offers the same thing twice
const USAGE_BLOCK = 'usage'
const USAGE_CHILDREN = ['tabs', 'cells']

const EN = {
  'widget.title': 'Magpie',
  'widget.rail': 'Magpie monitor',
  'rail.tip': 'Magpie · {calls} calls · {cost} · {model}',
  'rail.open': 'Open Magpie monitor',
  'rail.close': 'Close',
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
  'problems.item': '{what}: {why}',
  'retry': 'Retry',
  'latest': 'Latest route',
  'latest.none': 'No routed request yet',
  'route.dsh': 'DSH',
  'route.hint': 'Requests on the wire: harness → magpie → provider',
  'speeds.title': 'Model speeds',
  'speeds.tps': '{tps} tok/s',
  'speeds.none': 'No per-model speed data',
  'channels.title': 'Traffic split',
  'channels.through': 'through',
  'channels.direct': 'direct',
  'channels.reported': 'reported',
  'usage.calls': 'calls',
  'usage.tokens': 'tokens',
  'usage.tokens.compact': 'tok',
  'usage.cost': 'cost',
  'metrics.errors': 'errors',
  'metrics.ttft': 'TTFT',
  'metrics.tps': 'tok/s',
  'metrics.cache': 'cache',
  'quota.left': 'left',
  'quota.reset.now': 'resetting',
  'quota.reset.m': 'in {n}m',
  'quota.reset.h': 'in {n}h',
  'quota.reset.d': 'in {n}d',
  'sess.calls': 'requests',
  'seg.requests': 'Requests',
  'seg.sessions': 'Sessions',
  'req.dur': 'took',
  'req.tok': 'tok',
  'period.today': 'Today',
  'period.7d': '7 days',
  'period.30d': '30 days',
  'period.all': 'All',
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
  'settings.style.compact.desc': 'Tighter spacing, fewer rows.',
  'settings.style.minimal': 'Minimal',
  'settings.style.minimal.desc': 'One line: calls, cost, quota.',
  'settings.content': 'Display content',
  'settings.content.route': 'Latest route',
  'settings.content.route.desc': 'The most recent routed request.',
  'settings.content.usage': 'Usage display',
  'settings.content.usage.desc': 'The period switch and the three totals.',
  'settings.content.flight': 'Flight strip',
  'settings.content.flight.desc': 'The DSH → magpie → provider lane and its birds.',
  'settings.content.quotas': 'Quota bars',
  'settings.content.quotas.desc': 'Remaining quota per account window.',
  'settings.content.spark': 'Quota history',
  'settings.content.spark.desc': 'Sparkline of remaining quota over time.',
  'settings.content.models': 'Top models',
  'settings.content.models.desc': 'Models ranked by cost (in details).',
  'settings.content.requests': 'Recent requests',
  'settings.content.requests.desc': 'Recent routed requests (in details).',
  'settings.content.speeds': 'Model speeds',
  'settings.content.speeds.desc': 'Per-model tokens/s measured by the gateway (in details).',
  'settings.content.channels': 'Traffic split',
  'settings.content.channels.desc': 'Calls that went through the gateway, direct or reported (in details).',
  'settings.preview': 'Live preview',
  'settings.preview.note': 'Preview uses sample data.',
  'settings.details': 'Numbers in the panel',
  'settings.details.tabs': 'Period switch',
  'settings.details.tabs.desc': 'Today / 7 / 30 / all, as one segmented control.',
  'settings.details.cells': 'Totals',
  'settings.details.cells.desc': 'Calls, tokens and cost, side by side.',
  'settings.details.metrics': 'Derived metrics',
  'settings.details.metrics.desc': 'Errors, TTFT, tokens/s and cache hit.',
  'settings.details.chart': 'Activity chart',
  'settings.details.chart.desc': 'Per-bucket call bars.',
  'settings.details.reqmeta': 'Request details',
  'settings.details.reqmeta.desc': 'Duration, TTFT, tokens, cache, cost, account.',
  'settings.data': 'Data & refresh',
  'settings.data.gateway': 'Gateway URL',
  'settings.data.gateway.hint': 'The host reads this gateway; discovery can recover a moved port.',
  'settings.data.discover': 'Auto-discover gateway',
  'settings.data.discover.desc': 'When the gateway is unreachable, look for its port again.',
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
  'settings.alerts': 'Alerts',
  'settings.alerts.turnDone': 'Task done alert',
  'settings.alerts.turnDone.hint': 'A notification when a task that ran at least this long finishes — the same rule as Magpie.',
  'settings.alerts.off': 'Off',
  'settings.alerts.custom': 'Custom threshold (seconds)',
  'settings.alerts.test': 'Play the sound',
  'settings.alerts.sound': 'Sound',
  'settings.alerts.sound.alarm': 'Alarm',
  'settings.alerts.sound.ring': 'Ring',
  'settings.alerts.sound.bell': 'Bell',
  'settings.alerts.sound.chime': 'Magpie chime',
  'settings.alerts.flash': 'Flash the taskbar',
  'settings.alerts.flash.hint': 'Blink the DSH taskbar button until this window comes back to the front.',
  'settings.alerts.noSound': 'No system notification sound found on this machine.',
  'settings.alerts.perm.ask': 'Allow notifications',
  'settings.alerts.perm.granted': 'Desktop notifications are on',
  'settings.alerts.perm.denied': 'Notifications are blocked in the system settings',
  'settings.alerts.perm.unsupported': 'Notifications are not available here',
  'alert.done.title': '{name} finished',
  'alert.done.body': 'Ran for {time}',
  'units.min': '{n}m',
  'units.sec': '{n}s',
  'units.ms': 'ms',
  // relative age: the stale banner prints one of these
  'rel.now': 'just now',
  'rel.m': '{n}m ago',
  'rel.h': '{n}h ago',
  'rel.d': '{n}d ago',
  // failure reasons: the host sends a code, the panel prints the sentence
  'err.connection': 'cannot reach the gateway — it may have moved ports',
  'err.timeout': 'the gateway did not answer in time — retrying soon',
  'err.unauthorized': 'the gateway rejected the credentials',
  'err.forbidden': 'blocked by the gateway policy',
  'err.rate_limited': 'the gateway is rate limiting — try again later',
  'err.server_error': 'the gateway failed internally',
  'err.bad_request': 'the gateway refused the request',
  'err.aborted': 'the read was interrupted',
  'err.unknown': 'unknown error',
  'chart.label': 'calls per bucket',
}

const ZH = {
  'widget.title': 'Magpie',
  'widget.rail': 'Magpie 监控',
  'rail.tip': 'Magpie · {calls} 次调用 · {cost} · {model}',
  'rail.open': '打开 Magpie 监控',
  'rail.close': '关闭',
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
  'problems.item': '{what}：{why}',
  'retry': '重试',
  'latest': '最新路由',
  'latest.none': '暂无路由请求',
  'route.dsh': 'DSH',
  'route.hint': '请求在链路上：DSH → magpie → 供应商',
  'speeds.title': '模型速率',
  'speeds.tps': '{tps} tok/s',
  'speeds.none': '暂无模型速率数据',
  'channels.title': '流量分布',
  'channels.through': '经网关',
  'channels.direct': '直连',
  'channels.reported': '已上报',
  'usage.calls': '调用',
  'usage.tokens': ' tokens',
  'usage.tokens.compact': 'token',
  'usage.cost': '成本',
  'metrics.errors': '错误',
  'metrics.ttft': 'TTFT',
  'metrics.tps': 'tok/s',
  'metrics.cache': '缓存',
  'quota.left': '剩余',
  'quota.reset.now': '即将重置',
  'quota.reset.m': '{n} 分钟后重置',
  'quota.reset.h': '{n} 小时后重置',
  'quota.reset.d': '{n} 天后重置',
  'sess.calls': '请求',
  'seg.requests': '按请求',
  'seg.sessions': '按会话',
  'req.dur': '耗时',
  'req.tok': 'token',
  'period.today': '今日',
  'period.7d': '7 天',
  'period.30d': '30 天',
  'period.all': '全部',
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
  'settings.style.compact.desc': '间距更小、行数更少',
  'settings.style.minimal': '极简',
  'settings.style.minimal.desc': '单行：调用·成本·额度',
  'settings.content': '展示内容',
  'settings.content.route': '最新路由',
  'settings.content.route.desc': '最近一次路由请求。',
  'settings.content.usage': '用量展示',
  'settings.content.usage.desc': '周期切换与三个统计数字。',
  'settings.content.flight': '喜鹊飞线',
  'settings.content.flight.desc': 'DSH → magpie → 供应商 的连线与喜鹊。',
  'settings.content.quotas': '额度进度条',
  'settings.content.quotas.desc': '各账号窗口的剩余额度。',
  'settings.content.spark': '额度历史曲线',
  'settings.content.spark.desc': '剩余额度随时间的迷你曲线。',
  'settings.content.models': '模型排行',
  'settings.content.models.desc': '按成本排序的模型（在详情中）。',
  'settings.content.requests': '最近请求',
  'settings.content.requests.desc': '最近的路由请求（在详情中）。',
  'settings.content.speeds': '模型速率',
  'settings.content.speeds.desc': '网关实测的每模型 tokens/s（在详情中）。',
  'settings.content.channels': '流量分布',
  'settings.content.channels.desc': '经网关、直连与已上报的调用数（在详情中）。',
  'settings.preview': '实时预览',
  'settings.preview.note': '预览使用示例数据。',
  'settings.details': '面板里的数字',
  'settings.details.tabs': '周期切换',
  'settings.details.tabs.desc': '今日 / 7 天 / 30 天 / 全部。',
  'settings.details.cells': '统计数字',
  'settings.details.cells.desc': '调用、token 与成本并排。',
  'settings.details.metrics': '派生指标',
  'settings.details.metrics.desc': '错误、TTFT、tokens/s 与缓存命中。',
  'settings.details.chart': '调用分布图',
  'settings.details.chart.desc': '按时间桶的调用柱状图。',
  'settings.details.reqmeta': '请求明细',
  'settings.details.reqmeta.desc': '耗时、TTFT、token、缓存、成本、账号。',
  'settings.data': '数据与刷新',
  'settings.data.gateway': '网关地址',
  'settings.data.gateway.hint': 'host 从这里读取网关；自动发现能找回换过的端口。',
  'settings.data.discover': '自动发现网关',
  'settings.data.discover.desc': '网关连不上时，自动重新查找它的端口。',
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
  'settings.alerts': '提醒',
  'settings.alerts.turnDone': '任务完成提醒',
  'settings.alerts.turnDone.hint': '一个至少跑了这么久的任务完成时提醒，规则与 Magpie 一致。',
  'settings.alerts.off': '关',
  'settings.alerts.custom': '自定义阈值（秒）',
  'settings.alerts.test': '试听提示音',
  'settings.alerts.sound': '提示音',
  'settings.alerts.sound.alarm': '警报',
  'settings.alerts.sound.ring': '铃声',
  'settings.alerts.sound.bell': '钟声',
  'settings.alerts.sound.chime': '系统通知音',
  'settings.alerts.flash': '任务栏闪烁',
  'settings.alerts.flash.hint': '闪烁 DSH 的任务栏按钮，直到窗口重新回到前台。',
  'settings.alerts.noSound': '这台机器上没找到系统通知音。',
  'settings.alerts.perm.ask': '允许通知',
  'settings.alerts.perm.granted': '桌面通知已开启',
  'settings.alerts.perm.denied': '系统设置里关掉了通知',
  'settings.alerts.perm.unsupported': '这里用不了桌面通知',
  'alert.done.title': '{name} 已完成',
  'alert.done.body': '用时 {time}',
  'units.min': '{n} 分钟',
  'units.sec': '{n} 秒',
  'units.ms': '毫秒',
  'rel.now': '刚刚',
  'rel.m': '{n} 分钟前',
  'rel.h': '{n} 小时前',
  'rel.d': '{n} 天前',
  'err.connection': '网关连不上，可能已换了端口',
  'err.timeout': '网关响应超时，稍后自动重试',
  'err.unauthorized': '网关拒绝了凭据',
  'err.forbidden': '被网关风控或权限拦截',
  'err.rate_limited': '网关限流，稍后再试',
  'err.server_error': '网关内部出错',
  'err.bad_request': '网关拒绝了这次请求',
  'err.aborted': '读取被中断',
  'err.unknown': '未知错误',
  'chart.label': '调用分布',
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
/** Relative time in the panel's own language; `t` is the bound namespace. */
function fmtRelative(ts, t) {
  const n = Number(ts)
  if (!Number.isFinite(n)) return ''
  const diff = Date.now() - n
  if (diff < 60000) return t('rel.now')
  if (diff < 3600000) return t('rel.m', { n: Math.round(diff / 60000) })
  if (diff < 86400000) return t('rel.h', { n: Math.round(diff / 3600000) })
  return t('rel.d', { n: Math.round(diff / 86400000) })
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

// The gateway panel prints a wall-clock time per request; rows carry either
// epoch seconds, epoch milliseconds or an ISO stamp, so accept all three.
function fmtTime(ts) {
  let d = null
  if (typeof ts === 'string' && ts.indexOf(':') > 0 && /\d{4}-\d{2}/.test(ts)) d = new Date(ts)
  else {
    const v = Number(ts)
    if (!Number.isFinite(v) || v <= 0) return ''
    d = new Date(v < 1e12 ? v * 1000 : v)
  }
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}
/** Epoch milliseconds for a stamp the gateway may send in any shape. */
function msOf(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v
  const text = String(v == null ? '' : v).trim()
  if (!text) return 0
  const n = Number(text)
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n
  // "2026-11-16T13:26:45.2318564+08:00" — the extra fraction digits are legal
  // in the gateway's .NET stamps but not in Date.parse, so trim them first.
  const parsed = Date.parse(text.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(parsed) ? parsed : 0
}
/** Cache hit share of one request, or null when it carried no tokens. */
function cachePctOf(row) {
  const cache = Number(row && row.cacheRead) || 0
  const input = Number(row && row.in) || 0
  if (cache + input <= 0) return null
  return Math.round((cache / (cache + input)) * 100)
}
// <icons: generated by tools/embed-icons.mjs>
const BRAND_ICONS = {
  "magpie": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZWRlZGYxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMS41IDUuNUMxLjMgNS43IDEuMiA2LjUgMS4yIDYuOUMxLjIgNi45IDEuMiA3IDEuMiA3LjFDMS4xIDcuNCAxLjMgOCAxLjQgOC4zQzEuNCA4LjQgMS41IDguNSAxLjUgOC43QzEuNSA4LjkgMS43IDkgMS44IDkuM0MyLjIgOS45IDIuMiAxMCAyLjMgMTAuMUMyLjQgMTAuMiAyLjUgMTAuMyAyLjYgMTAuNUMyLjggMTAuOCAzIDExLjEgMy4yIDExLjNDMy4zIDExLjMgMy40IDExLjYgMy42IDExLjhDMy44IDEyIDQuMSAxMi40IDQuMiAxMi41QzQuNyAxMyA1LjIgMTMuNyA1LjQgMTMuOUM2IDE0LjUgNi41IDE1LjEgNi43IDE1LjNDNi43IDE1LjQgNi45IDE1LjUgNi45IDE1LjdDNy4zIDE1LjkgNy43IDE2LjUgNy45IDE2LjhDNy45IDE2LjggOCAxNi45IDggMTYuOUM4LjEgMTYuOSA4LjIgMTcuMiA4LjIgMTcuM0M4LjIgMTcuMyA4LjEgMTcuMiA4LjEgMTcuMUM3LjkgMTYuOSA3LjkgMTYuOSA3LjYgMTYuNkM3LjUgMTYuNSA3LjQgMTYuNSA3LjQgMTYuM0M3LjIgMTYuMiA2LjcgMTUuNyA2LjMgMTUuMkM2LjEgMTUuMSA2IDE0LjkgNiAxNC45QzUuOSAxNC44IDUuNyAxNC43IDUuNyAxNC42QzUuNiAxNC41IDUuNCAxNC4zIDUuMyAxNC4yQzUuMSAxNC4xIDQuOSAxMy44IDQuNyAxMy41QzQuNSAxMy4zIDQuMiAxMy4xIDQuMSAxMi45QzQuMSAxMi45IDMuOCAxMi43IDMuOCAxMi41QzMuNSAxMi4zIDMgMTEuOCAyLjggMTEuNEMxLjggMTAuNSAwLjkgOS42IDAuNyA5LjZDMC42IDkuNyAwLjYgOS44IDAuNSAxMEMwLjUgMTAuMSAwLjYgMTAuMiAwLjUgMTAuM0MwLjUgMTAuNCAwLjYgMTAuNSAwLjYgMTAuNkMwLjUgMTAuNyAwLjUgMTAuOSAwLjYgMTFDMC41IDExLjEgMC42IDExLjQgMC42IDExLjVDMC45IDEyLjkgMS4zIDEzLjggMi44IDE0LjlDMi45IDE1LjEgMy4zIDE1LjMgMy40IDE1LjRDMy40IDE1LjUgMy42IDE1LjYgMy43IDE1LjdDNC4yIDE2IDYuNCAxNy44IDcgMTguNEM3LjQgMTguOCA3LjQgMTguOCA3LjUgMTguOUM3LjYgMTkgNy43IDE5IDcuNyAxOS4xQzcuNyAxOS4yIDcuOCAxOS4yIDcuOSAxOS4yQzcuOSAxOS4zIDguMSAxOS40IDguMSAxOS41QzguMiAxOS42IDguMiAxOS43IDguMyAxOS43QzguMyAxOS43IDguMyAxOS43IDguMiAxOS43QzguMiAxOS42IDguMSAxOS42IDggMTkuNkM3LjkgMTkuNSA3LjkgMTkuNCA3LjggMTkuNEM3LjcgMTkuMyA3LjYgMTkuMiA3LjYgMTkuMkM3LjYgMTkuMSA3LjUgMTkgNy4zIDE4LjlDNy4yIDE4LjkgNi45IDE4LjYgNi43IDE4LjRDNi4xIDE3LjggNC41IDE2LjYgMy41IDE2QzMuNCAxNS44IDMgMTUuNiAyLjkgMTUuNUMyLjYgMTUuMyAxLjUgMTQuNiAwLjkgMTQuM0MwLjcgMTQuMSAwLjYgMTQuMSAwLjYgMTQuMkMwLjUgMTQuNSAwLjggMTUuOSAwLjkgMTYuMUMwLjkgMTYuMiAxIDE2LjIgMC45IDE2LjNDMS4yIDE2LjggMS45IDE3LjYgMi43IDE4LjNDMi44IDE4LjUgNCAxOS4yIDQuNyAxOS41QzYuMiAyMC41IDYuNiAyMC43IDcuNCAyMS41QzguMiAyMi4yIDguNyAyMi43IDkuMyAyMy42QzkuNSAyNC4xIDkuOSAyNC40IDEwLjMgMjUuM0MxMC40IDI1LjUgMTAuNSAyNS44IDEwLjUgMjUuOEMxMC43IDI1LjggMTAuOCAyNS43IDExIDI1LjRDMTEuNiAyNSAxMS45IDI0LjYgMTIuMyAyNC4zQzEyLjggMjQgMTMgMjMuOCAxMyAyMy43QzEzLjEgMjMuNyAxMy4xIDIzLjggMTMgMjRDMTIgMjQuOCAxMSAyNiAxMC4yIDI2LjlDMTAuMSAyNy4xIDkuOSAyNy41IDkuNyAyNy43QzkuNSAyNy44IDkuNCAyOCA5LjQgMjhDOS40IDI4IDkuMyAyOC4zIDkuMSAyOC41QzguNiAyOS4yIDcuNyAzMC44IDcuNyAzMC45QzcuNyAzMSA3LjggMzEgOC4zIDMwLjhDOSAzMC40IDkuNSAzMC4yIDEwLjQgMzBDMTEuNyAyOS42IDEyLjUgMjkuNiAxMS42IDMwQzEwLjUgMzAuMiA5LjcgMzAuNiA5LjIgMzEuMkM4LjggMzEuNyA4LjggMzEuNyA5LjMgMzEuN0MxMC4xIDMxLjggMTAuOSAzMS45IDExLjYgMzIuMkMxMi44IDMyLjcgMTMuNSAzMy4xIDE1LjUgMzQuOEMxNi40IDM1LjUgMTcuMyAzNi4yIDE3LjggMzYuNEMxNy45IDM2LjUgMTguMSAzNi43IDE4LjIgMzYuOEMxOS4xIDM3LjMgMjEuMiAzOC4xIDIyLjMgMzguM0MyMi40IDM4LjMgMjIuNyAzOC4zIDIyLjggMzguM0MyMi44IDM4LjUgMjMgMzguNSAyMyAzOC41QzIzLjEgMzguNSAyMy4yIDM4LjUgMjMuMyAzOC41QzIzLjYgMzguNiAyNS45IDM4LjYgMjYuMSAzOC41QzI2LjIgMzguNSAyNi4zIDM4LjUgMjYuNCAzOC41QzI2LjUgMzguNSAyNi42IDM4LjUgMjYuNyAzOC4zQzI2LjcgMzguMyAyNyAzOC4zIDI3LjEgMzguM0MyOC4zIDM4LjEgMzAuMiAzNy4zIDMxLjQgMzYuN0MzMS41IDM2LjcgMzEuNyAzNi40IDMxLjggMzYuNEMzMi4yIDM2LjIgMzMuMiAzNS40IDMzLjQgMzUuMkMzNC4yIDM0LjUgMzUuNSAzMyAzNS44IDMyLjZDMzUuOCAzMi41IDM2IDMyLjIgMzYuMSAzMkMzNi40IDMxLjggMzYuNiAzMS40IDM2LjYgMzEuMkMzNi43IDMxLjEgMzYuOCAzMC45IDM2LjkgMzAuOEMzNy4yIDMwLjQgMzcuNSAyOS42IDM3LjcgMjkuMkMzNy43IDI5LjEgMzcuOCAyOC43IDM3LjkgMjguN0MzOC4xIDI4LjUgMzguNCAyNy4xIDM4LjUgMjYuOEMzOSAyNS4yIDM5LjEgMjMuNyAzOSAyMi40QzM5IDIyLjIgMzguOSAyMS45IDM4LjkgMjEuOEMzOC45IDIxLjcgMzguOSAyMS42IDM4LjkgMjEuNEMzOC42IDIwLjUgMzguNSAxOS45IDM4LjIgMTlDMzcuOSAxOC41IDM3LjUgMTcuNSAzNy4zIDE3LjJDMzcgMTYuOCAzNi44IDE1LjggMzYuOCAxNS4yQzM2LjggMTMuOCAzNy43IDEyLjcgMzkuNiAxMi4yQzQwLjEgMTIuMSA0MS4zIDExLjggNDIuMSAxMS43QzQzLjUgMTEuNSA0My41IDExLjUgNDMuNCAxMS4zQzQyLjkgMTAuNyA0MC45IDkuOSAzOS4yIDkuN0MzNy45IDkuNSAzOC4xIDkuNSAzNy42IDlDMzcgOC42IDM2LjQgOCAzNiA3LjlDMzYgNy44IDM1LjggNy44IDM1LjcgNy43QzM1LjEgNy4zIDM0LjIgNyAzMy4xIDYuOUMzMi42IDYuNyAzMS42IDYuOSAzMSA3QzI5LjYgNy4zIDI4LjMgOCAyNy4zIDkuMkMyNi43IDkuOCAyNi4yIDEwLjggMjUuNyAxMS43QzI1LjUgMTIuMSAyNC44IDEzLjQgMjQuNyAxMy43QzI0LjYgMTMuOSAyNC41IDE0LjEgMjQuMSAxNC43QzIzLjUgMTUuNyAyMi4xIDE2LjkgMjAuNiAxNy44QzIwLjUgMTggMjAuMyAxOC4yIDIwLjEgMTguM0MxOS43IDE4LjUgMTkuNCAxOC44IDE5LjEgMTlDMTguOSAxOS4xIDE4LjcgMTkuMyAxOC41IDE5LjRDMTggMTkuOCAxNy4yIDIwLjMgMTcgMjAuNUMxNi45IDIwLjUgMTYuOCAyMC42IDE2LjcgMjAuN0MxNi4zIDIwLjggMTYuMSAyMC45IDE2IDIwLjlDMTUuNSAyMC44IDE0LjkgMjAuNSAxNC4yIDIwLjJDMTMuNyAxOS44IDEyLjcgMTguOSAxMi40IDE4LjZDMTIuMyAxOC41IDEyLjIgMTguNCAxMi4xIDE4LjJDMTEuOSAxOCAxMS4yIDE3LjEgMTEgMTYuNkMxMC45IDE2LjUgMTAuOCAxNi40IDEwLjcgMTYuM0MxMC43IDE2LjIgMTAuNiAxNi4xIDEwLjYgMTUuOUMxMC41IDE1LjkgMTAuNCAxNS43IDEwLjQgMTUuNkMxMC4zIDE1LjUgMTAuMiAxNS4yIDEwLjEgMTVDMTAgMTQuOCA5LjggMTQuNCA5LjcgMTQuMkM5LjYgMTQgOS41IDEzLjcgOS40IDEzLjZDOS40IDEzLjQgOS4zIDEzLjIgOS4yIDEzQzkuMiAxMi44IDkgMTIuNiA5IDEyLjVDOC45IDEyLjMgOC43IDEyLjEgOC43IDEyQzguNyAxMiA4LjUgMTEuNyA4LjUgMTEuN0M4LjMgMTEuMiA4LjIgMTAuOSA3LjUgMTBDNi40IDguMyA0LjIgNi40IDIuNyA1LjhDMiA1LjUgMS42IDUuNCAxLjUgNS41Wk0yOC40IDE2LjdDMjkuMiAxNi45IDI5LjcgMTcuMiAyOS45IDE3LjdDMzAuMSAxOC4yIDMwIDE4LjkgMjkuNiAxOS40QzI5LjIgMTkuOSAyOC4yIDIwLjkgMjcuNiAyMS4yQzI2LjggMjEuNyAyNS4zIDIyLjQgMjQuMiAyMi43QzIzLjkgMjIuOCAyMy42IDIyLjkgMjMuNSAyMi45QzIyLjggMjMuMiAyMC43IDIzLjcgMTkuNiAyNEMxOSAyNC4yIDE4LjQgMjQuMyAxOC4xIDI0LjRDMTcuOSAyNC40IDE2LjEgMjQuOSAxNS4zIDI1LjFDMTQuNiAyNS4yIDE0LjcgMjUuMSAxNS43IDIzLjZDMTYuNCAyMi43IDE4LjUgMjAuNiAxOS40IDE5LjlDMjAuOCAxOC44IDIxLjQgMTguNCAyMy4yIDE3LjZDMjMuOCAxNy40IDI1LjYgMTYuOCAyNS45IDE2LjhDMjUuOSAxNi44IDI2LjMgMTYuOCAyNi42IDE2LjdDMjYuOCAxNi43IDI4LjIgMTYuNyAyOC40IDE2LjdaTTMwLjQgMjAuMkMzMC41IDIwLjMgMzAuNiAyMC42IDMwLjYgMjAuN0MzMS43IDIzLjEgMzMuNCAyNC42IDM1LjYgMjUuM0MzNi4xIDI1LjUgMzYuNyAyNS43IDM3LjIgMjUuOEMzNy43IDI1LjggMzcuOCAyNS45IDM3LjggMjYuMUMzNy43IDI2LjIgMzcuNyAyNi4zIDM3LjcgMjYuNUMzNy43IDI2LjYgMzcuNyAyNi44IDM3LjYgMjdDMzcuNCAyOC41IDM2LjggMjkuOSAzNi4xIDMxQzM2LjEgMzEuMiAzNS45IDMxLjQgMzUuOSAzMS42QzM1LjcgMzEuOSAzNS4yIDMyLjYgMzQuNyAzMy4zQzMyLjYgMzUuNiAyOS43IDM3LjMgMjYuNiAzNy44QzI2LjUgMzcuOCAyNi4zIDM3LjkgMjYuMiAzNy45QzI1LjggMzcuOSAyMy43IDM3LjkgMjMuMyAzNy45QzIzLjIgMzcuOSAyMyAzNy44IDIyLjkgMzcuOEMyMS4xIDM3LjYgMTkuMyAzNi44IDE4IDM1LjdDMTcuNyAzNS40IDE3IDM0LjcgMTYuOCAzNC41QzE2LjMgMzMuOCAxNi4xIDMzIDE2LjMgMzIuNUMxNi41IDMxLjggMTYuOCAzMS42IDE3LjkgMzEuMUMxOS4xIDMwLjUgMTkuNCAzMC40IDIwLjIgMzBDMjEuNCAyOS40IDIzLjIgMjguNCAyMy45IDI3LjlDMjMuOSAyNy44IDI0LjIgMjcuNyAyNC41IDI3LjZDMjYuMyAyNi4zIDI4IDI0LjYgMjguOSAyMi45QzI5LjUgMjIuMiAyOS43IDIxLjYgMjkuOSAyMC43QzMwLjEgMjAgMzAuMiAxOS45IDMwLjQgMjAuMloiLz48L3N2Zz4=",
  "dsh": "data:image/png;base64,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",
  "qoder": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjNGQ2YmZlIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+UW9kZXI8L3RpdGxlPjxwYXRoIGQ9Ik0yMy4zNzYgMTQuNDU4di00LjA1NmMwLTIuMzA0LTEuMDAzLTQuMTU0LTIuNzQ4LTUuMDc1TDExLjYxMi41NzRsLS4wNDYuMDg2LS4wNDUuMDg2YzEuNjguODg2IDIuNjQ0IDIuNjczIDIuNjQ0IDQuOTAydjQuMDU2YTcuOTI4IDcuOTI4IDAgMDEtLjAxNC40NTRsLS4wMDUuMDYxYy0uMDA1LjA4MS0uMDEuMTY0LS4wMTguMjQ1YTQuODk3IDQuODk3IDAgMDEtLjAxMS4xbC0uMDEuMDc2Yy0uMDA4LjA2OC0uMDE1LjEzNS0uMDI1LjIwM2wtLjAxOC4xMTMtLjAxLjA1OGE5Ljk5IDkuOTkgMCAwMS0uMDk4LjUxM2wtLjAwNy4wM2E3LjIwOSA3LjIwOSAwIDAxLS4wNzQuMjk0bC0uMDI0LjA4NmMtLjAyNy4wOTktLjA1Ni4xOTctLjA4Ny4yOTZsLS4wMjcuMDg1YTkuNTkyIDkuNTkyIDAgMDEtLjExMS4zMjNsLS4wMzMuMDg1LS4wMTguMDQ2Yy0uMDMyLjA4Mi0uMDY0LjE2Ni0uMDk4LjI0OC0uMDE5LjA0OC0uMDQuMDk2LS4wNjEuMTQ1bC0uMDA3LjAxN2E2IDYgMCAwMS0uMDg0LjE4N2MtLjAyNC4wNTYtLjA1LjExLS4wNzcuMTY1LS4wMy4wNjEtLjA1OC4xMjItLjA4OS4xODJhOS40MjMgOS40MjMgMCAwMS0uMTc2LjMzMmMtLjAzLjA1Ni0uMDYyLjExMS0uMDk0LjE2Ny0uMDMxLjA1My0uMDYyLjEwOC0uMDk1LjE2LS4wMzMuMDU1LS4wNjYuMTEtLjEwMS4xNjQtLjAzMy4wNTMtLjA2NS4xMDQtLjEuMTU1LS4wMzQuMDU1LS4wNy4xMDctLjExMS4xNjlsLS4wOTkuMTQ0YTE1LjE5MyAxNS4xOTMgMCAwMS0uMzQuNDU3Yy0uMDQuMDUtLjA4LjEwMi0uMTIxLjE1MWwtLjEwNy4xMjgtLjAwNy4wMDhhNi45ODcgNi45ODcgMCAwMS0uMjYyLjI5OGwtLjE0OS4xNi0uMTE2LjEyYTkuNTYyIDkuNTYyIDAgMDEtLjIwNC4xOThsLS4wMy4wMy0uMDcyLjA2OWE5LjA1IDkuMDUgMCAwMS0uMjYzLjIzNWwtLjAyNS4wMjItLjAyOS4wMjYtLjA0Mi4wMzVhMTEuNyAxMS43IDAgMDEtLjIyLjE4bC0uMDcuMDU1LS4wMTguMDEzYTguOTA0IDguOTA0IDAgMDEtLjE5NC4xNDZjLS4wMjkuMDItLjA1Ny4wNDItLjA4Ni4wNjNhNy43IDcuNyAwIDAxLS4yMi4xNTJsLS4wNTcuMDRhOC44NjUgOC44NjUgMCAwMS0uMjkzLjE4NWwtLjA2Mi4wMzdhMTAuNDI0IDEwLjQyNCAwIDAxLS4zMDcuMTczbC0uMDM3LjAyLS4xOTYuMTAzLS4xMDguMDUyLS4wMTIuMDA2YTYuMTk2IDYuMTk2IDAgMDEtLjMxNS4xNDNjLS4wNjUuMDI4LS4xMy4wNTQtLjE5Ni4wOGwtLjAzNS4wMTQtLjA4Ni4wMzRjLS4wNy4wMjYtLjE0My4wNS0uMjE1LjA3NWwtLjAzOS4wMTQtLjA2NC4wMjNhOC4wNTYgOC4wNTYgMCAwMS0uMzIzLjA5N2wtLjYzLjE3M2E3LjI4NSA3LjI4NSAwIDAxLS4zMy4wOGwtLjA3LjAxNWMtLjA1My4wMTItLjEwNC4wMjMtLjE1Ny4wMzJsLS4wNjUuMDExLS4wODUuMDE1YTIuMzMyIDIuMzMyIDAgMDEtLjE5NC4wMjdsLS4wODUuMDFhNC43MTUgNC43MTUgMCAwMS0uMTYuMDE4bC0uMDM0LjAwM2E0Ljg2MSA0Ljg2MSAwIDAxLS4yNDYuMDE2aC0uMDMzYTIuNzE0IDIuNzE0IDAgMDEtLjE1NS4wMDVoLS4xMDZhMy4zODQgMy4zODQgMCAwMS0uMjI1LS4wMDdINC44NmwtLjE1LS4wMTItLjA2Ni0uMDA2YTUuNTg2IDUuNTg2IDAgMDEtLjE4Ny0uMDJsLS4wNC0uMDA1YTUuMTQgNS4xNCAwIDAxLS4yMTktLjAzNWwtLjA1NC0uMDFhNi45NDMgNi45NDMgMCAwMS0uMzQ3LS4wODJsLS4wMy0uMDA4LS4wMzgtLjAxYTUuMDM0IDUuMDM0IDAgMDEtLjI2OS0uMDg2bC0uMDYzLS4wMjNhNC4yMTYgNC4yMTYgMCAwMS0uMTg4LS4wNzNsLS4wNzEtLjAzMS0uMDE2LS4wMDdhNC45NTkgNC45NTkgMCAwMS0uMTYtLjA3NGwtLjAyNi0uMDEzYS4xNjQuMTY0IDAgMDAtLjAxNC0uMDA3bC0uNjcxLS4zNTEuNDg2LjQ4NmguMDE2bDguOTk1IDQuNzQyLjA5My4wNDguMDMuMDE0LjAyLjAxYy4wNTYuMDI2LjExMS4wNTIuMTY5LjA3NmwuMDE2LjAwOC4wNzMuMDMyLjE5NS4wNzYuMDIyLjAwOGEuNzE4LjcxOCAwIDAxLjAzLjAxMmwuMDE0LjAwNGE0LjY5MyA0LjY5MyAwIDAwLjMyMy4xbC4wMjcuMDA3Yy4wNzMuMDIuMTQ3LjAzOC4yMi4wNTVsLjAxOC4wMDQuMDI3LjAwNi4wNjYuMDEzLjA4OC4wMTZjLjA3NS4wMTQuMTUuMDI2LjIyNi4wMzhsLjA0Mi4wMDRjLjA2NC4wMDkuMTI4LjAxNi4xOTMuMDIybC4xMjYuMDEyLjA2LjAwMy4wNS4wMDIuMDk4LjAwNWMuMDQ2LjAwMi4wOTQuMDAyLjE0LjAwM2guMTJjLjA1IDAgLjEtLjAwMi4xNjEtLjAwNWguMDMzbC4wNy0uMDA0YTYuMTcgNi4xNyAwIDAwLjE4NC0uMDE0bC4wMzMtLjAwM2EuNzUzLjc1MyAwIDAwLjA1OC0uMDA1bC4xMDgtLjAxMi4wODEtLjAxLjA4LS4wMS4xMjktLjAyMS4wODItLjAxNC4wNzEtLjAxMmMuMDU0LS4wMS4xMDctLjAyMS4xNi0uMDMzbC4wNjYtLjAxMy4wNTktLjAxM2MuMDk2LS4wMjIuMTkyLS4wNDYuMjg3LS4wNzNsLjYzLS4xNzJhNy4zNTQgNy4zNTQgMCAwMC4zOTctLjEyMmwuMDQtLjAxNWMuMDc1LS4wMjUuMTQ5LS4wNTEuMjIyLS4wNzguMDMyLS4wMTEuMDYyLS4wMjQuMDkzLS4wMzdsLjAzLS4wMTJjLjA2Ny0uMDI3LjEzNS0uMDU0LjItLjA4MmwuMTI4LS4wNTYuMTk1LS4wOS4wMjEtLjAxLjEwMi0uMDVjLjA2OC0uMDM0LjEzNS0uMDY5LjIwMi0uMTA1bC4wMzctLjAyLjA3My0uMDM4Yy4wOC0uMDQ0LjE2LS4wOTIuMjQtLjEzOWwuMDI2LS4wMTVhOC4wODYgOC4wODYgMCAwMC4zMjItLjJsLjA2NS0uMDQ1IDEuOTguOTAyYTEuNzQ4IDEuNzQ4IDAgMDAyLjQ3Mi0xLjU5di03LjMzbC4wMDQuMDA0eiIgb3BhY2l0eT0iLjUiPjwvcGF0aD48cGF0aCBkPSJNMTEuNjE3LjU3NmEzLjkwNCAzLjkwNCAwIDAwLS4wOTMtLjA0N2MtLjAxNi0uMDA5LS4wMzMtLjAxNi0uMDUtLjAyNGE1Ljg1NCA1Ljg1NCAwIDAwLS4xNjYtLjA3N2wtLjA5LS4wNGE0LjA5NCA0LjA5NCAwIDAwLS4xOTQtLjA3NGMtLjAxNy0uMDA2LS4wMzUtLjAxNS0uMDUzLS4wMmwtLjAxMy0uMDA1YTUuMTggNS4xOCAwIDAwLS4yNzctLjA4OGwtLjA3LS4wMTlhNC4wMzQgNC4wMzQgMCAwMC0uMjE5LS4wNTNjLS4wMTUtLjAwMy0uMDMtLjAwOC0uMDQ0LS4wMTJMMTAuMjUzLjFsLS4wNTctLjAxMWE1LjE3NyA1LjE3NyAwIDAwLS4yMjUtLjAzNkw5LjkyOC4wNDdhNS45NzIgNS45NzIgMCAwMC0uMTkxLS4wMjJMOS42NjkuMDJhMS4zMyAxLjMzIDAgMDAtLjA1OC0uMDA1TDkuNTE1LjAwOWE0LjA1OCA0LjA1OCAwIDAwLS4xMTEtLjAwNUM5LjM1NCAwIDkuMzA0IDAgOS4yNTQgMGgtLjEwOWMtLjA1MiAwLS4xMDYuMDA0LS4xNi4wMDRMOC44ODQuMDFBNS4zMiA1LjMyIDAgMDA4LjcuMDIybC0uMDgzLjAwNmgtLjAwOGMtLjA1LjAwNS0uMS4wMTMtLjE1LjAxOWwtLjEyLjAxNGMtLjA1Ni4wMDgtLjExMi4wMTgtLjE2OS4wMjgtLjAzNy4wMDYtLjA3NC4wMTEtLjExLjAxOGE3LjA1NCA3LjA1NCAwIDAwLS41NzIuMTMzbC0uNjMuMTcyYy0uMTExLjAzMS0uMjIuMDY0LS4zMy4xLS4wMzcuMDExLS4wNzIuMDI1LS4xMDguMDM3YTEyLjkxIDEyLjkxIDAgMDAtLjM0NS4xMjZjLS4wNjcuMDI3LS4xMzMuMDU0LS4yLjA4M2wtLjEyOC4wNTVhMTEuOTE2IDExLjkxNiAwIDAwLS4zMTguMTUgNy4zNzYgNy4zNzYgMCAwMC0uMzExLjE2M2MtLjA4Mi4wNDUtLjE2LjA5Mi0uMjQuMTRhOS40MjQgOS40MjQgMCAwMC0uMzUuMjE4bC0uMDE2LjAxLS4wNi4wNGE5LjI0MiA5LjI0MiAwIDAwLS41MS4zNyAxMi41NCAxMi41NCAwIDAwLS4zMTUuMjU0bC0uMDQzLjAzNC0uMDEuMDA3LS4wNDUuMDQxYy0uMDkuMDc4LS4xOC4xNTgtLjI2OC4yNGwtLjEwNi4xMDFjLS4wNy4wNjctLjEzOS4xMzUtLjIwNy4yMDRsLS4wNTYuMDU0LS4wNjMuMDY3LS4xNTMuMTY0LS4xMi4xMzMtLjE0OC4xN2MtLjAyNC4wMy0uMDQ5LjA1Ny0uMDczLjA4NmwtLjA0My4wNTNhNS45NiA1Ljk2IDAgMDAtLjEyMy4xNTVsLS4xMTguMTUxYy0uMDQuMDUzLS4wOC4xMDYtLjExOC4xNmwtLjA3NS4xMDEtLjAzOC4wNTYtLjEwNy4xNTUtLjExLjE2NGE5LjkxIDkuOTEgMCAwMC0uMTY4LjI2NWMtLjAxMi4wMi0uMDIzLjA0My0uMDM3LjA2M2ExMi40MyAxMi40MyAwIDAwLS4xOTIuMzM1bC0uMDkuMTY4Yy0uMDE5LjAzNC0uMDQuMDctLjA1Ny4xMDUtLjAxMS4wMjItLjAyLjA0My0uMDMyLjA2NWwtLjA5Mi4xODgtLjA4LjE2N2ExOS4xNSAxOS4xNSAwIDAwLS4wODMuMTkyYy0uMDE3LjAzOC0uMDM1LjA3Ni0uMDUuMTE1LS4wMDguMDE2LS4wMTQuMDM0LS4wMjEuMDUxLS4wMzUuMDgzLS4wNjcuMTY3LS4xLjI1M2wtLjA1MS4xMzRjLS4wNC4xMS0uMDc3LjIyLS4xMTMuMzNsLS4wMi4wNTdjMCAuMDAyIDAgLjAwNS0uMDAyLjAwN2wtLjAwOC4wMjZjLS4wMzIuMS0uMDYuMi0uMDkuMzAxbC0uMDIzLjA4OWMtLjAyNy4xLS4wNTIuMi0uMDc1LjMwMWwtLjAwNy4wM2E3LjYzIDcuNjMgMCAwMC0uMDU3LjI2N2wtLjAwOC4wNDhjLS4wMTUuMDc0LS4wMjYuMTQ4LS4wMzguMjIzTC4wODIgOC40Yy0uMDExLjA3OC0uMDIuMTU2LS4wMjkuMjM0LS4wMDYuMDUxLS4wMTMuMTAzLS4wMTcuMTU0YTYuNTcgNi41NyAwIDAwLS4wMi4yNmMtLjAwMy4wNDQtLjAwNy4wODYtLjAwOS4xMy0uMDA0LjEyOC0uMDA3LjI1Ny0uMDA3LjM4NnY0LjA1NmMwIDEuNDc4LjQyIDIuNzQxIDEuMTM4IDMuNjkyQTQuNzUgNC43NSAwIDAwMi43MyAxOC42N2w5LjAxNSA0Ljc1M2MtMS42NTYtLjg3NC0yLjcyOC0yLjY4NS0yLjczLTUuMDUxdi00LjA1NmMwLS4xMy4wMDQtLjI2LjAxLS4zOS4wMDItLjA0My4wMDYtLjA4NS4wMS0uMTI4LjAwNS0uMDg4LjAxLS4xNzQuMDE5LS4yNjFsLjAxNy0uMTU1Yy4wMS0uMDc3LjAxOC0uMTU1LjAyOS0uMjM0bC4wMjYtLjE2NGMuMDEzLS4wNzQuMDI1LS4xNS4wMzktLjIyMy4wMi0uMTA1LjA0LS4yMS4wNjQtLjMxM2wuMDA4LS4wMzFjLjAyMy0uMS4wNDgtLjIwMS4wNzUtLjMwMWwuMDIzLS4wODhjLjAyOC0uMS4wNTgtLjIwMi4wOS0uMzAybC4wMDgtLjAyNS4wMjEtLjA2M2MuMDM2LS4xMS4wNzMtLjIyLjExMy0uMzNsLjA1Mi0uMTM0Yy4wMzEtLjA4NS4wNjUtLjE2OS4xLS4yNTMuMDIyLS4wNTYuMDQ3LS4xMTEuMDctLjE2NmExMy44NTYgMTMuODU2IDAgMDEuMTY0LS4zNThjLjAzLS4wNjMuMDYtLjEyNi4wOTItLjE4OGwuMDg4LS4xNzJhOS4yMiA5LjIyIDAgMDEuMTg3LS4zMzhsLjA5Ni0uMTY0Yy4wMzQtLjA1Ny4wNjktLjExMi4xMDQtLjE2OGwuMS0uMTU5YTEwLjQ5IDEwLjQ5IDAgMDEuNTY3LS43ODZsLjEyMy0uMTU1LjExNi0uMTM5Yy4wNS0uMDU3LjA5OC0uMTE1LjE0OC0uMTcxYTE0LjA5MiAxNC4wOTIgMCAwMS4yNzItLjI5NyA5LjcwNiA5LjcwNiAwIDAxLjQzMi0uNDI1Yy4wODgtLjA4My4xNzctLjE2My4yNjgtLjI0MWwuMDU0LS4wNDhhMTAuMDggMTAuMDggMCAwMS41NTMtLjQzNWwuMDkyLS4wNjhjLjA3NS0uMDUzLjE1LS4xMDUuMjI2LS4xNTYuMDE5LS4wMTMuMDM4LS4wMjguMDYtLjA0YTkuMTggOS4xOCAwIDAxLjM2Mi0uMjI3Yy4wOC0uMDQ3LjE2LS4wOTQuMjQxLS4xMzlsLjExLS4wNThhNy42NDMgNy42NDMgMCAwMS41MjEtLjI1NmwuMTI2LS4wNTZhNy41MDkgNy41MDkgMCAwMS41NDYtLjIwOGwuMTA3LS4wMzdjLjExLS4wMzYuMjItLjA2OS4zMy0uMWwuNjMtLjE3MmMuMDk1LS4wMjYuMTkxLS4wNS4yODctLjA3MmwuMDk3LS4wMmMuMDYyLS4wMTQuMTI1LS4wMjkuMTg3LS4wNGwuMTE0LS4wMThjLjA1NS0uMDEuMTEtLjAyLjE2Ni0uMDI4LjA0LS4wMDYuMDgtLjAxLjEyLS4wMTQuMDUzLS4wMDcuMTA1LS4wMTQuMTU3LS4wMTlsLjA4My0uMDA2Yy4wNjEtLjAwNS4xMjMtLjAxLjE4NC0uMDEzLjAzNC0uMDAzLjA2Ny0uMDAzLjEwMS0uMDA0bC4xNi0uMDA2aC4xMWEzLjE4NyAzLjE4NyAwIDAxLjI2MS4wMDhsLjE1My4wMS4wNjcuMDA3Yy4wNjQuMDA2LjEyOC4wMTMuMTkyLjAyMmwuMDQzLjAwNWE1LjIzMiA1LjIzMiAwIDAxLjI4MS4wNDdsLjE0MS4wM2MuMDczLjAxNi4xNDYuMDM1LjIxOC4wNTNsLjA3LjAxOWMuMDk0LjAyNi4xODcuMDU1LjI3OC4wODdsLjA2Ny4wMjVhNC4zMjYgNC4zMjYgMCAwMS40NDkuMTlsLjE0My4wNzJMMTEuNjE3LjU3NnoiPjwvcGF0aD48L3N2Zz4=",
  "zcode": "data:image/png;base64,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",
  "workbuddy-color": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iNjQuMDAwMyIgaGVpZ2h0PSI2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJncmFkaWVudF8wIiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KDMuOTE4ODllLTE1IDY0IC02NC4wMDAzIDMuOTE4ODdlLTE1IDMyLjAwMDIgLTEuOTU5NDNlLTE1KSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIwIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMwRUM3QTgiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwMEM4ODUiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI2dyYWRpZW50XzApIiB3aWR0aD0iNjQuMDAwMyIgaGVpZ2h0PSI2NCIgcng9IjEzLjgxMDYiIHJ5PSIxMy44MTA2Ii8+PGNsaXBQYXRoIGlkPSJjbGlwXzEiPjxyZWN0IHdpZHRoPSI2NC4wMDAzIiBoZWlnaHQ9IjY0IiByeD0iMTMuODEwNiIgcnk9IjEzLjgxMDYiLz48L2NsaXBQYXRoPjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwXzEpIj48ZGVmcz48cmFkaWFsR3JhZGllbnQgaWQ9Imdsb3dfMCI+PHN0b3Agb2Zmc2V0PSIwLjAwMCIgc3RvcC1jb2xvcj0iI0ZGRTI1NSIgc3RvcC1vcGFjaXR5PSIwLjQ5MCIvPjxzdG9wIG9mZnNldD0iMC4wNzEiIHN0b3AtY29sb3I9IiNGRkUyNTUiIHN0b3Atb3BhY2l0eT0iMC40OTAiLz48c3RvcCBvZmZzZXQ9IjAuMTQzIiBzdG9wLWNvbG9yPSIjRkZFMjU1IiBzdG9wLW9wYWNpdHk9IjAuNDkwIi8+PHN0b3Agb2Zmc2V0PSIwLjIxNCIgc3RvcC1jb2xvcj0iI0ZGRTI1NSIgc3RvcC1vcGFjaXR5PSIwLjQ4OSIvPjxzdG9wIG9mZnNldD0iMC4yODYiIHN0b3AtY29sb3I9IiNGRkUyNTUiIHN0b3Atb3BhY2l0eT0iMC40ODUiLz48c3RvcCBvZmZzZXQ9IjAuMzU3IiBzdG9wLWNvbG9yPSIjRkZFMjU1IiBzdG9wLW9wYWNpdHk9IjAuNDcyIi8+PHN0b3Agb2Zmc2V0PSIwLjQyOSIgc3RvcC1jb2xvcj0iI0ZGRTI1NSIgc3RvcC1vcGFjaXR5PSIwLjQzOSIvPjxzdG9wIG9mZnNldD0iMC41MDAiIHN0b3AtY29sb3I9IiNGRkUyNTUiIHN0b3Atb3BhY2l0eT0iMC4zNzUiLz48c3RvcCBvZmZzZXQ9IjAuNTcxIiBzdG9wLWNvbG9yPSIjRkZFMjU1IiBzdG9wLW9wYWNpdHk9IjAuMjgwIi8+PHN0b3Agb2Zmc2V0PSIwLjY0MyIgc3RvcC1jb2xvcj0iI0ZGRTI1NSIgc3RvcC1vcGFjaXR5PSIwLjE3NiIvPjxzdG9wIG9mZnNldD0iMC43MTQiIHN0b3AtY29sb3I9IiNGRkUyNTUiIHN0b3Atb3BhY2l0eT0iMC4wOTAiLz48c3RvcCBvZmZzZXQ9IjAuNzg2IiBzdG9wLWNvbG9yPSIjRkZFMjU1IiBzdG9wLW9wYWNpdHk9IjAuMDM2Ii8+PHN0b3Agb2Zmc2V0PSIwLjg1NyIgc3RvcC1jb2xvcj0iI0ZGRTI1NSIgc3RvcC1vcGFjaXR5PSIwLjAxMSIvPjxzdG9wIG9mZnNldD0iMC45MjkiIHN0b3AtY29sb3I9IiNGRkUyNTUiIHN0b3Atb3BhY2l0eT0iMC4wMDMiLz48c3RvcCBvZmZzZXQ9IjEuMDAwIiBzdG9wLWNvbG9yPSIjRkZFMjU1IiBzdG9wLW9wYWNpdHk9IjAuMDAxIi8+PC9yYWRpYWxHcmFkaWVudD48L2RlZnM+PGNpcmNsZSBmaWxsPSJ1cmwoI2dsb3dfMCkiIGN4PSI1My4zNDUzIiBjeT0iNjkuNzg5OCIgcj0iMzMuNzkzNCIvPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnRfMSIgZ3JhZGllbnRUcmFuc2Zvcm09Im1hdHJpeCg0LjM1MTM2ZS0xNSA2MC4wNDQgNzguMzg3MiAwIDM5LjE5MzYgLTIuODY1MTJlLTA2KSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIwIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNGRkYiIHN0b3Atb3BhY2l0eT0iMC44Ii8+PHN0b3Agb2Zmc2V0PSIwLjQzNzciIHN0b3AtY29sb3I9IiNGRkYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGRkYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cGF0aCBmaWxsPSJ1cmwoI2dyYWRpZW50XzEpIiBmaWxsLW9wYWNpdHk9IjEiIHRyYW5zZm9ybT0ibWF0cml4KDAuODY2MDI1IC0wLjUgMC41IDAuODY2MDI1IC03LjI1OTk0IDM3LjI0MzQpIiBkPSJNMTAuNDYzMiAyLjc1NjlDMTEuMDE2OCAxLjA4NTQgMTEuNDE4MyAwLjQzNDIgMTIuMDgwNCAwLjE2MjhDMTIuNDgyIDAgMTMuNDE1NSAwLjEzMDIgMTQuNDI0OSAwLjQ4ODRDMTYuOTUzOSAxLjQxMSAyMS43NTEzIDQuNjY3MiAyNi43NTUgOC44Njc3TDI3LjI3NiA5LjMwMThMMjkuMTk3MSA4LjkxMTFDMzIuMzg4MiA4LjI1OTggMzQuMzk2MSA4LjAyMTEgMzcuOTEyOCA3LjkwMTdDNDEuNTgxNSA3Ljc3MTQgNDUuNDIzNyA4LjE0MDUgNDkuNDgzMSA5LjAxOTZMNTAuNzg1NiA5LjMwMThMNTIuMzA1MSA4LjA2NDVDNTcuNzY0NyAzLjYwMzUgNjIuNDEwMiAwLjY3MjkgNjQuNzk4IDAuMTg0NUM2NS42MjI5IDAuMDEwOSA2NS42NjYzIDAuMDEwOSA2Ni4wNzg4IDAuMjE3MUM2Ni43NTE3IDAuNTQyNyA2Ny4xNjQyIDEuMTkzOSA2Ny42NDE4IDIuNjkxOEM2OC43NTk3IDYuMTg2NyA2OS40OTc4IDEyLjQ3MTIgNjkuMzY3NSAxNy4zOTg5TDY5LjMxMzMgMTkuMzA5Mkw3MC4xMDU2IDIwLjUwMzFDNzAuODY1NCAyMS42NjQ1IDcxLjk4MzMgMjMuNzkxOCA3Mi4zNzQxIDI0LjgxMjFDNzIuNTQ3NyAyNS4yNzg4IDcyLjU5MTIgMjUuMzExNCA3My4wMTQ1IDI1LjM3NjVDNzQuOTI0OCAyNS42Njk2IDc2LjY5NCAyNy43NjQ0IDc3LjU3MzEgMzAuNzkyNkM3OC4zNjU1IDMzLjUxNyA3OC4zODcyIDM3LjQwMjcgNzcuNjM4MiA0MC4yMDNDNzcuNTA4IDQwLjY0OCA3Ny4xNDk4IDQxLjU1OTcgNzYuODM1IDQyLjIxMUM3NS43MTcxIDQ0LjQ5MDMgNzQuMDAyMiA0NS44MzYyIDcyLjE4OTYgNDUuODQ3MUM3MS44MjA1IDQ1Ljg0NyA3MS43NzcxIDQ1Ljg3OTYgNzEuMzg2NCA0Ni41NzQzQzcwLjA1MzggNDguOTg3MSA2OC4yMjI5IDUxLjEwNzggNjUuOTMxIDUyLjkxOTdMNjUuOTMxIDE4Ljk4M0wxMi4zOTQ3IDE4Ljk4M0wxMi4zOTQ3IDUzLjY4ODdDMTIuMzg3NiA1My42ODM0IDEyLjM4MDYgNTMuNjc4MSAxMi4zNzM1IDUzLjY3MjdDOS44MDExIDUxLjc0MDcgNy4yOTM4IDQ4Ljg1MzYgNi4xNjUgNDYuNTMwOEM1Ljg3MiA0NS45MTIyIDUuODA2OSA0NS44NDcgNS4zNzI3IDQ1LjczODVDMy4wNjA4IDQ1LjE2MzIgMS4xMzk3IDQyLjQ5MzIgMC4zNDczIDM4Ljc3MDNDMC4wMzI2IDM3LjI4MzMgMCAzNC4wNTk3IDAuMjgyMiAzMi41MDc1QzAuOTU1MSAyOC44ODIzIDIuNzM1MiAyNi4yODgyIDUuMDkwNSAyNS40ODUxQzUuNjk4MyAyNS4yNzg4IDUuNzIgMjUuMjY4IDYuMDQ1NiAyNC41MTkxQzYuNTc3NSAyMy4yOTI2IDcuNTAwMSAyMS41NTU5IDguMTk0NyAyMC40OTIyTDguODM1MSAxOS40OTM3TDguODY3NyAxNS44NzkzQzguOTMyOCAxMC4yNTcgOS40NzU1IDUuODE3NyAxMC40NjMyIDIuNzU2OVpNMTIuNTAyNyA1My43NjkzQzE2LjgwMjIgNTYuOTU2NCAyMi43NjgzIDU4Ljg1ODUgMzEuMDc0OCA1OS42OTY3QzM0LjU4MDcgNjAuMDQ0IDQyLjc5NzEgNjAuMDExNCA0Ni40ODc0IDU5LjYyMDdDNTMuMzQ3MSA1OC45MTUyIDU5LjA2NzIgNTcuMjY1NCA2My4xNDgyIDU0LjgzNDFDNjMuNzE2NiA1NC40OTM4IDY0LjI2NDIgNTQuMTM4OCA2NC43OTA1IDUzLjc2OTNMMTIuNTAyNyA1My43NjkzWiIgZmlsbC1ydWxlPSJldmVub2RkIi8+PHBhdGggZmlsbD0iI0ZGRiIgdHJhbnNmb3JtPSJtYXRyaXgoMC44NjYwMjUgLTAuNSAwLjUgMC44NjYwMjUgMjkuNTkzNyA1MC4xMzU0KSIgZD0iTTYuNDE0NSAzLjIwNzJMNi40MTQ1IDEwLjExNTJRNi40MTQ1IDExLjQ0MzYgNS40NzUxIDEyLjM4M1E0LjUzNTcgMTMuMzIyNCAzLjIwNzIgMTMuMzIyNEwzLjIwNzIgMTMuMzIyNFExLjg3ODggMTMuMzIyNCAwLjkzOTQgMTIuMzgzUTAgMTEuNDQzNiAwIDEwLjExNTJMMCAzLjIwNzJRMCAxLjg3ODggMC45Mzk0IDAuOTM5NFExLjg3ODggMCAzLjIwNzIgMEwzLjIwNzIgMFE0LjUzNTcgMCA1LjQ3NTEgMC45Mzk0UTYuNDE0NSAxLjg3ODggNi40MTQ1IDMuMjA3MloiLz48cGF0aCBmaWxsPSIjRkZGIiB0cmFuc2Zvcm09Im1hdHJpeCgwLjg2NjAyNSAtMC41IDAuNSAwLjg2NjAyNSA0Ni45MDAxIDQwLjE0MzQpIiBkPSJNNi40MTQ1IDMuMjA3Mkw2LjQxNDUgMTAuMTE1MlE2LjQxNDUgMTEuNDQzNiA1LjQ3NTEgMTIuMzgzUTQuNTM1NyAxMy4zMjI0IDMuMjA3MiAxMy4zMjI0TDMuMjA3MiAxMy4zMjI0UTEuODc4OCAxMy4zMjI0IDAuOTM5NCAxMi4zODNRMCAxMS40NDM2IDAgMTAuMTE1MkwwIDMuMjA3MlEwIDEuODc4OCAwLjkzOTQgMC45Mzk0UTEuODc4OCAwIDMuMjA3MiAwTDMuMjA3MiAwUTQuNTM1NyAwIDUuNDc1MSAwLjkzOTRRNi40MTQ1IDEuODc4OCA2LjQxNDUgMy4yMDcyWiIvPjwvZz48L3N2Zz4=",
  "minimax-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPk1pbmltYXg8L3RpdGxlPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0ibG9iZS1pY29ucy1taW5pbWF4LV9SXzBfIiB4MT0iMCUiIHgyPSIxMDAuMTgyJSIgeTE9IjUwLjA1NyUiIHkyPSI1MC4wNTclIj48c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjRTIxNjdFIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjRkU2MDNDIj48L3N0b3A+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHBhdGggZD0iTTE2LjI3OCAyYzEuMTU2IDAgMi4wOTMuOTI3IDIuMDkzIDIuMDd2MTIuNTAxYS43NC43NCAwIDAwLjc0NC43MDkuNzQuNzQgMCAwMC43NDMtLjcwOVY5LjA5OWEyLjA2IDIuMDYgMCAwMTIuMDcxLTIuMDQ5QTIuMDYgMi4wNiAwIDAxMjQgOS4xdjYuNTYxYS42NDkuNjQ5IDAgMDEtLjY1Mi42NDUuNjQ5LjY0OSAwIDAxLS42NTMtLjY0NVY5LjFhLjc2Mi43NjIgMCAwMC0uNzY2LS43NTguNzYyLjc2MiAwIDAwLS43NjYuNzU4djcuNDcyYTIuMDM3IDIuMDM3IDAgMDEtMi4wNDggMi4wMjYgMi4wMzcgMi4wMzcgMCAwMS0yLjA0OC0yLjAyNnYtMTIuNWEuNzg1Ljc4NSAwIDAwLS43ODgtLjc1My43ODUuNzg1IDAgMDAtLjc4OS43NTJsLS4wMDEgMTUuOTA0QTIuMDM3IDIuMDM3IDAgMDExMy40NDEgMjJhMi4wMzcgMi4wMzcgMCAwMS0yLjA0OC0yLjAyNlYxOC4wNGMwLS4zNTYuMjkyLS42NDUuNjUyLS42NDUuMzYgMCAuNjUyLjI4OS42NTIuNjQ1djEuOTM0YzAgLjI2My4xNDIuNTA2LjM3Mi42MzguMjMuMTMxLjUxNC4xMzEuNzQ0IDBhLjczNC43MzQgMCAwMC4zNzItLjYzOFY0LjA3YzAtMS4xNDMuOTM3LTIuMDcgMi4wOTMtMi4wN3ptLTUuNjc0IDBjMS4xNTYgMCAyLjA5My45MjcgMi4wOTMgMi4wN3YxMS41MjNhLjY0OC42NDggMCAwMS0uNjUyLjY0NS42NDguNjQ4IDAgMDEtLjY1Mi0uNjQ1VjQuMDdhLjc4NS43ODUgMCAwMC0uNzg5LS43OC43ODUuNzg1IDAgMDAtLjc4OS43OHYxNC4wMTNhMi4wNiAyLjA2IDAgMDEtMi4wNyAyLjA0OCAyLjA2IDIuMDYgMCAwMS0yLjA3MS0yLjA0OFY5LjFhLjc2Mi43NjIgMCAwMC0uNzY2LS43NTguNzYyLjc2MiAwIDAwLS43NjYuNzU4djMuOGEyLjA2IDIuMDYgMCAwMS0yLjA3MSAyLjA0OUEyLjA2IDIuMDYgMCAwMTAgMTIuOXYtMS4zNzhjMC0uMzU3LjI5Mi0uNjQ2LjY1Mi0uNjQ2LjM2IDAgLjY1My4yOS42NTMuNjQ2VjEyLjljMCAuNDE4LjM0My43NTcuNzY2Ljc1N3MuNzY2LS4zMzkuNzY2LS43NTdWOS4wOTlhMi4wNiAyLjA2IDAgMDEyLjA3LTIuMDQ4IDIuMDYgMi4wNiAwIDAxMi4wNzEgMi4wNDh2OC45ODRjMCAuNDE5LjM0My43NTguNzY3Ljc1OC40MjMgMCAuNzY2LS4zMzkuNzY2LS43NThWNC4wN2MwLTEuMTQzLjkzNy0yLjA3IDIuMDkzLTIuMDd6IiBmaWxsPSJ1cmwoI2xvYmUtaWNvbnMtbWluaW1heC1fUl8wXykiIGZpbGwtcnVsZT0ibm9uemVybyI+PC9wYXRoPjwvc3ZnPg==",
  "opencode": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZWRlZGYxIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+b3BlbmNvZGU8L3RpdGxlPjxwYXRoIGQ9Ik0xNiA2SDh2MTJoOFY2em00IDE2SDRWMmgxNnYyMHoiPjwvcGF0aD48L3N2Zz4=",
  "qwenwork": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48dGl0bGU+UXdlbldvcmsgZm9yIE1hZ3BpZTwvdGl0bGU+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTYiIGZpbGw9IiMwQjlGNkUiLz48Y2lyY2xlIGN4PSIyOSIgY3k9IjI5IiByPSIxNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjciLz48cGF0aCBkPSJtMzggMzggMTEgMTEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2Utd2lkdGg9IjciLz48L3N2Zz4=",
  "qwen-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPlF3ZW48L3RpdGxlPjxwYXRoIGQ9Ik0xMi42MDQgMS4zNGMuMzkzLjY5Ljc4NCAxLjM4MiAxLjE3NCAyLjA3NWEuMTguMTggMCAwMC4xNTcuMDkxaDUuNTUyYy4xNzQgMCAuMzIyLjExLjQ0Ni4zMjdsMS40NTQgMi41N2MuMTkuMzM3LjI0LjQ3OC4wMjQuODM3LS4yNi40My0uNTEzLjg2NC0uNzYgMS4zbC0uMzY3LjY1OGMtLjEwNi4xOTYtLjIyMy4yOC0uMDQuNTEybDIuNjUyIDQuNjM3Yy4xNzIuMzAxLjExMS40OTQtLjA0My43Ny0uNDM3Ljc4NS0uODgyIDEuNTY0LTEuMzM1IDIuMzQtLjE1OS4yNzItLjM1Mi4zNzUtLjY4LjM3LS43NzctLjAxNi0xLjU1Mi0uMDEtMi4zMjcuMDE2YS4wOTkuMDk5IDAgMDAtLjA4MS4wNSA1NzUuMDk3IDU3NS4wOTcgMCAwMS0yLjcwNSA0Ljc0Yy0uMTY5LjI5My0uMzguMzYzLS43MjUuMzY0LS45OTcuMDAzLTIuMDAyLjAwNC0zLjAxNy4wMDJhLjUzNy41MzcgMCAwMS0uNDY1LS4yNzFsLTEuMzM1LTIuMzIzYS4wOS4wOSAwIDAwLS4wODMtLjA0OUg0Ljk4MmMtLjI4NS4wMy0uNTUzLS4wMDEtLjgwNS0uMDkybC0xLjYwMy0yLjc3YS41NDMuNTQzIDAgMDEtLjAwMi0uNTRsMS4yMDctMi4xMmEuMTk4LjE5OCAwIDAwMC0uMTk3IDU1MC45NTEgNTUwLjk1MSAwIDAxLTEuODc1LTMuMjcybC0uNzktMS4zOTVjLS4xNi0uMzEtLjE3My0uNDk2LjA5NS0uOTY1LjQ2NS0uODEzLjkyNy0xLjYyNSAxLjM4Ny0yLjQzNi4xMzItLjIzNC4zMDQtLjMzNC41ODQtLjMzNWEzMzguMyAzMzguMyAwIDAxMi41ODktLjAwMS4xMjQuMTI0IDAgMDAuMTA3LS4wNjNsMi44MDYtNC44OTVhLjQ4OC40ODggMCAwMS40MjItLjI0NmMuNTI0LS4wMDEgMS4wNTMgMCAxLjU4My0uMDA2TDExLjcwNCAxYy4zNDEtLjAwMy43MjQuMDMyLjkuMzR6bS0zLjQzMi40MDNhLjA2LjA2IDAgMDAtLjA1Mi4wM0w2LjI1NCA2Ljc4OGEuMTU3LjE1NyAwIDAxLS4xMzUuMDc4SDMuMjUzYy0uMDU2IDAtLjA3LjAyNS0uMDQxLjA3NGw1LjgxIDEwLjE1NmMuMDI1LjA0Mi4wMTMuMDYyLS4wMzQuMDYzbC0yLjc5NS4wMTVhLjIxOC4yMTggMCAwMC0uMi4xMTZsLTEuMzIgMi4zMWMtLjA0NC4wNzgtLjAyMS4xMTguMDY4LjExOGw1LjcxNi4wMDhjLjA0NiAwIC4wOC4wMi4xMDQuMDYxbDEuNDAzIDIuNDU0Yy4wNDYuMDgxLjA5Mi4wODIuMTM5IDBsNS4wMDYtOC43Ni43ODMtMS4zODJhLjA1NS4wNTUgMCAwMS4wOTYgMGwxLjQyNCAyLjUzYS4xMjIuMTIyIDAgMDAuMTA3LjA2MmwyLjc2My0uMDJhLjA0LjA0IDAgMDAuMDM1LS4wMi4wNDEuMDQxIDAgMDAwLS4wNGwtMi45LTUuMDg2YS4xMDguMTA4IDAgMDEwLS4xMTNsLjI5My0uNTA3IDEuMTItMS45NzdjLjAyNC0uMDQxLjAxMi0uMDYyLS4wMzUtLjA2Mkg5LjJjLS4wNTkgMC0uMDczLS4wMjYtLjA0My0uMDc3bDEuNDM0LTIuNTA1YS4xMDcuMTA3IDAgMDAwLS4xMTRMOS4yMjUgMS43NzRhLjA2LjA2IDAgMDAtLjA1My0uMDMxem02LjI5IDguMDJjLjA0NiAwIC4wNTguMDIuMDM0LjA2bC0uODMyIDEuNDY1LTIuNjEzIDQuNTg1YS4wNTYuMDU2IDAgMDEtLjA1LjAyOS4wNTguMDU4IDAgMDEtLjA1LS4wMjlMOC40OTggOS44NDFjLS4wMi0uMDM0LS4wMS0uMDUyLjAyOC0uMDU0bC4yMTYtLjAxMiA2LjcyMi0uMDEyeiIgZmlsbD0idXJsKCNsb2JlLWljb25zLXF3ZW4tX1JfMF8pIiBmaWxsLXJ1bGU9Im5vbnplcm8iPjwvcGF0aD48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImxvYmUtaWNvbnMtcXdlbi1fUl8wXyIgeDE9IjAlIiB4Mj0iMTAwJSIgeTE9IjAlIiB5Mj0iMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM2MzM2RTciIHN0b3Atb3BhY2l0eT0iLjg0Ij48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjNkY2OUY3IiBzdG9wLW9wYWNpdHk9Ii44NCI+PC9zdG9wPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjwvc3ZnPg==",
  "qwenpaw": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiBmaWxsPSJub25lIiB2ZXJzaW9uPSIxLjEiIHdpZHRoPSIxNzUuMzUwMDA2MTAzNTE1NjIiIGhlaWdodD0iMjM1LjQxOTk5ODE2ODk0NTMiIHZpZXdCb3g9IjAgMCAxNzUuMzUwMDA2MTAzNTE1NjIgMjM1LjQxOTk5ODE2ODk0NTMiPjxkZWZzPjxjbGlwUGF0aCBpZD0icXdlbnBhdy1jbGlwIj48cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iMTc1LjM1MDAwNjEwMzUxNTYyIiBoZWlnaHQ9IjIzNS40MTk5OTgxNjg5NDUzIiByeD0iMCIvPjwvY2xpcFBhdGg+PC9kZWZzPjxnIGNsaXAtcGF0aD0idXJsKCNxd2VucGF3LWNsaXApIj48cGF0aCBkPSJNODMuMTA4MzYsMjI5Ljk5OTg0ODU1NDY4NzVDMTI5LjAwNzg0LDIyOS45OTk4NDg1NTQ2ODc1LDE2Ni4yMTY3MiwxOTMuOTc4NDM4NTU0Njg3NSwxNjYuMjE2NzIsMTQ5LjU0MzgwNzU1NDY4NzVDMTY2LjIxNjcyLDEwNS4xMDkxNjE1NTQ2ODc1LDEyOS4wMDc4NCw2OS4wODc3Njg1NTQ2ODc1LDgzLjEwODM2LDY5LjA4Nzc2ODU1NDY4NzVDMzcuMjA4ODg1LDY5LjA4Nzc2ODU1NDY4NzUsMCwxMDUuMTA5MTYxNTU0Njg3NSwwLDE0OS41NDM4MDc1NTQ2ODc1QzAsMTkzLjk3ODQzODU1NDY4NzUsMzcuMjA4ODg1LDIyOS45OTk4NDg1NTQ2ODc1LDgzLjEwODM2LDIyOS45OTk4NDg1NTQ2ODc1Wk04My4xMDg3MzQsMTk1LjM5NTAyODU1NDY4NzQ5QzEwOS4yNjY1MSwxOTUuMzk1MDI4NTU0Njg3NDksMTMwLjQ3MTU3LDE3NC44NjY3MDg1NTQ2ODc1LDEzMC40NzE1NywxNDkuNTQzNzM5NTU0Njg3NUMxMzAuNDcxNTcsMTI0LjIyMDc3MTU1NDY4NzUsMTA5LjI2NjUxLDEwMy42OTI0NTE1NTQ2ODc1LDgzLjEwODczNCwxMDMuNjkyNDUxNTU0Njg3NUM1Ni45NTA5NjYsMTAzLjY5MjQ1MTU1NDY4NzUsMzUuNzQ1OTE0LDEyNC4yMjA3NzE1NTQ2ODc1LDM1Ljc0NTkxNCwxNDkuNTQzNzM5NTU0Njg3NUMzNS43NDU5MTQsMTc0Ljg2NjcwODU1NDY4NzUsNTYuOTUwOTY2LDE5NS4zOTUwMjg1NTQ2ODc0OSw4My4xMDg3MzQsMTk1LjM5NTAyODU1NDY4NzQ5WiIgZmlsbC1ydWxlPSJldmVub2RkIiBmaWxsPSIjMDAwMDAwIiBmaWxsLW9wYWNpdHk9IjEiLz48cGF0aCBkPSJNODAuMzE4MzU1NTU2MjUsNDYuNDg5MTU4ODQzNzVDODIuMzE1Mzc4MTU2MjUsNDguNDM1NjM0ODQzNzUsODQuNjkwNDgxNjU2MjUsNDkuOTY1NzAxODQzNzUsODcuNDQzNjU3NjU2MjUsNTEuMDc5MzYwODQzNzVDOTAuMTk2ODMyNjU2MjUsNTIuMTkzMDE1ODQzNzUsOTMuMTgyNjcyNjU2MjQ5OTksNTIuNzU0Njg3ODQzNzUsOTYuNDAxMTc4NjU2MjUsNTIuNzU0Njg3ODQzNzVDOTkuNjE5Njg0NjU2MjUsNTIuNzU0Njg3ODQzNzUsMTAyLjY4MzA4NDY1NjI1LDUyLjE4MzMyNjg0Mzc1LDEwNS40MjY1NjE2NTYyNSw1MS4wNTAzMDc4NDM3NUMxMDguMTc5NzM2NjU2MjUsNDkuOTA3NjAwODQzNzUsMTEwLjU2NDU0MDY1NjI1LDQ4LjM1ODE2NTg0Mzc1LDExMi41OTA2NDA2NTYyNSw0Ni4zODI2MzY4NDM3NUMxMTQuNjE2NzQxNjU2MjUsNDQuNDA3MTA3ODQzNzUsMTE2LjE5NjkxNDY1NjI1LDQyLjExMjAxMDg0Mzc1LDExNy4zNDA4Mzk2NTYyNSwzOS40OTczMzg4NDM3NUMxMTguNDg0NzcxNjU2MjQ5OTksMzYuODgyNjY1ODQzNzUwMDA0LDExOS4wNDcwNDI2NTYyNSwzNC4wNjQ2MzI4NDM3NTAwMDUsMTE5LjA0NzA0MjY1NjI1LDMxLjA2MjYwNDg0Mzc1TDExOS4wNDcwNDI2NTYyNSwzMC45MDc2NjE4NDM3NUMxMTkuMDQ3MDQyNjU2MjUsMjcuOTA1NjMxODQzNzUsMTE4LjQ3NTA4MjY1NjI1MDAxLDI1LjA4NzU5OTg0Mzc1LDExNy4zNDA4Mzk2NTYyNSwyMi40NzI5Mjc4NDM3NUMxMTYuMTk2OTE0NjU2MjUsMTkuODQ4NTczODQzNzUsMTE0LjYyNjQ0MTY1NjI1LDE3LjU3Mjg0MTY0Mzc1LDExMi42Mjk0MjE2NTYyNSwxNS42MjYzNjQ3NDM3NDk5OTlDMTEwLjYzMjM5NjY1NjI1LDEzLjY3OTg4Nzc0Mzc1MDAwMSwxMDguMjU3Mjg5NjU2MjUwMDEsMTIuMTQ5ODIxNzQzNzUsMTA1LjUwNDExNzY1NjI1LDExLjAzNjE2NTg0Mzc1QzEwMi43NTA5NDI2NTYyNSw5LjkyMjUwOTkwMzc1LDk5Ljc2NTA5ODY1NjI1LDkuMzYwODM5ODQzNzUsOTYuNTQ2NTk0NjU2MjUsOS4zNjA4Mzk4NDM3NUM5My4zMjgwOTI2NTYyNDk5OSw5LjM2MDgzOTg0Mzc1LDkwLjI2NDY5MDY1NjI1LDkuOTMyMTkzNzUzNzUsODcuNTExNTE3NjU2MjQ5OTksMTEuMDY1MjE3NzQzNzVDODQuNzU4MzQxNjU2MjUsMTIuMjA3OTI1NTQzNzUwMDAxLDgyLjM3MzUzOTk1NjI1LDEzLjc1NzM1OTU0Mzc0OTk5OSw4MC4zNDc0MzY4NTYyNSwxNS43MzI4ODkxNDM3NUM3OC4zMjEzMzQzNTYyNSwxNy43MDg0MTc4NDM3NSw3Ni43NDExNjAzNTYyNSwxOS45OTM4MzI4NDM3NSw3NS41OTcyMzM1NTYyNSwyMi42MTgxODg4NDM3NDk5OThDNzQuNDUzMzA3MjE2MjUsMjUuMjMyODU5ODQzNzUsNzMuODgxMzQ3NjU2MjUsMjguMDUwODkzODQzNzUsNzMuODgxMzQ3NjU2MjUsMzEuMDUyOTIyODQzNzVMNzMuODgxMzQ3NjU2MjUsMzEuMjA3ODY0ODQzNzVDNzMuODgxMzQ3NjU2MjUsMzQuMjE5NTc5ODQzNzUsNzQuNDUzMzA3MjE2MjUsMzcuMDI3OTI3ODQzNzUsNzUuNTk3MjMzNTU2MjUsMzkuNjUyMjgyODQzNzVDNzYuNzQxMTYwMzU2MjUsNDIuMjY2OTU5ODQzNzUsNzguMzExNjM4MzU2MjUsNDQuNTUyMzc1ODQzNzUsODAuMzA4NjU5NTU2MjUsNDYuNDg5MTYyODQzNzVMODAuMzE4MzU1NTU2MjUsNDYuNDg5MTU4ODQzNzVaIiBmaWxsPSIjRkY5RDREIiBmaWxsLW9wYWNpdHk9IjEiIHN0eWxlPSJtaXgtYmxlbmQtbW9kZTpwYXNzdGhyb3VnaCIgdHJhbnNmb3JtPSJtYXRyaXgoMC45OTAxMjkxNzI4MDE5NzE0LC0wLjE0MDgzNjczMDU5OTQwMzM4LDAuMTQwNjIyODk4OTM2MjcxNjcsMC45ODk5NjYyMTM3MDMxNTU1LC0wLjU4NzA3ODQxOTQzMzk2NDksMTAuNDk5MTMyMTIyNzM1MzE4KSIvPjxwYXRoIGQ9Ik0yMS42OTU5NjAwMjIyNDEyMSw1OC4zMzcxODEzMDQ2ODc1QzIzLjY5MjU1NTQyMjI0MTIxMyw2MC4yODM2NTczMDQ2ODc1LDI2LjA2NzE0NjkyMjI0MTIxLDYxLjgxMzcyODMwNDY4NzUsMjguODE5NzM1OTIyMjQxMjEsNjIuOTI3MzgzMzA0Njg3NUMzMS41NzIzMjA5MjIyNDEyMSw2NC4wNDEwMzgzMDQ2ODc1LDM0LjU1NzUyMTkyMjI0MTIxLDY0LjYwMjcxMDMwNDY4NzQ5LDM3Ljc3NTMzNjkyMjI0MTIxLDY0LjYwMjcxMDMwNDY4NzQ5QzQwLjk5MzE1MjkyMjI0MTIxLDY0LjYwMjcxMDMwNDY4NzQ5LDQ0LjA1NTg4ODkyMjI0MTIxLDY0LjAzMTM0OTMwNDY4NzUsNDYuNzk4NzgxOTIyMjQxMjEsNjIuODg4NjM3MzA0Njg3NUM0OS41NTEzNzA5MjIyNDEyMSw2MS43NDU5MzczMDQ2ODc1LDUxLjkzNTY1MTkyMjI0MTIxLDYwLjE5NjUwMjMwNDY4NzUsNTMuOTYxMzI0OTIyMjQxMjEsNTguMjIwOTcwMzA0Njg3NUM1NS45ODY5OTc5MjIyNDEyMSw1Ni4yNDU0NDUzMDQ2ODc1LDU3LjU2NjgzMTkyMjI0MTIxNCw1My45NjAwMjkzMDQ2ODc1LDU4LjcxMDUxMTkyMjI0MTIxLDUxLjMzNTY3NDMwNDY4NzVDNTkuODU0MTg4OTIyMjQxMjE0LDQ4LjcyMTAwMjMwNDY4NzUsNjAuNDI2MDM0OTIyMjQxMjEsNDUuOTAyOTY5MzA0Njg3NSw2MC40MjYwMzQ5MjIyNDEyMSw0Mi45MDA5NDAzMDQ2ODc0OTVMNjAuNDI2MDM0OTIyMjQxMjEsNDIuNzQ1OTk4MzA0Njg3NTA0QzYwLjQyNjAzNDkyMjI0MTIxLDM5Ljc0Mzk3MjMwNDY4NzUsNTkuODU0MTg4OTIyMjQxMjE0LDM2LjkzNTYyMDMwNDY4NzUwNCw1OC43MTA1MTE5MjIyNDEyMSwzNC4zMTEyNjYzMDQ2ODc1QzU3LjU2NjgzMTkyMjI0MTIxNCwzMS42ODY5MTEzMDQ2ODc1LDU1Ljk5NjY5MDkyMjI0MTIxNCwyOS40MTExNzk1MDQ2ODc1LDU0LjAwMDA4OTkyMjI0MTIxLDI3LjQ3NDM4NjcwNDY4NzVDNTIuMDAzNDk5OTIyMjQxMjEsMjUuNTI3OTEwMjA0Njg3NSw0OS42Mjg5MDM5MjIyNDEyMTQsMjMuOTk3ODQzNTA0Njg3NSw0Ni44NzYzMjE5MjIyNDEyMSwyMi44ODQxODc4MDQ2ODc1QzQ0LjEyMzczNTkyMjI0MTIxLDIxLjc3MDUzMjE5NDY4NzUsNDEuMTM4NTM2OTIyMjQxMjE1LDIxLjIwODg2MjMwNDY4NzUsMzcuOTIwNzIwOTIyMjQxMjE2LDIxLjIwODg2MjMwNDY4NzVDMzQuNzAyOTA1OTIyMjQxMjE0LDIxLjIwODg2MjMwNDY4NzUsMzEuNjQwMTY4OTIyMjQxMjEyLDIxLjc4MDIxNjMzNDY4NzUsMjguODg3NTgxOTIyMjQxMjEsMjIuOTIyOTI0NjA0Njg3NUMyNi4xMzQ5OTQ5MjIyNDEyMTIsMjQuMDY1NjMyNjA0Njg3NSwyMy43NTA3MDk1MjIyNDEyMSwyNS42MTUwNjc1MDQ2ODc1LDIxLjcyNTAzOTAyMjI0MTIxMiwyNy41OTA1OTQ4MDQ2ODc1QzE5LjY5OTM2NzUyMjI0MTIxLDI5LjU2NjEyNTkwNDY4NzUsMTguMTE5NTM3MzIyMjQxMjEsMzEuODYxMjI0MzA0Njg3NSwxNi45NzU4NTcwMjIyNDEyMSwzNC40NzU4OTYzMDQ2ODc1QzE1LjgzMjE3NTk3MjI0MTIxMSwzNy4wOTA1NjczMDQ2ODc1LDE1LjI2MDMzNTkyMjI0MTIxMSwzOS45MDg1OTgzMDQ2ODc1LDE1LjI2MDMzNTkyMjI0MTIxMSw0Mi45MTA2MjczMDQ2ODc1TDE1LjI2MDMzNTkyMjI0MTIxMSw0My4wNjU1NzEzMDQ2ODc0OTVDMTUuMjYwMzM1OTIyMjQxMjExLDQ2LjA3NzI4NTMwNDY4NzUsMTUuODMyMTc1OTcyMjQxMjExLDQ4Ljg4NTYzMTMwNDY4NzUsMTYuOTc1ODU3MDIyMjQxMjEsNTEuNTA5OTg4MzA0Njg3NUMxOC4xMTk1Mzc4MjIyNDEyMSw1NC4xMjQ2NjAzMDQ2ODc1LDE5LjY4OTY3NTgyMjI0MTIxMyw1Ni40MTAwNzYzMDQ2ODc1LDIxLjY4NjI3MTYyMjI0MTIxLDU4LjM1NjU1MjMwNDY4NzVMMjEuNjk1OTYwMDIyMjQxMjEsNTguMzM3MTgxMzA0Njg3NVoiIGZpbGw9IiNGRjlENEQiIGZpbGwtb3BhY2l0eT0iMSIgc3R5bGU9Im1peC1ibGVuZC1tb2RlOnBhc3N0aHJvdWdoIiB0cmFuc2Zvcm09Im1hdHJpeCgwLjk5MDEyOTE3MjgwMTk3MTQsLTAuMTQwODM2NzMwNTk5NDAzMzgsMC4xNDA2MjI4OTg5MzYyNzE2NywwLjk4OTk2NjIxMzcwMzE1NTUsLTIuODMxODE5NTYxNTUzMDYxMiwyLjM2MjAyMTAxMTEwMTUxODMpIi8+PHBhdGggZD0iTTEyOC44NzcwOTkwMjUsODAuNzE0MjMzMjk2ODc1QzEzMC44NzQ5MDU2MjUsODIuNjYwMzY2Mjk2ODc1LDEzMy4yNTA5Mzg2MjUsODQuMTkwMTYyMjk2ODc1LDEzNi4wMDUyMTE2MjUsODUuMzAzNjE1Mjk2ODc1QzEzOC43NTk0Njc2MjUsODYuNDE3MDY4Mjk2ODc1LDE0MS43NDY0ODY2MjUsODYuOTc4NjM3Mjk2ODc1MDEsMTQ0Ljk2NjI2NDYyNSw4Ni45Nzg2MzcyOTY4NzUwMUMxNDguMTg2MDQyNjI1LDg2Ljk3ODYzNzI5Njg3NTAxLDE1MS4yNTA2MzM2MjUsODYuNDA3Mzg2Mjk2ODc1LDE1My45OTUyMDA2MjUsODUuMjY0ODg1Mjk2ODc1MDFDMTU2Ljc0OTQ1NDYyNSw4NC4xMjIzNzkyOTY4NzUwMSwxNTkuMTM1MjAwNjI1LDgyLjU3MzIyMzI5Njg3NSwxNjEuMTYyMDk3NjI1LDgwLjU5ODA0MTI5Njg3NTAxQzE2My4xODg5OTU2MjUsNzguNjIyODcxMjk2ODc0OTksMTY0Ljc2OTc5NDYyNSw3Ni4zMzc4NTYyOTY4NzUsMTY1LjkxNDE2MTYyNSw3My43MTM5NzQyOTY4NzVDMTY3LjA1ODUyODYyNSw3MS4wOTk3NjcyOTY4NzUsMTY3LjYyMTAyODYyNSw2OC4yODIyMzQyOTY4NzUsMTY3LjYyMTAyODYyNSw2NS4yODA3NDAyOTY4NzVMMTY3LjYyMTAyODYyNSw2NS4xMjU4MjcyOTY4NzVDMTY3LjYyMTAyODYyNSw2Mi4xMjQzMzYyOTY4NzUsMTY3LjA0ODgzOTYyNSw1OS4zMTY0ODQyOTY4NzUwMDQsMTY1LjkxNDE2MTYyNSw1Ni42OTI1OTcyOTY4NzVDMTY0Ljc2OTc5NDYyNSw1NC4wNjg3MTIyOTY4NzUsMTYzLjE5ODY4NDYyNSw1MS43OTMzODQ1OTY4NzUsMTYxLjIwMDg4MTYyNSw0OS44NTY5MzczOTY4NzVDMTU5LjIwMzA3NTYyNSw0Ny45MTA4MDcwOTY4NzUsMTU2LjgyNzA0MTYyNSw0Ni4zODEwMTMzOTY4NzUsMTU0LjA3Mjc3MjYyNSw0NS4yNjc1NTYxOTY4NzVDMTUxLjMxODUwOTYyNSw0NC4xNTQwOTkxMDY4NzUsMTQ4LjMzMTQ5MzYyNSw0My41OTI1MjkyOTY4NzUsMTQ1LjEyMTQyMzYyNSw0My41OTI1MjkyOTY4NzVDMTQxLjkxMTM1MjYyNSw0My41OTI1MjkyOTY4NzUsMTM4LjgzNzA1NjYyNSw0NC4xNjM3ODE1ODY4NzUsMTM2LjA4Mjc5ODYyNSw0NS4zMDYyODYwOTY4NzVDMTMzLjMyODU0MDYyNSw0Ni40NDg3OTA1OTY4NzUsMTMwLjk0Mjc5OTUyNSw0Ny45OTc5NTAwOTY4NzUsMTI4LjkxNTg5OTcyNSw0OS45NzMxMjU0OTY4NzVDMTI2Ljg4ODk5OTQyNSw1MS45NDgzMDQxOTY4NzUsMTI1LjMwODIwMzQyNSw1NC4yNDI5OTIyOTY4NzUsMTI0LjE2MzgyNjgyNSw1Ni44NTcxOTkyOTY4NzVDMTIzLjAxOTQ1MDE4NSw1OS40NzE0MDQyOTY4NzUsMTIyLjQ0NzI2NTYyNSw2Mi4yODg5MzYyOTY4NzUsMTIyLjQ0NzI2NTYyNSw2NS4yOTA0MzAyOTY4NzVMMTIyLjQ0NzI2NTYyNSw2NS40NDUzNDMyOTY4NzVDMTIyLjQ0NzI2NTYyNSw2OC40NTY1MTgyOTY4NzUsMTIzLjAxOTQ1MDE4NSw3MS4yNjQzNjYyOTY4NzUsMTI0LjE2MzgyNjgyNSw3My44ODgyNTYyOTY4NzVDMTI1LjMwODIwMzQyNSw3Ni41MDI0NjAyOTY4NzUsMTI2Ljg3OTI5OTEyNSw3OC43ODc0NzEyOTY4NzUsMTI4Ljg3NzEwNjIyNSw4MC43MzM2MDAyOTY4NzVMMTI4Ljg3NzA5OTAyNSw4MC43MTQyMzMyOTY4NzVaIiBmaWxsPSIjRkY5RDREIiBmaWxsLW9wYWNpdHk9IjEiIHN0eWxlPSJtaXgtYmxlbmQtbW9kZTpwYXNzdGhyb3VnaCIgdHJhbnNmb3JtPSJtYXRyaXgoMC44OTk4NDk0MTQ4MjU0Mzk1LC0wLjQzNjIwMDcwODE1MDg2MzY1LDAuNDM1NjkzNzcwNjQ3MDQ4OTUsMC45MDAwOTQ5ODU5NjE5MTQxLC02LjcyOTgyODE1NjAyODgxNiw1Ny43NjY2OTYyMjgxMjE4NykiLz48cmVjdCB4PSIxMzEuODg5MTYwMTU2MjUiIHk9IjE1Mi4yNTU4NTkzNzUiIHdpZHRoPSIzNC4zMjczNjk2ODk5NDE0MDYiIGhlaWdodD0iNzcuNzQ0MDQxNDQyODcxMSIgcng9IjAiIGZpbGw9IiMwMDAwMDAiIGZpbGwtb3BhY2l0eT0iMSIvPjwvZz48L3N2Zz4=",
  "deepseek-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPkRlZXBTZWVrPC90aXRsZT48cGF0aCBkPSJNMjMuNzQ4IDQuNDgyYy0uMjU0LS4xMjQtLjM2NC4xMTMtLjUxMi4yMzQtLjA1MS4wMzktLjA5NC4wOS0uMTM3LjEzNi0uMzcyLjM5Ny0uODA2LjY1Ny0xLjM3My42MjYtLjgyOS0uMDQ2LTEuNTM3LjIxNC0yLjE2My44NDgtLjEzMy0uNzgyLS41NzUtMS4yNDgtMS4yNDctMS41NDgtLjM1Mi0uMTU2LS43MDgtLjMxMS0uOTU1LS42NS0uMTcyLS4yNDEtLjIxOS0uNTEtLjMwNS0uNzc0LS4wNTUtLjE2LS4xMS0uMzIzLS4yOTMtLjM1LS4yLS4wMzEtLjI3OC4xMzYtLjM1Ni4yNzYtLjMxMy41NzItLjQzNCAxLjIwMi0uNDIyIDEuODQuMDI3IDEuNDM2LjYzMyAyLjU4IDEuODM4IDMuMzkzLjEzNy4wOTMuMTcyLjE4Ny4xMjkuMzIzLS4wODIuMjgtLjE4LjU1Mi0uMjY2LjgzMy0uMDU1LjE3OS0uMTM3LjIxNy0uMzI5LjE0YTUuNTI2IDUuNTI2IDAgMDEtMS43MzYtMS4xOGMtLjg1Ny0uODI4LTEuNjMxLTEuNzQyLTIuNTk3LTIuNDU4YTExLjM2NSAxMS4zNjUgMCAwMC0uNjg5LS40NzFjLS45ODUtLjk1Ny4xMy0xLjc0My4zODgtMS44MzYuMjctLjA5OC4wOTMtLjQzMi0uNzc5LS40MjgtLjg3Mi4wMDQtMS42Ny4yOTUtMi42ODcuNjg0YTMuMDU1IDMuMDU1IDAgMDEtLjQ2NS4xMzcgOS41OTcgOS41OTcgMCAwMC0yLjg4My0uMTAyYy0xLjg4NS4yMS0zLjM5IDEuMTAyLTQuNDk3IDIuNjIzQy4wODIgOC42MDYtLjIzMSAxMC42ODQuMTUyIDEyLjg1Yy40MDMgMi4yODQgMS41NjkgNC4xNzUgMy4zNiA1LjY1MyAxLjg1OCAxLjUzMyAzLjk5NyAyLjI4NCA2LjQzOCAyLjE0IDEuNDgyLS4wODUgMy4xMzMtLjI4NCA0Ljk5NC0xLjg2LjQ3LjIzNC45NjIuMzI3IDEuNzguMzk3LjYzLjA1OSAxLjIzNi0uMDMgMS43MDUtLjEyOC43MzUtLjE1Ni42ODQtLjgzNy40MTktLjk2MS0yLjE1NS0xLjAwNC0xLjY4Mi0uNTk1LTIuMTEzLS45MjYgMS4wOTYtMS4yOTYgMi43NDYtMi42NDIgMy4zOTItNy4wMDMuMDUtLjM0Ny4wMDctLjU2NSAwLS44NDUtLjAwNC0uMTcuMDM1LS4yMzcuMjMtLjI1NmE0LjE3MyA0LjE3MyAwIDAwMS41NDUtLjQ3NWMxLjM5Ni0uNzYzIDEuOTYtMi4wMTUgMi4wOTMtMy41MTcuMDItLjIzLS4wMDQtLjQ2Ny0uMjQ3LS41ODh6TTExLjU4MSAxOGMtMi4wODktMS42NDItMy4xMDItMi4xODMtMy41Mi0yLjE2LS4zOTIuMDI0LS4zMjEuNDcxLS4yMzUuNzYzLjA5LjI4OC4yMDcuNDg2LjM3MS43MzkuMTE0LjE2Ny4xOTIuNDE2LS4xMTMuNjAzLS42NzMuNDE2LTEuODQyLS4xNC0xLjg5Ny0uMTY3LTEuMzYxLS44MDItMi41LTEuODYtMy4zMDEtMy4zMDctLjc3NC0xLjM5My0xLjIyNC0yLjg4Ny0xLjI5OC00LjQ4Mi0uMDItLjM4Ni4wOTMtLjUyMi40NzctLjU5MmE0LjY5NiA0LjY5NiAwIDAxMS41MjktLjAzOWMyLjEzMi4zMTIgMy45NDYgMS4yNjUgNS40NjggMi43NzQuODY4Ljg2IDEuNTI1IDEuODg3IDIuMjAyIDIuODkxLjcyIDEuMDY2IDEuNDk0IDIuMDgyIDIuNDggMi45MTQuMzQ4LjI5Mi42MjUuNTE0Ljg5MS42NzctLjgwMi4wOS0yLjE0LjExLTMuMDU0LS42MTR6bTEtNi40NGEuMzA2LjMwNiAwIDAxLjQxNS0uMjg3LjMwMi4zMDIgMCAwMS4yLjI4OC4zMDYuMzA2IDAgMDEtLjMxLjMwNy4zMDMuMzAzIDAgMDEtLjMwNC0uMzA4em0zLjExIDEuNTk2Yy0uMi4wODEtLjM5OS4xNTEtLjU5LjE2YTEuMjQ1IDEuMjQ1IDAgMDEtLjc5OC0uMjU0Yy0uMjc0LS4yMy0uNDctLjM1OC0uNTUyLS43NThhMS43MyAxLjczIDAgMDEuMDE2LS41ODhjLjA3LS4zMjctLjAwOC0uNTM3LS4yMzktLjcyNy0uMTg3LS4xNTYtLjQyNi0uMTk5LS42ODgtLjE5OWEuNTU5LjU1OSAwIDAxLS4yNTQtLjA3OGMtLjExLS4wNTQtLjItLjE5LS4xMTQtLjM1OC4wMjgtLjA1NC4xNi0uMTg2LjE5Mi0uMjEuMzU2LS4yMDIuNzY3LS4xMzYgMS4xNDYuMDE2LjM1Mi4xNDQuNjE4LjQwOCAxLjAwMS43ODIuMzkxLjQ1MS40NjIuNTc2LjY4NS45MTQuMTc2LjI2NS4zMzYuNTM3LjQ0NS44NDguMDY3LjE5NS0uMDE5LjM1NC0uMjUuNDUyeiIgZmlsbD0iIzRENkJGRSI+PC9wYXRoPjwvc3ZnPg==",
  "claude-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPkNsYXVkZTwvdGl0bGU+PHBhdGggZD0iTTQuNzA5IDE1Ljk1NWw0LjcyLTIuNjQ3LjA4LS4yMy0uMDgtLjEyOEg5LjJsLS43OS0uMDQ4LTIuNjk4LS4wNzMtMi4zMzktLjA5Ny0yLjI2Ni0uMTIyLS41NzEtLjEyMUwwIDExLjc4NGwuMDU1LS4zNTIuNDgtLjMyMS42ODYuMDYgMS41Mi4xMDMgMi4yNzguMTU4IDEuNjUyLjA5NyAyLjQ0OS4yNTVoLjM4OWwuMDU1LS4xNTctLjEzNC0uMDk4LS4xMDMtLjA5Ny0yLjM1OC0xLjU5Ni0yLjU1Mi0xLjY4OC0xLjMzNi0uOTcyLS43MjQtLjQ5MS0uMzY0LS40NjItLjE1OC0xLjAwOC42NTYtLjcyMi44ODEuMDYuMjI1LjA2MS44OTMuNjg2IDEuOTA4IDEuNDc2IDIuNDkxIDEuODMzLjM2NS4zMDQuMTQ1LS4xMDMuMDE5LS4wNzMtLjE2NC0uMjc0LTEuMzU1LTIuNDQ2LTEuNDQ2LTIuNDktLjY0NC0xLjAzMi0uMTctLjYxOWEyLjk3IDIuOTcgMCAwMS0uMTA0LS43MjlMNi4yODMuMTM0IDYuNjk2IDBsLjk5Ni4xMzQuNDIuMzY0LjYyIDEuNDE0IDEuMDAyIDIuMjI5IDEuNTU1IDMuMDMuNDU2Ljg5OC4yNDMuODMyLjA5MS4yNTVoLjE1OFY5LjAxbC4xMjgtMS43MDYuMjM3LTIuMDk1LjIzLTIuNjk1LjA4LS43Ni4zNzYtLjkxLjc0Ny0uNDkyLjU4NC4yOC40OC42ODUtLjA2Ny40NDQtLjI4NiAxLjg1MS0uNTU5IDIuOTAzLS4zNjQgMS45NDJoLjIxMmwuMjQzLS4yNDIuOTg1LTEuMzA2IDEuNjUyLTIuMDY0LjczLS44Mi44NS0uOTA0LjU0Ny0uNDMxaDEuMDMzbC43NiAxLjEyOS0uMzQgMS4xNjYtMS4wNjQgMS4zNDctLjg4MSAxLjE0Mi0xLjI2NCAxLjctLjc5IDEuMzYuMDczLjExLjE4OC0uMDIgMi44NTYtLjYwNiAxLjU0My0uMjggMS44NDEtLjMxNS44MzMuMzg4LjA5MS4zOTUtLjMyOC44MDctMS45NjkuNDg2LTIuMzA5LjQ2Mi0zLjQzOS44MTMtLjA0Mi4wMy4wNDkuMDYxIDEuNTQ5LjE0Ni42NjIuMDM2aDEuNjIybDMuMDIuMjI1Ljc5LjUyMi40NzQuNjM4LS4wNzkuNDg1LTEuMjE1LjYyLTEuNjQtLjM4OS0zLjgyOS0uOTEtMS4zMTItLjMyOWgtLjE4MnYuMTFsMS4wOTMgMS4wNjggMi4wMDYgMS44MSAyLjUwOSAyLjMzLjEyNy41NzgtLjMyMi40NTUtLjM0LS4wNDktMi4yMDUtMS42NTctLjg1MS0uNzQ3LTEuOTI2LTEuNjJoLS4xMjh2LjE3bC40NDQuNjQ5IDIuMzQ1IDMuNTIxLjEyMiAxLjA4LS4xNy4zNTMtLjYwOC4yMTMtLjY2OC0uMTIyLTEuMzc0LTEuOTI1LTEuNDE1LTIuMTY3LTEuMTQzLTEuOTQzLS4xNC4wOC0uNjc0IDcuMjU0LS4zMTYuMzctLjcyOS4yOC0uNjA3LS40NjEtLjMyMi0uNzQ3LjMyMi0xLjQ3Ni4zODktMS45MjQuMzE1LTEuNTMuMjg2LTEuOS4xNy0uNjMyLS4wMTItLjA0Mi0uMTQuMDE4LTEuNDM0IDEuOTY3LTIuMTggMi45NDUtMS43MjYgMS44NDUtLjQxNC4xNjQtLjcxNy0uMzcuMDY3LS42NjIuNDAxLS41ODkgMi4zODgtMy4wMzYgMS40NC0xLjg4Mi45My0xLjA4Ni0uMDA2LS4xNThoLS4wNTVMNC4xMzIgMTguNTZsLTEuMTMuMTQ2LS40ODctLjQ1Ni4wNjEtLjc0Ni4yMzEtLjI0MyAxLjkwOC0xLjMxMi0uMDA2LjAwNnoiIGZpbGw9IiNEOTc3NTciIGZpbGwtcnVsZT0ibm9uemVybyI+PC9wYXRoPjwvc3ZnPg==",
  "anthropic": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZThhODdjIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+QW50aHJvcGljPC90aXRsZT48cGF0aCBkPSJNMTMuODI3IDMuNTJoMy42MDNMMjQgMjBoLTMuNjAzbC02LjU3LTE2LjQ4em0tNy4yNTggMGgzLjc2N0wxNi45MDYgMjBoLTMuNjc0bC0xLjM0My0zLjQ2MUg1LjAxN2wtMS4zNDQgMy40NkgwTDYuNTcgMy41MjJ6bTQuMTMyIDkuOTU5TDguNDUzIDcuNjg3IDYuMjA1IDEzLjQ4SDEwLjd6Ij48L3BhdGg+PC9zdmc+",
  "kimi": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZWRlZGYxIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+S2ltaTwvdGl0bGU+PHBhdGggZD0iTTIxLjg0NiAwYTEuOTIzIDEuOTIzIDAgMTEwIDMuODQ2SDIwLjE1YS4yMjYuMjI2IDAgMDEtLjIyNy0uMjI2VjEuOTIzQzE5LjkyMy44NjEgMjAuNzg0IDAgMjEuODQ2IDB6Ij48L3BhdGg+PHBhdGggZD0iTTExLjA2NSAxMS4xOTlsNy4yNTctNy4yYy4xMzctLjEzNi4wNi0uNDEtLjExNi0uNDFIMTQuM2EuMTY0LjE2NCAwIDAwLS4xMTcuMDUxbC03LjgyIDcuNzU2Yy0uMTIyLjEyLS4zMDIuMDEzLS4zMDItLjE3OVYzLjgyYzAtLjEyNy0uMDgzLS4yMy0uMTg1LS4yM0gzLjE4NmMtLjEwMyAwLS4xODYuMTAzLS4xODYuMjNWMTkuNzdjMCAuMTI4LjA4My4yMy4xODYuMjNoMi42OWMuMTAzIDAgLjE4Ni0uMTAyLjE4Ni0uMjN2LTMuMjVjMC0uMDY5LjAyNS0uMTM1LjA2OS0uMTc4bDIuNDI0LTIuNDA2YS4xNTguMTU4IDAgMDEuMjA1LS4wMjNsNi40ODQgNC43NzJhNy42NzcgNy42NzcgMCAwMDMuNDUzIDEuMjgzYy4xMDguMDEyLjItLjA5NS4yLS4yM3YtMy4wNmMwLS4xMTctLjA3LS4yMTItLjE2NC0uMjI3YTUuMDI4IDUuMDI4IDAgMDEtMi4wMjctLjgwN2wtNS42MTMtNC4wNjRjLS4xMTctLjA3OC0uMTMyLS4yNzktLjAyOC0uMzgxeiI+PC9wYXRoPjwvc3ZnPg==",
  "moonshot": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZWRlZGYxIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+TW9vbnNob3RBSTwvdGl0bGU+PHBhdGggZD0iTTEuMDUyIDE2LjkxNmw5LjUzOSAyLjU1MmEyMS4wMDcgMjEuMDA3IDAgMDAuMDYgMi4wMzNsNS45NTYgMS41OTNhMTEuOTk3IDExLjk5NyAwIDAxLTUuNTg2Ljg2NWwtLjE4LS4wMTYtLjA0NC0uMDA0LS4wODQtLjAwOS0uMDk0LS4wMWExMS42MDUgMTEuNjA1IDAgMDEtLjE1Ny0uMDJsLS4xMDctLjAxNC0uMTEtLjAxNmExMS45NjIgMTEuOTYyIDAgMDEtLjMyLS4wNTFsLS4wNDItLjAwOC0uMDc1LS4wMTMtLjEwNy0uMDItLjA3LS4wMTUtLjA5My0uMDE5LS4wNzUtLjAxNi0uMDk1LS4wMi0uMDk3LS4wMjMtLjA5NC0uMDIyLS4wNjgtLjAxNy0uMDg4LS4wMjItLjA5LS4wMjQtLjA5NS0uMDI1LS4wODItLjAyMy0uMTA5LS4wMy0uMDYyLS4wMi0uMDg0LS4wMjUtLjA5My0uMDI4LS4xMDUtLjAzNC0uMDU4LS4wMTktLjA4LS4wMjYtLjA5LS4wMzEtLjA2Ni0uMDI0YTYuMjkzIDYuMjkzIDAgMDEtLjA0NC0uMDE1bC0uMDY4LS4wMjUtLjEwMS0uMDM3LS4wNTctLjAyMi0uMDgtLjAzLS4wODctLjAzNS0uMDg4LS4wMzUtLjA3OS0uMDMyLS4wOTUtLjA0LS4wNjMtLjAyOC0uMDYzLS4wMjdhNS42NTUgNS42NTUgMCAwMS0uMDQxLS4wMThsLS4wNjYtLjAzLS4xMDMtLjA0Ny0uMDUyLS4wMjQtLjA5Ni0uMDQ2LS4wNjItLjAzLS4wODQtLjA0LS4wODYtLjA0NC0uMDkzLS4wNDctLjA1Mi0uMDI3LS4xMDMtLjA1NS0uMDU3LS4wMy0uMDU4LS4wMzJhNi40OSA2LjQ5IDAgMDEtLjA0Ni0uMDI2bC0uMDk0LS4wNTMtLjA2LS4wMzQtLjA1MS0uMDMtLjA3Mi0uMDQxLS4wODItLjA1LS4wOTMtLjA1Ni0uMDUyLS4wMzItLjA4NC0uMDUzLS4wNjEtLjAzOS0uMDc5LS4wNS0uMDctLjA0Ny0uMDUzLS4wMzVhNy43ODUgNy43ODUgMCAwMS0uMDU0LS4wMzZsLS4wNDQtLjAzLS4wNDQtLjAzYTYuMDY2IDYuMDY2IDAgMDEtLjA0LS4wMjhsLS4wNTctLjA0LS4wNzYtLjA1NC0uMDY5LS4wNS0uMDc0LS4wNTQtLjA1Ni0uMDQyLS4wNzYtLjA1Ny0uMDc2LS4wNTktLjA4Ni0uMDY3LS4wNDUtLjAzNS0uMDY0LS4wNTItLjA3NC0uMDYtLjA4OS0uMDczLS4wNDYtLjAzOS0uMDQ2LS4wMzlhNy41MTYgNy41MTYgMCAwMS0uMDQzLS4wMzdsLS4wNDUtLjA0LS4wNjEtLjA1My0uMDctLjA2Mi0uMDY4LS4wNi0uMDYyLS4wNTgtLjA2Ny0uMDYyLS4wNTMtLjA1LS4wODgtLjA4NGExMy4yOCAxMy4yOCAwIDAxLS4wOTktLjA5N2wtLjAyOS0uMDI4LS4wNDEtLjA0Mi0uMDY5LS4wNy0uMDUtLjA1MS0uMDUtLjA1M2E2LjQ1NyA2LjQ1NyAwIDAxLS4xNjgtLjE3OWwtLjA4LS4wODgtLjA2Mi0uMDctLjA3MS0uMDgtLjA0Mi0uMDQ5LS4wNTMtLjA2Mi0uMDU4LS4wNjgtLjA0Ni0uMDU2YTcuMTc1IDcuMTc1IDAgMDEtLjAyNy0uMDMzbC0uMDQ1LS4wNTUtLjA2Ni0uMDgyLS4wNDEtLjA1Mi0uMDUtLjA2NC0uMDItLjAyNWExMS45OSAxMS45OSAwIDAxLTEuNDQtMi40MDJ6bS0xLjAyLTUuNzk0bDExLjM1MyAzLjAzN2EyMC40NjggMjAuNDY4IDAgMDAtLjQ2OSAyLjAxMWwxMC44MTcgMi44OTRhMTIuMDc2IDEyLjA3NiAwIDAxLTEuODQ1IDIuMDA1TC42NTcgMTUuOTIzbC0uMDE2LS4wNDYtLjAzNS0uMTA0YTExLjk2NSAxMS45NjUgMCAwMS0uMDUtLjE1M2wtLjAwNy0uMDIzYTExLjg5NiAxMS44OTYgMCAwMS0uMjA3LS43NDFsLS4wMy0uMTI2LS4wMTgtLjA4LS4wMjEtLjA5Ny0uMDE4LS4wODEtLjAxOC0uMDktLjAxNy0uMDg0LS4wMTgtLjA5NGMtLjAyNi0uMTQxLS4wNS0uMjgzLS4wNzEtLjQyNmwtLjAxNy0uMTE4LS4wMTEtLjA4My0uMDEzLS4xMDJhMTIuMDEgMTIuMDEgMCAwMS0uMDE5LS4xNjFsLS4wMDUtLjA0N2ExMi4xMiAxMi4xMiAwIDAxLS4wMzQtMi4xNDV6bTEuNTkzLTUuMTVsMTEuOTQ4IDMuMTk2Yy0uMzY4LjYwNS0uNzA1IDEuMjMxLTEuMDEgMS44NzVsMTEuMjk1IDMuMDIyYy0uMTQyLjgyLS4zNjggMS42MTItLjY2OCAyLjM2NWwtMTEuNTUtMy4wOUwuMTI0IDEwLjI2bC4wMTUtLjEuMDA4LS4wNDkuMDEtLjA2Ny4wMTUtLjA4Ny4wMTgtLjA5OGMuMDI2LS4xNDguMDU2LS4yOTUuMDg4LS40NDJsLjAyOC0uMTI0LjAyLS4wODUuMDI0LS4wOTdjLjAyMi0uMDkuMDQ1LS4xOC4wNy0uMjY4bC4wMjgtLjEwMi4wMjMtLjA4My4wMy0uMS4wMjUtLjA4Mi4wMy0uMDk2LjAyNi0uMDgyLjAzMS0uMDk1YTExLjg5NiAxMS44OTYgMCAwMTEuMDEtMi4yMzJ6bTQuNDQyLTQuNEwxNy4zNTIgNC41OWEyMC43NyAyMC43NyAwIDAwLTEuNjg4IDEuNzIxbDcuODIzIDIuMDkzYy4yNjcuODUyLjQ0MiAxLjc0NC41MTMgMi42NjVMMi4xMDYgNS4yMTNsLjA0NS0uMDY1LjAyNy0uMDQuMDQtLjA1NS4wNDYtLjA2NS4wNTUtLjA3Ni4wNTQtLjA3Mi4wNjQtLjA4Ni4wNS0uMDY1LjA1Ny0uMDczLjA1NS0uMDcuMDYtLjA3NC4wNTUtLjA2OS4wNjUtLjA3Ny4wNTQtLjA2Ni4wNjYtLjA3Ny4wNTMtLjA2LjA3Mi0uMDgyLjA1My0uMDYuMDY3LS4wNzQuMDU0LS4wNTguMDczLS4wNzguMDU4LS4wNi4wNjMtLjA2Ny4xNjgtLjE3LjEtLjA5OC4wNTktLjA1Ni4wNzYtLjA3MWExMi4wODQgMTIuMDg0IDAgMDEyLjI3Mi0xLjY3N3pNMTIuMDE3IDBoLjA5N2wuMDgyLjAwMS4wNjkuMDAxLjA1NC4wMDIuMDY4LjAwMi4wNDYuMDAxLjA3Ni4wMDMuMDQ3LjAwMi4wNi4wMDMuMDU0LjAwMi4wODcuMDA1LjEwNS4wMDcuMTQ0LjAxMS4wODguMDA3LjA0NC4wMDQuMDc3LjAwOC4wODIuMDA4LjA0Ny4wMDUuMTAyLjAxMi4wNS4wMDYuMTA4LjAxNC4wODEuMDEuMDQyLjAwNi4wNjUuMDEuMjA3LjAzMi4wNy4wMTIuMDY1LjAxMS4xNC4wMjYuMDkyLjAxOC4xMS4wMjIuMDQ2LjAxLjA3NS4wMTYuMDQxLjAxTDE0LjcuM2wuMDQyLjAxLjA2NS4wMTUuMDQ5LjAxMi4wNzEuMDE3LjA5Ni4wMjQuMTEyLjAzLjExMy4wMy4xMTMuMDMyLjA1LjAxNS4wNy4wMi4wNzguMDI0LjA3My4wMjMuMDUuMDE2LjA1LjAxNi4wNzYuMDI1LjA5OS4wMzMuMTAyLjAzNi4wNDguMDE3LjA2NC4wMjMuMDkzLjAzNC4xMS4wNDEuMTE2LjA0NS4xLjA0LjA0Ny4wMi4wNi4wMjQuMDQxLjAxOC4wNjMuMDI2LjA0LjAxOC4wNTcuMDI1LjExLjA0OC4xLjA0Ni4wNzQuMDM1LjA3NS4wMzYuMDYuMDI4LjA5Mi4wNDYuMDkxLjA0NS4xMDIuMDUyLjA1My4wMjguMDQ5LjAyNi4wNDYuMDI0LjA2LjAzMy4wNDEuMDIyLjA1Mi4wMjkuMDg4LjA1LjEwNi4wNi4wODcuMDUxLjA1Ny4wMzQuMDUzLjAzMi4wOTYuMDU5LjA4OC4wNTUuMDk4LjA2Mi4wMzYuMDI0LjA2NC4wNDEuMDg0LjA1Ni4wNC4wMjcuMDYyLjA0Mi4wNjIuMDQzLjAyMy4wMTdjLjA1NC4wMzcuMTA4LjA3NS4xNjEuMTE0bC4wODMuMDYuMDY1LjA0OC4wNTYuMDQzLjA4Ni4wNjUuMDgyLjA2NC4wNC4wMy4wNS4wNDEuMDg2LjA2OS4wNzkuMDY1LjA4NS4wNzFjLjcxMi42IDEuMzUzIDEuMjgzIDEuOTA5IDIuMDMxTDcuMjIyLjk5NGwuMDYyLS4wMjcuMDY1LS4wMjguMDgxLS4wMzQuMDg2LS4wMzVjLjExMy0uMDQ1LjIyNy0uMDkuMzQxLS4xMzFsLjA5Ni0uMDM1LjA5My0uMDMzLjA4NC0uMDMuMDk2LS4wMzFjLjA4Ny0uMDMuMTc2LS4wNTguMjY0LS4wODVsLjA5MS0uMDI3LjA4Ni0uMDI1LjEwMi0uMDMuMDg1LS4wMjMuMS0uMDI2TDkuMDQuMzdsLjA5LS4wMjMuMDkxLS4wMjIuMDk1LS4wMjIuMDktLjAyLjA5OC0uMDIxLjA5MS0uMDIuMDk1LS4wMTguMDkyLS4wMTguMS0uMDE4LjA5MS0uMDE2LjA5OC0uMDE3LjA5Mi0uMDE0LjA5Ny0uMDE1LjA5Mi0uMDEzLjEwMi0uMDEzLjA5MS0uMDEyLjEwNS0uMDEyLjA5LS4wMS4xMDUtLjAxYy4wOTMtLjAxLjE4Ni0uMDE4LjI4LS4wMjRsLjEwNi0uMDA4LjA5LS4wMDUuMTEtLjAwNi4wOTMtLjAwNC4xLS4wMDQuMDk3LS4wMDIuMDk5LS4wMDIuMTk3LS4wMDJ6Ij48L3BhdGg+PC9zdmc+",
  "zhipu-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPlpoaXB1PC90aXRsZT48cGF0aCBkPSJNMTEuOTkxIDIzLjUwM2EuMjQuMjQgMCAwMC0uMjQ0LjI0OC4yNC4yNCAwIDAwLjI0NC4yNDkuMjQuMjQgMCAwMC4yNDUtLjI0OS4yNC4yNCAwIDAwLS4yMi0uMjQ3bC0uMDI1LS4wMDF6TTkuNjcxIDUuMzY1YTEuNjk3IDEuNjk3IDAgMDExLjA5OSAyLjEzMmwtLjA3MS4xNzItLjAxNi4wNC0uMDE4LjA1NGMtLjA3LjE2LS4xMDQuMzItLjEwNC40OTgtLjAzNS43MS40NyAxLjI3OSAxLjE4NiAxLjMxNGguMzY2YzEuMzA5LjA1MyAyLjMzOCAxLjE3MyAyLjI4NiAyLjUyMy0uMDUyIDEuMzMyLTEuMTUyIDIuMzgtMi40NzggMi4zMjdoLS4xNzRjLS43MTUuMDE4LTEuMjc0LjY0LTEuMjM5IDEuMzY4IDAgLjEyNC4wMTguMjMuMDUzLjMzNy4yMDkuMzczLjU0LjY1OC45Ni44Ljc1LjIzIDEuNTE3LS4xMjUgMS45LS43ODJsLjAxOC0uMDM1Yy40MDItLjY0IDEuMTctLjk2IDEuOTItLjcxMS44NTQuMjg0IDEuMzc4IDEuMjI2IDEuMDk5IDIuMTY3YTEuNjYxIDEuNjYxIDAgMDEtMi4wNzcgMS4xMDIgMS43MTEgMS43MTEgMCAwMS0uOTA3LS43MTFsLS4wMTctLjAzNWMtLjItLjMyMy0uNDYzLS41OC0uODUxLS43MTFsLS4wNTYtLjAxOGExLjY0NiAxLjY0NiAwIDAwLTEuOTU0Ljc0NiAxLjY2IDEuNjYgMCAwMS0xLjA2NS43NjQgMS42NzcgMS42NzcgMCAwMS0xLjk4OS0xLjI3OWMtLjIwOS0uOTA2LjMzMi0xLjgzIDEuMjU3LTIuMDQzYTEuNTEgMS41MSAwIDAxLjI5Ni0uMDM1aC4wMThjLjY4LS4wNzEgMS4xNTEtLjYyMiAxLjExNi0xLjMzM2ExLjMwNyAxLjMwNyAwIDAwLS4yMjctLjY5MyAyLjUxNSAyLjUxNSAwIDAxLS4zNjYtMS40MDMgMi4zOSAyLjM5IDAgMDEuMzY2LTEuMjA4Yy4xNC0uMTk1LjIxLS40NDQuMjI3LS42OTMuMDE4LS43MS0uNTA2LTEuMjYxLTEuMTg2LTEuMzMybC0uMDctLjAxOGExLjQzIDEuNDMgMCAwMS0uMjk5LS4wN2wtLjA1LS4wMTlhMS43IDEuNyAwIDAxLTEuMDQ3LTIuMTE0IDEuNjggMS42OCAwIDAxMi4wOTQtMS4xMDF6bS01LjU3NSAxMC4xMWMuMjYtLjI2NC42MzktLjM2Ny45OTQtLjI3LjM1NS4wOTYuNjMzLjM3OS43MjguNzQuMDk1LjM2Mi0uMDA3Ljc0OC0uMjY3IDEuMDEzLS40MDIuNDEtMS4wNTMuNDEtMS40NTUgMGExLjA2MiAxLjA2MiAwIDAxMC0xLjQ4MnptMTQuODQ1LS4yOTRjLjM1OS0uMDkuNzM4LjAyNC45OTIuMjk3LjI1NC4yNzQuMzQ0LjY2NS4yMzcgMS4wMjUtLjEwNy4zNi0uMzk2LjYzNC0uNzU2LjcxOC0uNTUxLjEyOC0xLjEtLjIyLTEuMjMtLjc4MWExLjA1IDEuMDUgMCAwMS43NTctMS4yNnptLS4wNjQtNC4zOWMuMzE0LjMyLjQ5Ljc1My40OSAxLjIwNiAwIC40NTItLjE3Ni44ODYtLjQ5IDEuMjA2LS4zMTUuMzItLjc0LjUtMS4xODUuNS0uNDQ0IDAtLjg3LS4xOC0xLjE4NC0uNWExLjcyNyAxLjcyNyAwIDAxMC0yLjQxMiAxLjY1NCAxLjY1NCAwIDAxMi4zNjkgMHptLTExLjI0My4xNjNjLjM2NC40ODQuNDQ3IDEuMTI4LjIxOCAxLjY5MWExLjY2NSAxLjY2NSAwIDAxLTIuMTg4LjkyM2MtLjg1NS0uMzYtMS4yNi0xLjM1OC0uOTA3LTIuMjI4YTEuNjggMS42OCAwIDAxMS4zMy0xLjAzOGMuNTkzLS4wOCAxLjE4My4xNjkgMS41NDcuNjUyem0xMS41NDUtNC4yMjFjLjM2OCAwIC43MDguMi44OTIuNTI0LjE4NC4zMjQuMTg0LjcyNCAwIDEuMDQ4YTEuMDI2IDEuMDI2IDAgMDEtLjg5Mi41MjRjLS41NjggMC0xLjAzLS40Ny0xLjAzLTEuMDQ4IDAtLjU3OS40NjItMS4wNDggMS4wMy0xLjA0OHptLTE0LjM1OCAwYy4zNjggMCAuNzA3LjIuODkxLjUyNC4xODQuMzI0LjE4NC43MjQgMCAxLjA0OGExLjAyNiAxLjAyNiAwIDAxLS44OTEuNTI0Yy0uNTY5IDAtMS4wMy0uNDctMS4wMy0xLjA0OCAwLS41NzkuNDYxLTEuMDQ4IDEuMDMtMS4wNDh6bTEwLjAzMS0xLjQ3NWMuOTI1IDAgMS42NzUuNzY0IDEuNjc1IDEuNzA2cy0uNzUgMS43MDUtMS42NzUgMS43MDUtMS42NzQtLjc2My0xLjY3NC0xLjcwNWMwLS45NDIuNzUtMS43MDYgMS42NzQtMS43MDZ6bS0yLjYyNi0uNjg0Yy4zNjItLjA4Mi42NTMtLjM1Ni43NjEtLjcxOGExLjA2MiAxLjA2MiAwIDAwLS4yMzgtMS4wMjggMS4wMTcgMS4wMTcgMCAwMC0uOTk2LS4yOTRjLS41NDcuMTQtLjg4MS43LS43NTIgMS4yNTcuMTMuNTU4LjY3NS45MDcgMS4yMjUuNzgzem0wIDE2Ljg3NmMuMzU5LS4wODcuNjQ0LS4zNi43NS0uNzJhMS4wNjIgMS4wNjIgMCAwMC0uMjM3LTEuMDE5IDEuMDE4IDEuMDE4IDAgMDAtLjk4NS0uMzAxIDEuMDM3IDEuMDM3IDAgMDAtLjc2Mi43MTdjLS4xMDguMzYxLS4wMTcuNzU0LjIzOSAxLjAyOC4yNDUuMjYzLjYwNi4zNzcuOTUzLjMwNWwuMDQzLS4wMXpNMTcuMTkgMy41YS42MzEuNjMxIDAgMDAuNjI4LS42NGMwLS4zNTUtLjI3OS0uNjQtLjYyOC0uNjRhLjYzMS42MzEgMCAwMC0uNjI4LjY0YzAgLjM1NS4yOC42NC42MjguNjR6bS0xMC4zOCAwYS42MzEuNjMxIDAgMDAuNjI4LS42NGMwLS4zNTUtLjI4LS42NC0uNjI4LS42NGEuNjMxLjYzMSAwIDAwLS42MjguNjRjMCAuMzU1LjI3OS42NC42MjguNjR6bS01LjE4MiA3Ljg1MmEuNjMxLjYzMSAwIDAwLS42MjguNjRjMCAuMzU0LjI4LjYzOS42MjguNjM5YS42My42MyAwIDAwLjYyNy0uNjA2bC4wMDEtLjAzNGEuNjIuNjIgMCAwMC0uNjI4LS42NHptNS4xODIgOS4xM2EuNjMxLjYzMSAwIDAwLS42MjguNjRjMCAuMzU1LjI3OS42NC42MjguNjRhLjYzMS42MzEgMCAwMC42MjgtLjY0YzAtLjM1NS0uMjgtLjY0LS42MjgtLjY0em0xMC4zOC4wMThhLjYzMS42MzEgMCAwMC0uNjI4LjY0YzAgLjM1NS4yOC42NC42MjguNjRhLjYzMS42MzEgMCAwMC42MjgtLjY0YzAtLjM1NS0uMjc5LS42NC0uNjI4LS42NHptNS4xODItOS4xNDhhLjYzMS42MzEgMCAwMC0uNjI4LjY0YzAgLjM1NC4yNzkuNjM5LjYyOC42MzlhLjYzMS42MzEgMCAwMC42MjgtLjY0YzAtLjM1NS0uMjgtLjY0LS42MjgtLjY0em0tLjM4NC00Ljk5MmEuMjQuMjQgMCAwMC4yNDQtLjI0OS4yNC4yNCAwIDAwLS4yNDQtLjI0OS4yNC4yNCAwIDAwLS4yNDQuMjQ5YzAgLjE0Mi4xMjIuMjQ5LjI0NC4yNDl6TTExLjk5MS40OTdhLjI0LjI0IDAgMDAuMjQ1LS4yNDhBLjI0LjI0IDAgMDAxMS45OSAwYS4yNC4yNCAwIDAwLS4yNDQuMjQ5YzAgLjEzMy4xMDguMjM2LjIyMy4yNDdsLjAyMS4wMDF6TTIuMDExIDYuMzZhLjI0LjI0IDAgMDAuMjQ1LS4yNDkuMjQuMjQgMCAwMC0uMjQ0LS4yNDkuMjQuMjQgMCAwMC0uMjQ0LjI0OS4yNC4yNCAwIDAwLjI0NC4yNDl6bTAgMTEuMjYzYS4yNC4yNCAwIDAwLS4yNDMuMjQ4LjI0LjI0IDAgMDAuMjQ0LjI0OS4yNC4yNCAwIDAwLjI0NC0uMjQ5LjI1Mi4yNTIgMCAwMC0uMjQ0LS4yNDh6bTE5Ljk5NS0uMDE4YS4yNC4yNCAwIDAwLS4yNDUuMjQ4LjI0LjI0IDAgMDAuMjQ1LjI1LjI0LjI0IDAgMDAuMjQ0LS4yNS4yNTIuMjUyIDAgMDAtLjI0NC0uMjQ4eiIgZmlsbD0iIzM4NTlGRiIgZmlsbC1ydWxlPSJub256ZXJvIj48L3BhdGg+PC9zdmc+",
  "chatglm-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPkNoYXRHTE08L3RpdGxlPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0ibG9iZS1pY29ucy1jaGF0LWdsbS1fUl8wXyIgeDE9Ii0xOC43NTYlIiB4Mj0iNzAuODk0JSIgeTE9IjQ5LjM3MSUiIHkyPSI5MC45NDQlIj48c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjNTA0QUY0Ij48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMzQ4NUZGIj48L3N0b3A+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHBhdGggZD0iTTkuOTE3IDJjNC45MDYgMCAxMC4xNzggMy45NDcgOC45MyAxMC41OC0uMDE0LjA3LS4wMzcuMTQtLjA1Ny4yMWwtLjAwMy0uMjc3Yy0uMDgzLTMtMS41MzQtOC45MzQtOC44Ny04LjkzNC0zLjM5MyAwLTguMTM3IDMuMDU0LTcuOTMgOC4xNTgtLjA0IDQuNzc4IDMuNTU1IDguNCA3Ljk1IDguMzMybC4wNzMtLjAwMWMxLjItLjAzMyAyLjc2My0uNDI5IDMuMS0xLjY1Ny4wNjMtLjAzMS4yNi41MzQuMjY4LjU5OC4wNDguMjU2LjExMi4zNjkuMTkyLjM0Ljk4MS0uMzQ4IDIuMjg2LTEuMjIyIDEuOTUyLTIuMzgtLjE3Ni0uNjEtMS43NzUtLjE0Ny0xLjkyMS0uMzQ3LjQxOC0uOTc5IDIuMjM0LS45MjYgMy4xNTMtLjcxNi40NDMuMTAyLjY1Ny4zOCAxLjAxMi40NDIuMjkuMDUyLjk4MS0uMi45Ni4yNDItMS41IDMuMDQyLTQuODkzIDUuNDEtOC44MDggNS40MUMzLjY1NCAyMiAwIDE2LjU3NCAwIDExLjczNyAwIDUuOTQ3IDQuOTU5IDIgOS45MTcgMnpNOS45IDUuM2MuNDg0IDAgMS4xMjUuMjI1IDEuMzguNTg1IDMuNjY5LjE0NSA0LjMxMyAyLjY4NiA0LjY5NCA1LjQ0NC4yNTUgMS44MzguMzE1IDIuMy4xODIgMS4zODdsLjA4My41OWMuMDY4LjQ0OC41NTQuNzM3Ljk4Mi41MTYuMTQ0LS4wNzUuMjU0LS4yMzEuMzI4LS40N2EuMi4yIDAgMDEuMjU4LS4xM2wuNjI1LjIyYS4yLjIgMCAwMS4xMjQuMjM4IDIuMTcyIDIuMTcyIDAgMDEtLjUxLjkyYy0uODc4LjkxNy0yLjc1Ny42NjQtMy4wOC0uNjItLjE0LS41NTQtLjA1NS0uNjI2LS4zNDUtMS4yNDItLjI5Mi0uNjIxLTEuMjM4LS43MDktMS42OS0uMjk1LS4zNDUuMzE1LS40MDcuODA1LS40MDYgMS4yODJMMTIuNiAxNS45YS45LjkgMCAwMS0uOS45aC0xLjRhLjkuOSAwIDAxLS45LS45di0uNjVhMS4xNSAxLjE1IDAgMTAtMi4zIDB2LjY1YS45LjkgMCAwMS0uOS45SDQuOGEuOS45IDAgMDEtLjktLjlsLjAzNS0zLjIzOWMuMDEyLTEuODg0LjM1Ni0zLjY1OCAyLjQ3LTQuMTM0LjItLjA0NS4yNTIuMTMuMjkuMzQyLjAyNS4xNTQuMDQzLjI1Mi4wNTMuMjk0LjcwMSAzLjA1OCAxLjc1IDQuMjk5IDMuMTQ0IDMuNzIybC42Ni0uMzMxLjI1NC0uMTNjLjE1OC0uMDgyLjI1LS4xMzEuMjc2LS4xNS4wMTItLjAxLS4xNjUtLjIwNi0uNDA3LS40NjRsLTEuMDEyLTEuMDY3YTguOTI1IDguOTI1IDAgMDEtLjE5OS0uMjE2Yy0uMDQ3LS4wMzQtLjExNi4wNjgtLjIwOC4zMDYtLjA3NC4xNTctLjI1MS4yNTItLjI3Mi4zMjYtLjAxMy4wNTguMTA4LjI5OC4zNjIuNzIuMTY0LjI4OC4yMi41MDgtLjMxLjM0My0xLjA0LS44LTEuNTE4LTIuMjczLTEuNjg0LTMuNzI1LS4wMDQtLjAzNS0uMTYyLTEuOTEzLS4xNjItMS45MTNhMS4yIDEuMiAwIDAxMS4xMTMtMS4yODFMOS45IDUuM3ptMTIuOTk0IDguNjhjLjAzNy42OTctLjQwMy43MDQtMS4yMTMuNTkxbC0xLjc4My0uMjc2Yy0uMjY1LS4wNTMtLjM4NS0uMDk5LS4zMTMtLjE0Ny40Ny0uMzE1IDMuMjY4LS45MyAzLjMxLS4xNjh6bS0uOTE1LS4wODNsLS45MjYuMDQyYy0uODUuMDc3LTEuNDUyLjI0LjMzOC4zMzZsLjEwMy4wMDNjLjgxNS4wMTIgMS4yNjQtLjM1OS40ODUtLjM4MXptMS42NjctMy42MDFoLjAxYy43OS4zOTguMDY3IDEuMDMtLjY1IDEuMzkzLS4xNC4wNy0uNDkxLjE3Ni0xLjA1Mi4zMTUtLjI0MS4wNC0uNDU3LjA5Mi0uMzMzLjE2bC4wMS4wMDVjMS45NTIuOTU4LTMuMTIzIDEuNTM0LTIuNDk1IDEuMjg1bC4zOC0uMTQ4Yy42OC0uMjY2IDEuNjE0LS42ODIgMS42NjYtMS4zMzcuMDM4LS40OCAxLjI1My0uNDQyIDEuNDkzLS45NjguMDQ4LS4xMDYgMC0uMjM2LS4xNDQtLjM4OS0uMDUtLjA0Ny0uMDk0LS4wOTQtLjEwNy0uMTQ4LS4wNzMtLjMwNS43LS40MzEgMS4yMjItLjE2OHptLTIuNTY4LS40NzRjLS4xMzUgMS4xOTgtMi40NzkgNC4xOTItMS45NDkgMi44NjNsLjAxNy0uMDQyYy4yOTgtLjcxNy4zNzYtMi4yMjEgMS4zMzctMy4yMjEuMjUtLjI2LjYzNi4wMzUuNTk1LjR6bS03Ljk3Ni0uMjUzYy4wMi0uNjk0IDEuMDAyLS45NjggMS4zNDYtLjM0Ny4wMS0xLjI3NC0xLjk0MS0uNzY4LTEuMzQ2LjM0N3oiIGZpbGw9InVybCgjbG9iZS1pY29ucy1jaGF0LWdsbS1fUl8wXykiIGZpbGwtcnVsZT0iZXZlbm9kZCI+PC9wYXRoPjwvc3ZnPg==",
  "openai": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZWRlZGYxIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+T3BlbkFJPC90aXRsZT48cGF0aCBkPSJNOS4yMDUgOC42NTh2LTIuMjZjMC0uMTkuMDcyLS4zMzMuMjM4LS40MjhsNC41NDMtMi42MTZjLjYxOS0uMzU3IDEuMzU2LS41MjMgMi4xMTctLjUyMyAyLjg1NCAwIDQuNjYyIDIuMjEyIDQuNjYyIDQuNTY2IDAgLjE2NyAwIC4zNTctLjAyNC41NDdsLTQuNzEtMi43NTlhLjc5Ny43OTcgMCAwMC0uODU2IDBsLTUuOTcgMy40NzN6bTEwLjYwOSA4LjhWMTIuMDZjMC0uMzMzLS4xNDMtLjU3LS40MjktLjczN2wtNS45Ny0zLjQ3MyAxLjk1LTEuMTE4YS40MzMuNDMzIDAgMDEuNDc2IDBsNC41NDMgMi42MTdjMS4zMDkuNzYgMi4xODkgMi4zNzggMi4xODkgMy45NDggMCAxLjgwOC0xLjA3IDMuNDczLTIuNzYgNC4xNjN6TTcuODAyIDEyLjcwM2wtMS45NS0xLjE0MmMtLjE2Ny0uMDk1LS4yMzktLjIzOC0uMjM5LS40MjhWNS44OTljMC0yLjU0NSAxLjk1LTQuNDcyIDQuNTkxLTQuNDcyIDEgMCAxLjkyNy4zMzMgMi43MTIuOTI4TDguMjMgNS4wNjdjLS4yODUuMTY2LS40MjguNDA0LS40MjguNzM3djYuODk4ek0xMiAxNS4xMjhsLTIuNzk1LTEuNTd2LTMuMzNMMTIgOC42NThsMi43OTUgMS41N3YzLjMzTDEyIDE1LjEyOHptMS43OTYgNy4yM2MtMSAwLTEuOTI3LS4zMzItMi43MTItLjkyN2w0LjY4Ni0yLjcxMmMuMjg1LS4xNjYuNDI4LS40MDQuNDI4LS43Mzd2LTYuODk4bDEuOTc0IDEuMTQyYy4xNjcuMDk1LjIzOC4yMzguMjM4LjQyOHY1LjIzM2MwIDIuNTQ1LTEuOTc0IDQuNDcyLTQuNjE0IDQuNDcyem0tNS42MzctNS4zMDNsLTQuNTQ0LTIuNjE3Yy0xLjMwOC0uNzYxLTIuMTg4LTIuMzc4LTIuMTg4LTMuOTQ4QTQuNDgyIDQuNDgyIDAgMDE0LjIxIDYuMzI3djUuNDIzYzAgLjMzMy4xNDMuNTcxLjQyOC43MzhsNS45NDcgMy40NDktMS45NSAxLjExOGEuNDMyLjQzMiAwIDAxLS40NzYgMHptLS4yNjIgMy45Yy0yLjY4OCAwLTQuNjYyLTIuMDIxLTQuNjYyLTQuNTE5IDAtLjE5LjAyNC0uMzguMDQ3LS41N2w0LjY4NiAyLjcxYy4yODYuMTY3LjU3MS4xNjcuODU2IDBsNS45Ny0zLjQ0OHYyLjI2YzAgLjE5LS4wNy4zMzMtLjIzNy40MjhsLTQuNTQzIDIuNjE2Yy0uNjE5LjM1Ny0xLjM1Ni41MjMtMi4xMTcuNTIzem01Ljg5OSAyLjgzYTUuOTQ3IDUuOTQ3IDAgMDA1LjgyNy00Ljc1NkMyMi4yODcgMTguMzM5IDI0IDE1Ljg0IDI0IDEzLjI5NmMwLTEuNjY1LS43MTMtMy4yODItMS45OTgtNC40NDguMTE5LS41LjE5LS45OTkuMTktMS40OTggMC0zLjQwMS0yLjc1OS01Ljk0Ny01Ljk0Ni01Ljk0Ny0uNjQyIDAtMS4yNi4wOTUtMS44OC4zMUE1Ljk2MiA1Ljk2MiAwIDAwMTAuMjA1IDBhNS45NDcgNS45NDcgMCAwMC01LjgyNyA0Ljc1N0MxLjcxMyA1LjQ0NyAwIDcuOTQ1IDAgMTAuNDljMCAxLjY2Ni43MTMgMy4yODMgMS45OTggNC40NDgtLjExOS41LS4xOSAxLS4xOSAxLjQ5OSAwIDMuNDAxIDIuNzU5IDUuOTQ2IDUuOTQ2IDUuOTQ2LjY0MiAwIDEuMjYtLjA5NSAxLjg4LS4zMDlhNS45NiA1Ljk2IDAgMDA0LjE2MiAxLjcxM3oiPjwvcGF0aD48L3N2Zz4=",
  "gemini-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPkdlbWluaTwvdGl0bGU+PHBhdGggZD0iTTIwLjYxNiAxMC44MzVhMTQuMTQ3IDE0LjE0NyAwIDAxLTQuNDUtMy4wMDEgMTQuMTExIDE0LjExMSAwIDAxLTMuNjc4LTYuNDUyLjUwMy41MDMgMCAwMC0uOTc1IDAgMTQuMTM0IDE0LjEzNCAwIDAxLTMuNjc5IDYuNDUyIDE0LjE1NSAxNC4xNTUgMCAwMS00LjQ1IDMuMDAxYy0uNjUuMjgtMS4zMTguNTA1LTIuMDAyLjY3OGEuNTAyLjUwMiAwIDAwMCAuOTc1Yy42ODQuMTcyIDEuMzUuMzk3IDIuMDAyLjY3N2ExNC4xNDcgMTQuMTQ3IDAgMDE0LjQ1IDMuMDAxIDE0LjExMiAxNC4xMTIgMCAwMTMuNjc5IDYuNDUzLjUwMi41MDIgMCAwMC45NzUgMGMuMTcyLS42ODUuMzk3LTEuMzUxLjY3Ny0yLjAwM2ExNC4xNDUgMTQuMTQ1IDAgMDEzLjAwMS00LjQ1IDE0LjExMyAxNC4xMTMgMCAwMTYuNDUzLTMuNjc4LjUwMy41MDMgMCAwMDAtLjk3NSAxMy4yNDUgMTMuMjQ1IDAgMDEtMi4wMDMtLjY3OHoiIGZpbGw9IiMzMTg2RkYiPjwvcGF0aD48cGF0aCBkPSJNMjAuNjE2IDEwLjgzNWExNC4xNDcgMTQuMTQ3IDAgMDEtNC40NS0zLjAwMSAxNC4xMTEgMTQuMTExIDAgMDEtMy42NzgtNi40NTIuNTAzLjUwMyAwIDAwLS45NzUgMCAxNC4xMzQgMTQuMTM0IDAgMDEtMy42NzkgNi40NTIgMTQuMTU1IDE0LjE1NSAwIDAxLTQuNDUgMy4wMDFjLS42NS4yOC0xLjMxOC41MDUtMi4wMDIuNjc4YS41MDIuNTAyIDAgMDAwIC45NzVjLjY4NC4xNzIgMS4zNS4zOTcgMi4wMDIuNjc3YTE0LjE0NyAxNC4xNDcgMCAwMTQuNDUgMy4wMDEgMTQuMTEyIDE0LjExMiAwIDAxMy42NzkgNi40NTMuNTAyLjUwMiAwIDAwLjk3NSAwYy4xNzItLjY4NS4zOTctMS4zNTEuNjc3LTIuMDAzYTE0LjE0NSAxNC4xNDUgMCAwMTMuMDAxLTQuNDUgMTQuMTEzIDE0LjExMyAwIDAxNi40NTMtMy42NzguNTAzLjUwMyAwIDAwMC0uOTc1IDEzLjI0NSAxMy4yNDUgMCAwMS0yLjAwMy0uNjc4eiIgZmlsbD0idXJsKCNsb2JlLWljb25zLWdlbWluaS0wLV9SXzBfKSI+PC9wYXRoPjxwYXRoIGQ9Ik0yMC42MTYgMTAuODM1YTE0LjE0NyAxNC4xNDcgMCAwMS00LjQ1LTMuMDAxIDE0LjExMSAxNC4xMTEgMCAwMS0zLjY3OC02LjQ1Mi41MDMuNTAzIDAgMDAtLjk3NSAwIDE0LjEzNCAxNC4xMzQgMCAwMS0zLjY3OSA2LjQ1MiAxNC4xNTUgMTQuMTU1IDAgMDEtNC40NSAzLjAwMWMtLjY1LjI4LTEuMzE4LjUwNS0yLjAwMi42NzhhLjUwMi41MDIgMCAwMDAgLjk3NWMuNjg0LjE3MiAxLjM1LjM5NyAyLjAwMi42NzdhMTQuMTQ3IDE0LjE0NyAwIDAxNC40NSAzLjAwMSAxNC4xMTIgMTQuMTEyIDAgMDEzLjY3OSA2LjQ1My41MDIuNTAyIDAgMDAuOTc1IDBjLjE3Mi0uNjg1LjM5Ny0xLjM1MS42NzctMi4wMDNhMTQuMTQ1IDE0LjE0NSAwIDAxMy4wMDEtNC40NSAxNC4xMTMgMTQuMTEzIDAgMDE2LjQ1My0zLjY3OC41MDMuNTAzIDAgMDAwLS45NzUgMTMuMjQ1IDEzLjI0NSAwIDAxLTIuMDAzLS42Nzh6IiBmaWxsPSJ1cmwoI2xvYmUtaWNvbnMtZ2VtaW5pLTEtX1JfMF8pIj48L3BhdGg+PHBhdGggZD0iTTIwLjYxNiAxMC44MzVhMTQuMTQ3IDE0LjE0NyAwIDAxLTQuNDUtMy4wMDEgMTQuMTExIDE0LjExMSAwIDAxLTMuNjc4LTYuNDUyLjUwMy41MDMgMCAwMC0uOTc1IDAgMTQuMTM0IDE0LjEzNCAwIDAxLTMuNjc5IDYuNDUyIDE0LjE1NSAxNC4xNTUgMCAwMS00LjQ1IDMuMDAxYy0uNjUuMjgtMS4zMTguNTA1LTIuMDAyLjY3OGEuNTAyLjUwMiAwIDAwMCAuOTc1Yy42ODQuMTcyIDEuMzUuMzk3IDIuMDAyLjY3N2ExNC4xNDcgMTQuMTQ3IDAgMDE0LjQ1IDMuMDAxIDE0LjExMiAxNC4xMTIgMCAwMTMuNjc5IDYuNDUzLjUwMi41MDIgMCAwMC45NzUgMGMuMTcyLS42ODUuMzk3LTEuMzUxLjY3Ny0yLjAwM2ExNC4xNDUgMTQuMTQ1IDAgMDEzLjAwMS00LjQ1IDE0LjExMyAxNC4xMTMgMCAwMTYuNDUzLTMuNjc4LjUwMy41MDMgMCAwMDAtLjk3NSAxMy4yNDUgMTMuMjQ1IDAgMDEtMi4wMDMtLjY3OHoiIGZpbGw9InVybCgjbG9iZS1pY29ucy1nZW1pbmktMi1fUl8wXykiPjwvcGF0aD48ZGVmcz48bGluZWFyR3JhZGllbnQgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGlkPSJsb2JlLWljb25zLWdlbWluaS0wLV9SXzBfIiB4MT0iNyIgeDI9IjExIiB5MT0iMTUuNSIgeTI9IjEyIj48c3RvcCBzdG9wLWNvbG9yPSIjMDhCOTYyIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDhCOTYyIiBzdG9wLW9wYWNpdHk9IjAiPjwvc3RvcD48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgaWQ9ImxvYmUtaWNvbnMtZ2VtaW5pLTEtX1JfMF8iIHgxPSI4IiB4Mj0iMTEuNSIgeTE9IjUuNSIgeTI9IjExIj48c3RvcCBzdG9wLWNvbG9yPSIjRjk0NTQzIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjRjk0NTQzIiBzdG9wLW9wYWNpdHk9IjAiPjwvc3RvcD48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgaWQ9ImxvYmUtaWNvbnMtZ2VtaW5pLTItX1JfMF8iIHgxPSIzLjUiIHgyPSIxNy41IiB5MT0iMTMuNSIgeTI9IjEyIj48c3RvcCBzdG9wLWNvbG9yPSIjRkFCQzEyIj48L3N0b3A+PHN0b3Agb2Zmc2V0PSIuNDYiIHN0b3AtY29sb3I9IiNGQUJDMTIiIHN0b3Atb3BhY2l0eT0iMCI+PC9zdG9wPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjwvc3ZnPg==",
  "grok": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZWRlZGYxIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+R3JvazwvdGl0bGU+PHBhdGggZD0iTTkuMjcgMTUuMjlsNy45NzgtNS44OTdjLjM5MS0uMjkuOTUtLjE3NyAxLjEzNy4yNzIuOTggMi4zNjkuNTQyIDUuMjE1LTEuNDEgNy4xNjktMS45NTEgMS45NTQtNC42NjcgMi4zODItNy4xNDkgMS40MDZsLTIuNzExIDEuMjU3YzMuODg5IDIuNjYxIDguNjExIDIuMDAzIDExLjU2Mi0uOTUzIDIuMzQxLTIuMzQ0IDMuMDY2LTUuNTM5IDIuMzg4LTguNDJsLjAwNi4wMDdjLS45ODMtNC4yMzIuMjQyLTUuOTI0IDIuNzUtOS4zODMuMDYtLjA4Mi4xMi0uMTY0LjE3OS0uMjQ4bC0zLjMwMSAzLjMwNXYtLjAxTDkuMjY3IDE1LjI5Mk03LjYyMyAxNi43MjNjLTIuNzkyLTIuNjctMi4zMS02LjgwMS4wNzEtOS4xODQgMS43NjEtMS43NjMgNC42NDctMi40ODMgNy4xNjYtMS40MjVsMi43MDUtMS4yNWE3LjgwOCA3LjgwOCAwIDAwLTEuODI5LTFBOC45NzUgOC45NzUgMCAwMDUuOTg0IDUuODNjLTIuNTMzIDIuNTM2LTMuMzMgNi40MzYtMS45NjIgOS43NjQgMS4wMjIgMi40ODctLjY1MyA0LjI0Ni0yLjM0IDYuMDIyLS41OTkuNjMtMS4xOTkgMS4yNTktMS42ODIgMS45MjVsNy42Mi02LjgxNSI+PC9wYXRoPjwvc3ZnPg==",
  "mimocode": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSJjdXJyZW50Q29sb3IiIGhlaWdodD0iMWVtIiBzdHlsZT0iZmxleDpub25lO2xpbmUtaGVpZ2h0OjEiIHZpZXdCb3g9IjEwIDI4IDEwOCA3MiIgd2lkdGg9IjFlbSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+bWltb2NvZGU8L3RpdGxlPjxnPjxwYXRoIGQ9Ik0yNi43NCw0My42OWw4Ljc1LTEwLjg1aC00LjcybC02LjQ1LDcuOTYtNi40NS03Ljk2aC00LjcybDguNzUsMTAuODUuMDMuMDQtOS4xMSwxMS4yNGg1LjAzbDYuNDYtOC4yNiw2LjQ2LDguMjZoNS4wM2wtOS4xMS0xMS4yNC4wMy0uMDRaTTM5Ljc1LDMwLjM1Yy0xLjUyLDAtMi41MSwxLjEyLTIuNTEsMi40OHMuOTksMi40OCwyLjUxLDIuNDgsMi41MS0xLjEyLDIuNTEtMi40OC0uOTktMi40OC0yLjUxLTIuNDhaTTM3Ljc1LDU0Ljk3aDMuOTl2LTE3LjU3aC0zLjk5djE3LjU3Wk02MC4wMiw0NC4zNnYxMC42MWgtMy45OXYtMS43NmMtMS4xNiwxLjM2LTIuOTMsMi4xOS01LjY3LDIuMTktMS4yNiwwLTUuNDktLjcyLTUuOTYtNC45Ny0uNDUtNC4wNiwyLjktNi43OCw5LjE3LTYuNzhoMi40NWMwLTIuMTYtLjk5LTMuNDgtMy42OC0zLjUzLTIuMTktLjA0LTQuMDIuODItNS4zNywybC0xLjU3LTMuMDFjMi4wNC0xLjc3LDUuMjktMi44MSw4LjY4LTIuMzksNS41Ni42OCw1Ljk0LDUuMjgsNS45NCw3LjYzWk01Ni4wMiw0Ni45NGgtMS45NWMtNC4yMSwwLTUuOCwxLjM1LTUuNjUsMi44OS4xNCwxLjUsMS41MSwyLjE2LDMuMTgsMi4xNiwyLjg1LDAsNC40Mi0yLjc5LDQuNDItNC41NXYtLjQ5Wk04MC4xLDQ2LjEyYzAsNS4xNS0zLjUyLDkuMzgtOC45Miw5LjM4cy04LjkyLTQuMjQtOC45Mi05LjM4LDMuNTItOS4zOCw4LjkyLTkuMzgsOC45Miw0LjI0LDguOTIsOS4zOFpNNzYuMTEsNDYuMTJjMC0zLjY2LTIuMTctNS44MS00LjkzLTUuODFzLTQuOTMsMi4xNS00LjkzLDUuODEsMi4xNyw1LjgxLDQuOTMsNS44MSw0LjkzLTIuMTUsNC45My01LjgxWk0xMTAuNTgsNTQuOTdoMy45OXYtMTcuNTdoLTMuOTl2MTcuNTdaTTExMi41NywzMC4zNWMtMS41MiwwLTIuNTEsMS4xMi0yLjUxLDIuNDhzLjk5LDIuNDgsMi41MSwyLjQ4LDIuNTEtMS4xMiwyLjUxLTIuNDgtLjk5LTIuNDgtMi41MS0yLjQ4Wk0xMDEuMjcsMzYuNjNjLTIuNDksMC00LjMxLDEuMDMtNS4zLDMuMi0uOTQtMi4zMi0yLjg5LTMuMi00Ljc4LTMuMi0xLjcxLDAtMy45Ny43Ny00LjczLDIuODJ2LTIuMDVoLTMuOTF2MTcuNTdoMy45OXYtMTAuNDdjMC0xLjI5LjQyLTQuMTksMy4xNy00LjE5czMuMjEsMi44OSwzLjIxLDQuMTl2MTAuNDdoMy45OXYtMTAuNDdjMC0xLjI5LjQyLTQuMTksMy4yMS00LjE5czMuMTcsMi44OSwzLjE3LDQuMTl2MTAuNDdoMy45OXYtMTEuNDJjMC00LjU4LTIuNzQtNi45Mi02LjAzLTYuOTJaIi8+PGc+PHBhdGggZD0iTTQ0LjU3LDc1Ljk3djE5LjM3YzAsMS4wNy0uODcsMS45My0xLjkzLDEuOTNzLTEuOTMtLjg3LTEuOTMtMS45M3YtMTkuMzdjMC0xLjA3Ljg3LTEuOTMsMS45My0xLjkzczEuOTMuODcsMS45MywxLjkzWiIvPjxwYXRoIGQ9Ik0xNC43Nyw4Mi44MmgwYy0xLjA3LDAtMS45My44Ny0xLjkzLDEuOTN2MTAuNmMwLDEuMDcuODcsMS45MywxLjkzLDEuOTNoMGMxLjA3LDAsMS45My0uODcsMS45My0xLjkzdi0xMC42YzAtMS4wNy0uODctMS45My0xLjkzLTEuOTNaIi8+PHBhdGggZD0iTTM2LjYsNzUuNzdzMC0uMDUtLjAxLS4wOGMwLS4wNCwwLS4wNy0uMDItLjExLDAtLjAzLS4wMS0uMDYtLjAyLS4wOSwwLS4wMy0uMDEtLjA2LS4wMi0uMDksMC0uMDMtLjAyLS4wNi0uMDMtLjA5LS4wMS0uMDMtLjAyLS4wNi0uMDMtLjA5LS4wMS0uMDMtLjAzLS4wNS0uMDQtLjA4LS4wMS0uMDMtLjAzLS4wNi0uMDQtLjA5LS4wMS0uMDMtLjAzLS4wNS0uMDQtLjA4LS4wMi0uMDMtLjAzLS4wNi0uMDUtLjA5LS4wMi0uMDMtLjA0LS4wNS0uMDYtLjA4LS4wMi0uMDItLjAzLS4wNS0uMDUtLjA3LS4wNC0uMDUtLjA4LS4xLS4xMy0uMTRoMHMtLjA5LS4wOS0uMTQtLjEzYy0uMDItLjAyLS4wNS0uMDMtLjA3LS4wNS0uMDMtLjAyLS4wNS0uMDQtLjA4LS4wNi0uMDMtLjAyLS4wNS0uMDMtLjA4LS4wNS0uMDMtLjAyLS4wNS0uMDMtLjA4LS4wNS0uMDMtLjAxLS4wNi0uMDMtLjA5LS4wNC0uMDMtLjAxLS4wNi0uMDMtLjA5LS4wNC0uMDMtLjAxLS4wNi0uMDItLjA4LS4wMy0uMDMtLjAxLS4wNi0uMDItLjEtLjAzLS4wMywwLS4wNi0uMDEtLjA4LS4wMi0uMDMsMC0uMDctLjAyLS4xLS4wMi0uMDMsMC0uMDYsMC0uMDktLjAxLS4wMywwLS4wNi0uMDEtLjEtLjAxLS4wNSwwLS4xMSwwLS4xNiwwLDAsMC0uMDIsMC0uMDMsMC0uMDEsMC0uMDIsMC0uMDMsMC0uMDUsMC0uMTEsMC0uMTYsMC0uMDMsMC0uMDcsMC0uMS4wMS0uMDMsMC0uMDYsMC0uMDkuMDEtLjA0LDAtLjA3LjAyLS4xMS4wMy0uMDMsMC0uMDUuMDEtLjA4LjAyLS4wMy4wMS0uMDcuMDItLjEuMDQtLjAzLDAtLjA1LjAyLS4wOC4wMy0uMDMuMDEtLjA2LjAzLS4wOS4wNC0uMDMuMDEtLjA1LjAyLS4wOC4wNC0uMDMuMDItLjA2LjAzLS4wOS4wNS0uMDIuMDEtLjA1LjAzLS4wNy4wNC0uMDMuMDItLjA2LjA1LS4xLjA3LS4wMi4wMS0uMDQuMDMtLjA2LjA0LS4wNS4wNC0uMS4wOC0uMTQuMTNsLTguNTksOC41OS04LjU5LTguNTljLS43NS0uNzUtMS45OC0uNzUtMi43MywwaDBjLS43NS43NS0uNzUsMS45OCwwLDIuNzNsOS45Niw5Ljk2Yy43Ni43NiwxLjk4Ljc2LDIuNzMsMGw2LjY2LTYuNjZ2MTQuNzNjMCwxLjA3Ljg3LDEuOTMsMS45MywxLjkzczEuOTMtLjg3LDEuOTMtMS45M3YtMTkuMzljMC0uMDYsMC0uMTMsMC0uMTlaIi8+PHBhdGggZD0iTTUwLjYsODIuODJjLTEuMDcsMC0xLjkzLjg3LTEuOTMsMS45M3YxMC42YzAsMS4wNy44NywxLjkzLDEuOTMsMS45M3MxLjkzLS44NywxLjkzLTEuOTN2LTEwLjZjMC0xLjA3LS44Ny0xLjkzLTEuOTMtMS45M1oiLz48cGF0aCBkPSJNNzIuNDQsNzUuNzdzMC0uMDUtLjAxLS4wOGMwLS4wNCwwLS4wNy0uMDItLjExLDAtLjAzLS4wMS0uMDYtLjAyLS4wOSwwLS4wMy0uMDEtLjA2LS4wMi0uMDksMC0uMDMtLjAyLS4wNi0uMDMtLjA5LS4wMS0uMDMtLjAyLS4wNi0uMDMtLjA5LS4wMS0uMDMtLjAzLS4wNS0uMDQtLjA4LS4wMS0uMDMtLjAzLS4wNi0uMDQtLjA5LS4wMS0uMDMtLjAzLS4wNS0uMDQtLjA4LS4wMi0uMDMtLjAzLS4wNi0uMDUtLjA5LS4wMi0uMDMtLjA0LS4wNS0uMDYtLjA4LS4wMi0uMDItLjAzLS4wNS0uMDUtLjA3LS4wNC0uMDUtLjA4LS4xLS4xMy0uMTRoMHMtLjA5LS4wOS0uMTQtLjEzYy0uMDItLjAyLS4wNS0uMDMtLjA3LS4wNS0uMDMtLjAyLS4wNS0uMDQtLjA4LS4wNi0uMDMtLjAyLS4wNS0uMDMtLjA4LS4wNS0uMDMtLjAyLS4wNS0uMDMtLjA4LS4wNS0uMDMtLjAxLS4wNi0uMDMtLjA5LS4wNC0uMDMtLjAxLS4wNi0uMDMtLjA5LS4wNC0uMDMtLjAxLS4wNi0uMDItLjA4LS4wMy0uMDMtLjAxLS4wNi0uMDItLjEtLjAzLS4wMywwLS4wNS0uMDEtLjA4LS4wMi0uMDMsMC0uMDctLjAyLS4xLS4wMi0uMDMsMC0uMDYsMC0uMDktLjAxLS4wMywwLS4wNi0uMDEtLjEtLjAxLS4wNSwwLS4xMSwwLS4xNiwwLDAsMC0uMDIsMC0uMDMsMGgwcy0uMDIsMC0uMDMsMGMtLjA1LDAtLjExLDAtLjE2LDAtLjAzLDAtLjA3LDAtLjEuMDEtLjAzLDAtLjA2LDAtLjA5LjAxLS4wNCwwLS4wNy4wMi0uMTEuMDMtLjAzLDAtLjA1LjAxLS4wOC4wMi0uMDMuMDEtLjA3LjAyLS4xLjA0LS4wMywwLS4wNS4wMi0uMDguMDMtLjAzLjAxLS4wNi4wMy0uMDkuMDQtLjAzLjAxLS4wNS4wMi0uMDguMDQtLjAzLjAyLS4wNi4wMy0uMDkuMDUtLjAyLjAxLS4wNS4wMy0uMDcuMDQtLjAzLjAyLS4wNi4wNS0uMS4wNy0uMDIuMDEtLjA0LjAzLS4wNi4wNC0uMDUuMDQtLjEuMDgtLjE0LjEzbC04LjU5LDguNTktOC41OS04LjU5Yy0uNzUtLjc1LTEuOTgtLjc1LTIuNzMsMGgwYy0uNzUuNzUtLjc1LDEuOTgsMCwyLjczbDkuOTYsOS45NmMuNzYuNzYsMS45OC43NiwyLjczLDBsNi42Ni02LjY2djE0LjczYzAsMS4wNy44NywxLjkzLDEuOTMsMS45M2gwYzEuMDcsMCwxLjkzLS44NywxLjkzLTEuOTN2LTE5LjM5YzAtLjA2LDAtLjEzLDAtLjE5WiIvPjxwYXRoIGQ9Ik05MC43NCw5Mi45OGMtMy4wNCwxLjQ2LTYuOC44OS05LjI3LTEuNTctMi40Ni0yLjQ2LTMuMDMtNi4yMi0xLjU3LTkuMjcuNC0uODMuMTQtMS44Mi0uNi0yLjM3aDBjLS45OC0uNzQtMi4zOS0uMzgtMi45Mi43My0yLjEzLDQuNDktMS4yOCwxMC4wMiwyLjM0LDEzLjY1czkuMTYsNC40OCwxMy42NSwyLjM0YzEuMTEtLjUzLDEuNDYtMS45NC43My0yLjkyLS41NS0uNzMtMS41NC0uOTktMi4zNy0uNloiLz48cGF0aCBkPSJNOTUuNyw3Ny4xOGMtMy42My0zLjYzLTkuMTYtNC40OC0xMy42NS0yLjM0LTEuMTEuNTMtMS40NiwxLjk0LS43MywyLjkyLjU1LjczLDEuNTQuOTksMi4zNy42LDMuMDQtMS40Niw2LjgtLjg5LDkuMjcsMS41NywyLjQ2LDIuNDYsMy4wMyw2LjIyLDEuNTcsOS4yNy0uNC44My0uMTQsMS44Mi42LDIuMzcuOTguNzQsMi4zOS4zOCwyLjkyLS43MywyLjEzLTQuNDksMS4yOC0xMC4wMi0yLjM0LTEzLjY1WiIvPjwvZz48L2c+PC9zdmc+",
  "doubao-color": "data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjFlbSIgc3R5bGU9ImZsZXg6bm9uZTtsaW5lLWhlaWdodDoxIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIxZW0iIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHRpdGxlPkRvdWJhbzwvdGl0bGU+PHBhdGggZD0iTTUuMzEgMTUuNzU2Yy4xNzItMy43NSAxLjg4My01Ljk5OSAyLjU0OS02LjczOS0zLjI2IDIuMDU4LTUuNDI1IDUuNjU4LTYuMzU4IDguMzA4djEuMTJDMS41MDEgMjEuNTEzIDQuMjI2IDI0IDcuNTkgMjRhNi41OSA2LjU5IDAgMDAyLjItLjM3NWMuMzUzLS4xMi43LS4yNDggMS4wMzktLjM3OC45MTMtLjg5OSAxLjY1LTEuOTEgMi4yNDMtMi45OTItNC44NzcgMi40MzEtNy45NzQuMDcyLTcuNzYzLTQuNWwuMDAyLjAwMXoiIGZpbGw9IiMxRTM3RkMiPjwvcGF0aD48cGF0aCBkPSJNMjIuNTcgMTAuMjgzYy0xLjIxMi0uOTAxLTQuMTA5LTIuNDA0LTcuMzk3LTIuOC4yOTUgMy43OTIuMDkzIDguNzY2LTIuMSAxMi43NzNhMTIuNzgyIDEyLjc4MiAwIDAxLTIuMjQ0IDIuOTkyYzMuNzY0LTEuNDQ4IDYuNzQ2LTMuNDU3IDguNTk2LTUuMjE5IDIuODItMi42ODMgMy4zNTMtNS4xNzggMy4zNjEtNi42NmEyLjczNyAyLjczNyAwIDAwLS4yMTYtMS4wODR2LS4wMDJ6IiBmaWxsPSIjMzdFMUJFIj48L3BhdGg+PHBhdGggZD0iTTE0LjMwMyAxLjg2N0MxMi45NTUuNyAxMS4yNDggMCA5LjM5IDAgNy41MzIgMCA1Ljg4My42NzcgNC41NDUgMS44MDcgMi43OTEgMy4yOSAxLjYyNyA1LjU1NyAxLjUgOC4xMjV2OS4yMDFjLjkzMi0yLjY1IDMuMDk3LTYuMjUgNi4zNTctOC4zMDcuNS0uMzE4IDEuMDI1LS41OTUgMS41NjktLjgyOSAxLjg4My0uODAxIDMuODc4LS45MzIgNS43NDYtLjcwNi0uMjIyLTIuODMtLjcxOC01LjAwMi0uODctNS42MTdoLjAwMXoiIGZpbGw9IiNBNTY5RkYiPjwvcGF0aD48cGF0aCBkPSJNMTcuMzA1IDQuOTYxYTE5OS40NyAxOTkuNDcgMCAwMS0xLjA4LTEuMDk0Yy0uMjAyLS4yMTMtLjM5OC0uNDE5LS41ODYtLjYyMmwtMS4zMzMtMS4zNzhjLjE1MS42MTUuNjQ4IDIuNzg2Ljg2OSA1LjYxNyAzLjI4OC4zOTUgNi4xODUgMS44OTggNy4zOTYgMi44LTEuMzA2LTEuMjc1LTMuNDc1LTMuNDg3LTUuMjY2LTUuMzIzeiIgZmlsbD0iIzFFMzdGQyI+PC9wYXRoPjwvc3ZnPg==",
}
// </icons>
const PROVIDER_TINTS = {
  qoder: '#a5b4fb', zcode: '#7cd3fc', workbuddy: '#6ee7b7', minmax: '#f2b445',
  opencode: '#c3c3cc', qwen: '#c4b5fd', claude: '#e8a87c', anthropic: '#e8a87c',
  openai: '#8ee6c8', gemini: '#8ab4f8', google: '#8ab4f8', deepseek: '#7aa2ff',
  glm: '#7cd3fc', zhipu: '#7cd3fc', moonshot: '#f2b445', kimi: '#f2b445', xai: '#d8d8e0',
}
const TINT_FALLBACK = ['#a5b4fb', '#7cd3fc', '#6ee7b7', '#f2b445', '#c4b5fd', '#e8a87c', '#8ee6c8']

/** A stable accent per provider, the way the panel tints its provider icons. */
function tintOf(name) {
  const key = String(name || '').toLowerCase()
  for (const entry of Object.keys(PROVIDER_TINTS)) {
    if (key.indexOf(entry) >= 0) return PROVIDER_TINTS[entry]
  }
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return TINT_FALLBACK[hash % TINT_FALLBACK.length]
}
function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return 'rgba(165,180,251,' + a + ')'
  const n = parseInt(m[1], 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

/**
 * Turn a failure into a sentence a person can act on. The host classifies
 * failures into stable codes; each one has a key in the panel's own dictionary
 * so the reason is translated instead of the host's wording leaking through.
 */
const ERROR_HINTS = {
  connection: 'err.connection',
  timeout: 'err.timeout',
  unauthorized: 'err.unauthorized',
  forbidden: 'err.forbidden',
  rate_limited: 'err.rate_limited',
  server_error: 'err.server_error',
  bad_request: 'err.bad_request',
  aborted: 'err.aborted',
  unknown: 'err.unknown',
}
function errHint(t, code, message) {
  const key = ERROR_HINTS[code]
  if (key) return t(key)
  // An unrecognised code keeps whatever the host said, but never a blank.
  return typeof message === 'string' && message !== '' ? message : t('err.unknown')
}

/**
 * Recognise a quota window by its name so the panel can rank windows by how
 * soon they run out. The gateway names them freely ("Weekly", "5h", "周"),
 * so the patterns are deliberately broad; an unknown name simply sorts last.
 */
const WINDOW_PATTERNS = [
  { key: 'weekly', re: /(7\s*days?|week|weekly|周)/i },
  { key: 'monthly', re: /(month|monthly|30\s*days?|月)/i },
  { key: 'fivehour', re: /(5[\s-]*(hours?|hrs?|h)|five[\s-]*hours?|5\s*小时|五小时)/i },
  { key: 'daily', re: /(day|daily|24\s*hours?|天)/i },
]

/** Which known window a name belongs to, or null. */
function windowKind(name) {
  const text = String(name || '')
  for (const entry of WINDOW_PATTERNS) {
    if (entry.re.test(text)) return entry.key
  }
  return null
}

/**
 * Order windows by how urgently they need attention: the tightest remaining
 * budget first, an exhausted window before an untouched one, and unknown
 * names last. Pure so it can be tested without a DOM.
 */
function sortWindows(windows) {
  const rank = { fivehour: 0, daily: 1, weekly: 2, monthly: 3 }
  return windows.slice().sort((a, b) => {
    const used = (num(b.used) || 0) - (num(a.used) || 0)
    if (Math.abs(used) > 0.05) return used
    const ka = windowKind(a.name)
    const kb = windowKind(b.name)
    if (ka === null && kb !== null) return 1
    if (kb === null && ka !== null) return -1
    if (ka !== null && kb !== null && rank[ka] !== rank[kb]) return rank[ka] - rank[kb]
    return String(a.name).localeCompare(String(b.name))
  })
}

/**
 * Usage level of a window, using the same thresholds as the reference
 * plugin: over 70% used is a warning, 90% or more is critical.
 */
function usageLevel(used) {
  const pct = Number(used)
  if (!Number.isFinite(pct) || pct <= 0) return 'ok'
  if (pct >= 90) return 'high'
  if (pct > 70) return 'warn'
  return 'ok'
}
/** Map a host response onto the same codes the host classifies failures into. */
const STATUS_CODES = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 429: 'rate_limited' }
function codeOf(res, body) {
  const known = body && typeof body.code === 'string' ? body.code : ''
  if (known !== '' && known in ERROR_HINTS) return known
  if (STATUS_CODES[res.status]) return STATUS_CODES[res.status]
  if (res.status >= 500) return 'server_error'
  if (res.status >= 400) return 'bad_request'
  return 'unknown'
}
async function getJson(url, signal) {
  let res
  try {
    res = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal })
  } catch (error) {
    // fetch only rejects when the request never got an answer.
    const failure = error instanceof Error ? error : new Error('fetch failed')
    if (!failure.code && failure.name !== 'AbortError') failure.code = 'connection'
    throw failure
  }
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    // Keep the classification: the banner can then say why, in the panel's
    // language, instead of "HTTP 502".
    const failure = new Error((body && typeof body.error === 'string' && body.error) || 'HTTP ' + res.status)
    failure.status = res.status
    failure.code = codeOf(res, body)
    throw failure
  }
  return body
}

// ---- snapshot sanitizing (whitelist rebuild) ------------------------------

function sanitizeSnapshot(raw) {
  if (!raw || raw.ok !== true || !raw.usage) return null
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const nn = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  // Quota windows carry their reset moment as ISO text ("2026-11-15T15:59:59Z"),
  // which Number() flattens to NaN. Keep either a millisecond stamp or the
  // original date text so the panel can still say when the window comes back.
  const stamp = (v) => {
    if (v == null || v === '') return null
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const text = String(v)
    const n = Number(text)
    if (Number.isFinite(n) && n > 0) return n
    return Number.isFinite(Date.parse(text)) ? text : null
  }
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
    user: s(q && q.user), alias: s(q && q.alias), readAt: stamp(q && q.readAt), until: stamp(q && q.until), renew: stamp(q && q.renew),
    windows: arr(q && q.windows, 12).map((w) => ({
      name: s(w && w.name), used: num(w && w.used), remaining: num(w && w.remaining), resetsAt: stamp(w && w.resetsAt),
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
    route_id: s(r && r.route_id), t: msOf(r && r.t), agent: s(r && r.agent), agentName: s(r && r.agentName),
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
  // Per-model speed the gateway measured itself (tokens/s and TTFT).
  const speeds = arr(raw.speeds, 8).map((sp) => ({
    model: s(sp && sp.model), name: s(sp && sp.name), requests: num(sp && sp.requests),
    tps: num(sp && sp.tps), tpsN: num(sp && sp.tpsN), ttftMs: num(sp && sp.ttftMs), cost: num(sp && sp.cost),
  }))
  // Which channel the traffic used: gateway proxy, direct client, upstream report.
  const pickChannel = (c) => (c && typeof c === 'object'
    ? { calls: num(c.calls), errors: num(c.errors), cost: num(c.cost) }
    : null)
  const ch = raw.channels || {}
  const channels = { through: pickChannel(ch.through), direct: pickChannel(ch.direct), reported: pickChannel(ch.reported) }
  return {
    ok: true, gateway: s(raw.gateway), fetchedAt: nn(raw.fetchedAt), period: s(raw.period),
    config, currency, health, usage, series, quotas, history, requests, models, speeds, channels,
    statusline: s(raw.statusline),
    // The host sends a plain string per problem; a structured {what, code, message}
    // keeps the code so the panel can say something useful about it.
    problems: arr(raw.problems, 8).map((p) => {
      if (p && typeof p === 'object') {
        return { what: s(p.what), code: s(p.code), message: s(p.message) }
      }
      return { what: '', code: '', message: s(p) }
    }),
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
  show[USAGE_BLOCK] = src[USAGE_BLOCK] !== false
  for (const k of DETAIL_BLOCKS) show[k] = src[k] !== false
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

// ---- task done alert (Magpie's own turnDoneAlert) --------------------------
//
// Magpie's setting is a duration, not a switch: notify when a task that ran at
// least this long finishes, and ring the Windows "Notification" sound with it.
// The panel can see the same thing from the session list it already has — a
// session whose row goes running -> idle is a task that just finished, and the
// time we first saw it running is how long it took. Nothing here talks to the
// gateway; the whole feature is local.

const ALERT_KEY = 'dsh-magpie-monitor:alert:v1'
// Magpie offers Off / 1 / 3 / 10 minutes; a typed value outside that is kept.
const ALERT_PRESETS = [0, 60, 180, 600]
const ALERT_MAX = 86400
// The tones the Host can serve, in the order the card shows them.
const ALERT_TONE_KEYS = ['alarm', 'ring', 'bell', 'chime']

function sanitizeAlertSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.round(n), ALERT_MAX)
}

/** Sessions running right now: id -> when we first saw it running (ms). */
function loadAlertStarts() {
  const out = []
  try {
    if (typeof window === 'undefined' || !window.localStorage) return out
    const raw = window.localStorage.getItem(ALERT_KEY)
    if (!raw) return out
    const env = JSON.parse(raw)
    if (!env || env.v !== 1 || !env.starts || typeof env.starts !== 'object') return out
    const now = Date.now()
    for (const [id, at] of Object.entries(env.starts)) {
      const began = Number(at)
      // A stale entry or a clock jump must not ring an hour later.
      if (typeof id === 'string' && id !== '' && Number.isFinite(began) && began > 0 && began <= now) out.push([id, began])
    }
  } catch {
    return []
  }
  return out
}

function saveAlertStarts(starts) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const plain = {}
    for (const [id, at] of starts) plain[id] = at
    window.localStorage.setItem(ALERT_KEY, JSON.stringify({ v: 1, starts: plain }))
  } catch { /* storage full or gone — the watch still works in memory */ }
}

/** "3 分 20 秒" / "3m 20s", the shape Magpie's "{n} min" suggests. */
function alertSpan(ms, t) {
  const total = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  if (min === 0) return t('units.sec', { n: sec })
  if (sec === 0) return t('units.min', { n: min })
  return t('units.min', { n: min }) + ' ' + t('units.sec', { n: sec })
}

// The Host serves the wavs Windows ships, so the alert rings a real system
// sound instead of an invented one. One element per tone, reused:
// retriggering is a rewind, not a new load.
let alertAudio
let alertAudioTone = ''

// Resolves true when the sound actually started and false when this machine has
// none to play, so the settings card can say which it is instead of guessing.
function playAlertSound(tone) {
  const key = typeof tone === 'string' ? tone : ''
  try {
    if (typeof Audio === 'undefined') return Promise.resolve(false)
    if (!alertAudio || alertAudioTone !== key) {
      const query = key === '' ? '' : '?tone=' + encodeURIComponent(key)
      alertAudio = new Audio(API + '/alert-sound' + query)
      alertAudio.preload = 'auto'
      alertAudio.volume = 1
      alertAudioTone = key
    }
    try { alertAudio.currentTime = 0 } catch { /* not seekable before metadata */ }
    const played = alertAudio.play()
    if (played && typeof played.then === 'function') return played.then(() => true, () => false)
    return Promise.resolve(true)
  } catch {
    // no audio element here; the notification still shows
    return Promise.resolve(false)
  }
}

function notifyPermission() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission || 'default'
  } catch {
    return 'unsupported'
  }
}

function requestNotifyPermission() {
  try {
    if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
      return Promise.resolve('unsupported')
    }
    const asked = Notification.requestPermission()
    return asked && typeof asked.then === 'function' ? asked : Promise.resolve('default')
  } catch {
    return Promise.resolve('unsupported')
  }
}

/** Desktop notification; silent, because we play Magpie's wav ourselves. */
function showDoneNotification(title, body) {
  if (notifyPermission() !== 'granted') return false
  try {
    const note = new Notification(title, { body, silent: true, tag: 'magpie-monitor:done' })
    setTimeout(() => { try { note.close() } catch { /* already gone */ } }, 8000)
    return true
  } catch {
    return false
  }
}

/** Fallback when notifications are blocked: a card in the corner, then gone. */
function showInlineAlert(title, body) {
  try {
    if (typeof document === 'undefined' || !document.body) return
    const box = document.createElement('div')
    box.className = 'mgp-alert-toast'
    const head = document.createElement('div')
    head.className = 'mgp-alert-toast-title'
    head.textContent = title
    const text = document.createElement('div')
    text.className = 'mgp-alert-toast-body'
    text.textContent = body
    box.appendChild(head)
    box.appendChild(text)
    box.addEventListener('click', () => { try { box.remove() } catch { /* gone */ } })
    document.body.appendChild(box)
    setTimeout(() => { try { box.remove() } catch { /* gone */ } }, 6000)
  } catch { /* no DOM — sound and notification carry it */ }
}

// The taskbar button belongs to the desktop shell, not to this page, so the
// blink is one small POST: the Host owns the only call that reaches it.
function flashTaskbar() {
  try {
    if (typeof fetch !== 'function') return Promise.resolve(false)
    const asked = fetch(API + '/alert-flash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    return asked.then((res) => !!(res && res.ok), () => false)
  } catch {
    return Promise.resolve(false)
  }
}

/**
 * Watches the client session list. Session rows carry `running`, so running ->
 * idle is exactly "a task finished", and the first time we saw the row running
 * is how long it ran. Kept as one function so the rule is readable: threshold
 * comes from the host config, the timing survives a page reload.
 */
function watchTurnDone(ctx, readThreshold, onDone) {
  const store = ctx && ctx.sessions && ctx.sessions.list
  if (!store || typeof store.getSnapshot !== 'function' || typeof store.subscribe !== 'function') {
    return () => {}
  }
  const starts = new Map(loadAlertStarts())
  const sync = () => {
    let snapshot
    try { snapshot = store.getSnapshot() } catch { return }
    const byId = (snapshot && snapshot.byId) || {}
    const threshold = sanitizeAlertSeconds(readThreshold())
    const now = Date.now()
    let changed = false
    for (const id of Object.keys(byId)) {
      const row = byId[id]
      if (!row || typeof row !== 'object') continue
      // A subagent's turn belongs to the task that spawned it; the task itself
      // ends when its own session goes idle.
      if (row.parentId) continue
      if (row.running) {
        if (!starts.has(id)) { starts.set(id, now); changed = true }
        continue
      }
      const began = starts.get(id)
      if (began === undefined) continue
      starts.delete(id)
      changed = true
      if (threshold <= 0) continue
      const ran = now - began
      if (ran >= threshold * 1000) onDone({ id, row, ran })
    }
    if (changed) saveAlertStarts(starts)
  }
  sync()
  const off = store.subscribe(sync)
  return () => { try { if (typeof off === 'function') off() } catch { /* already disposed */ } }
}


// ---- styles ---------------------------------------------------------------

const css = [
  // ---- magpie parity tokens (the gateway panel's own dark palette) ----
  '.mgp-footstack,.mgp-set{--mgp-card:var(--dsw-alias-bg-layer-1,#232327);--mgp-inset:var(--dsw-alias-bg-layer-2,#1f1f23);--mgp-line:var(--dsw-alias-border-l1,#2d2d32);--mgp-line2:var(--dsw-alias-border-l2,#3a3a41);--mgp-ink:var(--dsw-alias-label-primary,#ededf1);--mgp-ink2:var(--dsw-alias-label-secondary,#b9b9c1);--mgp-ink3:var(--dsw-alias-label-tertiary,#8b8b94);--mgp-accent:#a5b4fb;--mgp-accent2:#8a97e8;--mgp-mint:#6ee7b7;--mgp-cyan:#7cd3fc;--mgp-amber:#f2b445;--mgp-ok:var(--dsw-alias-state-success-primary,#3fb950);--mgp-warn:var(--dsw-alias-state-warn-primary,#d29922);--mgp-err:var(--dsw-alias-state-error-primary,#f85149);}',
  // The host hands the footer slot the sidebar column minus its inline padding,
  // which is 240..396px wide for the 264..420px sidebar (clampWidth in
  // @deepseek-ai/dsh-client-ui-layout). Fill whatever width that is, and never
  // reach outside ourselves: no :has() on host elements, no containment.
  '.mgp-footstack{display:flex;flex-direction:column;gap:var(--mgp-gap,7px);padding:9px 4px 10px;border-top:1px solid var(--mgp-line);background:transparent;color:var(--mgp-ink);font-size:12px;line-height:1.4;width:100%;max-width:100%;min-width:0;align-self:stretch;max-height:min(50dvh,440px);min-height:0;overflow:auto;box-sizing:border-box;scrollbar-width:thin;-webkit-font-smoothing:antialiased;}',
  '.mgp-footstack::-webkit-scrollbar{width:6px;}',
  '.mgp-footstack::-webkit-scrollbar-thumb{background:var(--mgp-line2);border-radius:3px;}',
  '.mgp-footstack > *{width:100%;box-sizing:border-box;min-width:0;flex:0 0 auto;}',
  // rail: collapse to the icon, the sidebar only gives it ~36px
  '.mgp-footstack.rail{flex:0 0 auto;width:auto;max-width:none;max-height:none;overflow:visible;border-top:none;padding:3px;}',
  '.mgp-footstack[data-density="normal"]{--mgp-gap:7px;--mgp-cardpad:7px 9px;--mgp-tval:17px;--mgp-chart:30px;}',
  '.mgp-footstack[data-density="tight"]{--mgp-gap:6px;--mgp-cardpad:6px 8px;--mgp-tval:16px;--mgp-chart:26px;}',
  '.mgp-footstack[data-density="short"]{--mgp-gap:5px;--mgp-cardpad:5px 7px;--mgp-tval:15px;--mgp-chart:20px;}',
  '.mgp-footstack[data-style="compact"]{--mgp-gap:5px;--mgp-cardpad:5px 7px;--mgp-tval:15px;--mgp-chart:20px;}',
  // No rules here may target the host's own elements: styling the slot or its
  // wrapper from a widget is how the panel ended up 8px wide once already.
  // ---- header ----
  '.mgp-fhead{display:flex;align-items:center;gap:6px;}',
  '.mgp-ftitle{display:flex;align-items:center;gap:7px;font-weight:600;flex:1 1 auto;min-width:0;}',
  '.mgp-flogo{width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;background:linear-gradient(180deg,rgba(165,180,251,.22),rgba(165,180,251,.08));border:1px solid rgba(165,180,251,.28);color:var(--mgp-accent);}',
  '.mgp-fname{font-size:13px;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-fbtn{appearance:none;border:1px solid transparent;background:transparent;color:var(--mgp-ink3);cursor:pointer;font-size:13px;line-height:1;padding:0;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;min-height:28px;flex:0 0 auto;transition:background .15s ease,color .15s ease;}',
  '.mgp-fbtn:hover{background:rgba(255,255,255,.07);color:var(--mgp-ink);}',
  '.mgp-fbtn[aria-pressed="true"]{color:var(--mgp-accent);border-color:rgba(165,180,251,.4);}',
  '.mgp-fbtn:disabled{opacity:.5;cursor:default;}',
  '.mgp-statusbtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:28px;min-width:28px;height:28px;padding:0 10px;border:1px solid var(--mgp-line);border-radius:999px;background:var(--mgp-inset);color:var(--mgp-ink2);cursor:pointer;font-size:12px;line-height:1;flex:0 0 auto;transition:border-color .15s ease,color .15s ease,background .15s ease;}',
  '.mgp-statusbtn:hover{border-color:var(--mgp-line2);color:var(--mgp-ink);}',
  '.mgp-statusbtn:disabled{opacity:.7;cursor:default;}',
  '.mgp-statusbtn-label{white-space:nowrap;}',
  '.mgp-statusbtn-compact{padding:0;border:none;background:transparent;min-width:24px;}',
  '.mgp-statusbtn-compact:hover{background:rgba(255,255,255,.07);}',
  '.mgp-statusbtn.mgp-statusbtn-quiet{width:26px;min-width:26px;padding:0;background:transparent;border-color:transparent;}',
  '.mgp-statusbtn.mgp-statusbtn-quiet:hover{background:var(--mgp-inset);border-color:var(--mgp-line);}',
  '.mgp-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--mgp-ink3);}',
  '.mgp-dot-on{background:var(--mgp-mint);}',
  '.mgp-dot-off{background:var(--mgp-err);}',
  '.mgp-dot-paused{background:var(--mgp-ink3);}',
  '.mgp-dot-live{box-shadow:0 0 0 0 rgba(110,231,183,.5);animation:mgp-pulse 2.4s infinite;}',
  '@keyframes mgp-pulse{0%{box-shadow:0 0 0 0 rgba(110,231,183,.45);}70%{box-shadow:0 0 0 5px rgba(110,231,183,0);}100%{box-shadow:0 0 0 0 rgba(110,231,183,0);}}',
  // ---- one request, the way the gateway panel prints it ----
  '.mgp-req{display:flex;flex-direction:column;gap:3px;min-width:0;width:100%;}',
  '.mgp-req-top{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;}',
  '.mgp-rtime{font-size:12px;font-variant-numeric:tabular-nums;color:var(--mgp-ink3);flex:0 0 auto;letter-spacing:.01em;}',
  '.mgp-sdot{width:6px;height:6px;border-radius:50%;background:var(--mgp-cyan);flex:0 0 auto;box-shadow:0 0 6px rgba(124,211,252,.5);}',
  // '›' and the model used to be squeezed by the request name at 240px
  '.mgp-reqname{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,monospace);font-size:12px;color:var(--mgp-ink);min-width:0;flex:1 1 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-flow{color:var(--mgp-ink3);flex:0 0 auto;font-size:12px;}',
  '.mgp-badge{width:18px;height:18px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;font-weight:700;line-height:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--mgp-ink2);}',
  '.mgp-badge-img{background:none;border:0;padding:0;object-fit:contain;display:block;}',
  '.mgp-bird{display:block;flex:0 0 auto;object-fit:contain;}',
  '.mgp-served{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,monospace);font-size:12px;color:var(--mgp-mint);min-width:0;flex:0 1 auto;max-width:52%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-req-meta{display:flex;flex-wrap:wrap;gap:0 5px;font-size:12px;color:var(--mgp-ink3);line-height:1.4;min-width:0;}',
  '.mgp-req-meta > span{white-space:nowrap;}',
  '.mgp-req-meta > span + span::before{content:"·";margin-right:5px;color:var(--mgp-ink3);opacity:.55;}',
  '.mgp-req-meta .mgp-mint{color:var(--mgp-mint);}',
  '.mgp-req-meta .mgp-warn{color:var(--mgp-amber);}',
  '.mgp-req-dim{opacity:.86;}',
  '.mgp-status{width:6px;height:6px;border-radius:50%;flex:0 0 auto;margin-left:auto;}',
  '.mgp-status-ok{background:var(--mgp-mint);}',
  '.mgp-status-ok.mgp-status-idle{background:var(--mgp-ink3);box-shadow:none;}',
  '.mgp-status-err{background:var(--mgp-err);}',
  // ---- latest route card ----
  '.mgp-latest{display:flex;flex-direction:column;gap:5px;padding:var(--mgp-cardpad,7px 9px);background:var(--mgp-card);border:1px solid var(--mgp-line);border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.03);}',
  // the row is two nowrap groups on one line: the left group must clip (not
  // overflow) when the header is squeezed, or its time slides under the
  // provider/rate on the right — a real overlap at 350px and below
  '.mgp-latest-top{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;}',
  '.mgp-latest-head{display:flex;align-items:center;gap:7px;flex:0 1 auto;min-width:0;overflow:hidden;}',
  '.mgp-latest-label{font-size:12px;font-weight:600;color:var(--mgp-ink2);letter-spacing:.02em;white-space:nowrap;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-latest-head .mgp-rtime{font-variant-numeric:tabular-nums;}',
  '.mgp-latest-meta{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mgp-ink3);white-space:nowrap;font-variant-numeric:tabular-nums;flex:0 1 auto;min-width:0;overflow:hidden;}',
  // the text is the only part allowed to give: it owns the shrink, so the dot
  // beside it is never clipped by the container's overflow
  '.mgp-latest-metatext{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.mgp-latest-meta .mgp-status{margin-left:0;}',
  // the gateway topology strip: harness ─▶ magpie ─▶ provider, with a magpie
  // flying the wire while requests are actually moving
  '.mgp-route{position:relative;height:58px;margin-top:1px;}',
  '.mgp-route-wire{position:absolute;left:0;top:0;width:100%;height:58px;overflow:visible;pointer-events:none;}',
  '.mgp-wire{fill:none;stroke:var(--mgp-line2);stroke-width:1.25;stroke-linecap:round;stroke-dasharray:2 7;animation:mgp-wire 1.5s linear infinite;animation-play-state:paused;}',
  // while the birds are in the air the route is drawn solid: the wire is carrying
  // traffic, the dashes are what it looks like when nothing is flying
  '.mgp-route[data-live="1"] .mgp-wire{stroke:rgba(124,211,252,.6);stroke-dasharray:none;animation:none;}',
  '@keyframes mgp-wire{to{stroke-dashoffset:-9;}}',
  '.mgp-fly{opacity:0;transition:opacity .35s ease;}',
  '.mgp-route[data-live="1"] .mgp-fly{opacity:1;}',
  '.mgp-flier{color:var(--mgp-ink);}',
  '.mgp-flier .body,.mgp-flier .tail,.mgp-flier .wing path:first-child{fill:currentColor;}',
  '.mgp-flier .wing.far{opacity:.45;}',
  '.mgp-flier .belly{fill:var(--mgp-card);}',
  '.mgp-flier .wing .bar{fill:none;stroke:var(--mgp-card);stroke-width:1.3;stroke-linecap:round;}',
  '.mgp-flier .wing{transform-box:fill-box;transform-origin:50% 100%;animation:mgp-flap .42s cubic-bezier(.45,0,.3,1) infinite;}',
  '.mgp-flier .wing.far{animation-delay:-.03s;}',
  '.mgp-fly-dot{fill:rgba(124,211,252,.95);}',
  '.mgp-fly-dot.back{fill:var(--mgp-card);stroke:rgba(124,211,252,.95);stroke-width:1.6;}',
  '@keyframes mgp-flap{0%,100%{transform:scaleY(1);}55%{transform:scaleY(-.62) skewX(-8deg);}}',
  '.mgp-route[data-live="0"] .mgp-flier .wing{animation-play-state:paused;}',
  // marks are columns pinned to the wire's own coordinates: icons centred on
  // the line, names under them, and the hub up on the arc's apex so the bird
  // flies through it instead of past it
  '.mgp-route-nodes{position:absolute;left:0;right:0;top:20px;display:flex;align-items:flex-start;justify-content:space-between;gap:6px;padding:0 17px;}',
  '.mgp-node{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;max-width:44%;font-size:12px;color:var(--mgp-ink3);}',
  '.mgp-node-ic{width:18px;height:18px;border-radius:5px;object-fit:contain;flex:0 0 auto;}',
  '.mgp-node-hub{width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;background:var(--mgp-inset);border:1.5px solid var(--mgp-line2);flex:0 0 auto;transition:border-color .2s ease,box-shadow .2s ease;}',
  '.mgp-route[data-live="1"] .mgp-node-hub{border-color:var(--mgp-ink);box-shadow:0 0 0 3px rgba(165,180,251,.16);}',
  '.mgp-node-name{font-size:12px;color:var(--mgp-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:100%;}',
  // the hub is not in the row: it rides the apex, so both arcs pass through it
  '.mgp-node-mid{position:absolute;left:50%;top:2px;transform:translateX(-50%);max-width:50%;}',
  // narrow sidebar: the marks alone still say who is talking to whom. The strip
  // is laid out intrinsically (names shrink and ellipsize, the row never
  // depends on a container query) because the host slot does not guarantee a
  // containment context, and declaring one on the panel itself collapsed the
  // widget in the real sidebar.
  '.mgp-latest-route{display:flex;flex-direction:column;gap:2px;min-width:0;}',
  // ---- period segmented control ----
  '.mgp-tabs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:2px;padding:2px;background:var(--mgp-inset);border:1px solid var(--mgp-line);border-radius:999px;}',
  '.mgp-tab{appearance:none;border:none;background:transparent;color:var(--mgp-ink3);cursor:pointer;font-size:12px;min-height:28px;padding:0 4px;border-radius:999px;font-family:inherit;transition:color .15s ease,background .15s ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-tab:hover{color:var(--mgp-ink2);}',
  '.mgp-tab-on{background:#33333a;color:var(--mgp-ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.25);}',
  // ---- usage cells ----
  '.mgp-today{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--mgp-gap,7px);}',
  '.mgp-tcell{display:flex;flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:0 3px;padding:5px 7px;background:var(--mgp-card);border:1px solid var(--mgp-line);border-radius:9px;min-width:0;overflow:hidden;}',
  '.mgp-tval{font-size:var(--mgp-tval,15px);font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--mgp-ink);}',
  '.mgp-tlab{font-size:12px;color:var(--mgp-ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}',
  // three cells in a 260px panel leave no room for "1.5M token" on one line:
  // stack the label under the value rather than cut it to "1.5M to…"
  // three cells in a 260px panel leave no room for "1.5M token" on one line:
  // the label falls under the value on its own (flex-wrap on .mgp-tcell)
  // instead of being cut to "1.5M to…" — intrinsic, no container query
  '.mgp-metrics{display:flex;flex-wrap:wrap;gap:0 6px;font-size:12px;color:var(--mgp-ink3);font-variant-numeric:tabular-nums;}',
  '.mgp-metrics > span{white-space:nowrap;}',
  '.mgp-metrics > span + span::before{content:"·";margin-right:6px;opacity:.55;}',
  '.mgp-metrics .mgp-warn{color:var(--mgp-amber);}',
  '.mgp-metrics .mgp-mint{color:var(--mgp-mint);}',
  // ---- activity chart ----
  '.mgp-chart{display:flex;align-items:flex-end;gap:3px;height:var(--mgp-chart,30px);border-bottom:1px solid var(--mgp-line);padding-bottom:0;}',
  '.mgp-bar{flex:1 1 0;min-width:2px;background:linear-gradient(180deg,#c7d0ff,#8a97e8);border-radius:2px 2px 0 0;min-height:2px;transition:opacity .15s ease;}',
  '.mgp-bar:hover{opacity:1;}',
  '.mgp-bar-err{background:linear-gradient(180deg,rgba(242,180,69,.62),rgba(217,154,43,.62));}',
  // ---- quota rows ----
  '.mgp-qwrap{display:flex;flex-direction:column;gap:0;width:100%;}',
  '.mgp-qbar + .mgp-qbar{padding-top:8px;border-top:1px solid var(--mgp-line);}',
  '.mgp-qbar{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:3px 6px;width:100%;padding:5px 0;}',
  '.mgp-qbar + .mgp-qbar{border-top:1px solid var(--mgp-line);}',
  '.mgp-qname{font-size:12px;color:var(--mgp-ink);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-qwin{color:var(--mgp-ink3);font-size:12px;white-space:nowrap;}',
  '.mgp-qpct{font-size:12px;font-variant-numeric:tabular-nums;color:var(--mgp-ink2);white-space:nowrap;}',
  '.mgp-qpct.mgp-qpct-low{color:var(--mgp-ink);font-weight:600;}',
  '.mgp-track{grid-column:1 / -1;height:3px;border-radius:999px;background:var(--mgp-inset);overflow:hidden;}',
  '.mgp-fill{height:100%;background:linear-gradient(90deg,#8a97e8,#b7c2ff);border-radius:999px;transition:width .3s ease;}',
  '.mgp-qmeta{grid-column:1 / 3;display:flex;flex-wrap:wrap;gap:0 5px;font-size:12px;color:var(--mgp-ink3);min-width:0;font-variant-numeric:tabular-nums;}',
  '.mgp-qmeta > span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-qmeta > span + span::before{content:"·";margin-right:5px;opacity:.55;}',
  '.mgp-spark{grid-column:3;justify-self:end;display:block;opacity:.9;}',
  // ---- section headers ----
  '.mgp-sec{display:flex;align-items:center;gap:6px;min-width:0;margin-top:1px;}',
  '.mgp-sec-t{font-size:12px;font-weight:600;color:var(--mgp-ink2);letter-spacing:.02em;white-space:nowrap;}',
  '.mgp-sec-l{flex:1 1 auto;height:1px;background:var(--mgp-line);}',
  '.mgp-sec-n{font-size:12px;color:var(--mgp-ink3);font-variant-numeric:tabular-nums;white-space:nowrap;}',
  // ---- detail ----
  '.mgp-expand{appearance:none;display:flex;align-items:center;justify-content:center;gap:5px;width:100%;min-height:28px;padding:6px 0 0;margin-top:1px;border:none;border-top:1px solid var(--mgp-line);background:transparent;color:var(--mgp-ink3);cursor:pointer;font-size:12px;font-family:inherit;}',
  '.mgp-expand:hover{color:var(--mgp-ink);}',
  '.mgp-detail{display:flex;flex-direction:column;gap:9px;width:100%;}',
  '.mgp-detail > *{width:100%;box-sizing:border-box;min-width:0;}',
  '.mgp-dhead{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--mgp-ink2);letter-spacing:.02em;margin-bottom:4px;min-width:0;}',
  '.mgp-dhead-t{white-space:nowrap;}',
  '.mgp-recent{display:flex;flex-direction:column;gap:0;width:100%;}',
  '.mgp-recent > .mgp-req + .mgp-req{border-top:1px solid var(--mgp-line);padding-top:5px;margin-top:5px;}',
  '.mgp-seg{display:flex;gap:2px;padding:2px;background:var(--mgp-inset);border:1px solid var(--mgp-line);border-radius:999px;margin-left:auto;flex:0 0 auto;}',
  '.mgp-segbtn{appearance:none;border:none;background:transparent;color:var(--mgp-ink3);cursor:pointer;font-size:12px;min-height:20px;padding:0 7px;border-radius:999px;font-family:inherit;}',
  '.mgp-segbtn:hover{color:var(--mgp-ink2);}',
  '.mgp-segbtn-on{background:#33333a;color:var(--mgp-ink);font-weight:600;}',
  // alerts card: a wrapped row of controls, and the corner card the panel uses
  // when desktop notifications are blocked
  '.mgp-alert-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
  '.mgp-alert-seg{margin-left:0;flex-wrap:wrap;}',
  '.mgp-alert-toast{position:fixed;right:16px;bottom:16px;z-index:9999;max-width:320px;padding:10px 12px;border:1px solid var(--mgp-line2,#3a3a41);border-radius:10px;background:var(--mgp-card,#232327);color:var(--mgp-ink,#ededf1);box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer;font-size:12px;line-height:1.45;}',
  '.mgp-alert-toast-title{font-weight:600;margin-bottom:2px;}',
  '.mgp-alert-toast-body{color:var(--mgp-ink2,#b9b9c1);}',
  '.mgp-mline{display:flex;align-items:center;gap:6px;font-size:12px;width:100%;min-width:0;padding:2px 0;}',
  '.mgp-mono{font-family:var(--ds-font-family-code,monospace);}',
  '.mgp-muted{color:var(--mgp-ink3);}',
  '.mgp-arrow{color:var(--mgp-ink3);}',
  '.mgp-num{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--mgp-ink2);white-space:nowrap;}',
  '.mgp-empty{font-size:12px;color:var(--mgp-ink3);}',
  '.mgp-banner{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:10px;background:var(--mgp-card);border:1px solid var(--mgp-err);font-size:12px;}',
  '.mgp-banner-text{flex:1 1 auto;min-width:0;}',
  '.mgp-stale{padding:5px 9px;border-radius:10px;background:var(--mgp-card);border:1px solid var(--mgp-warn);font-size:12px;color:var(--mgp-ink2);}',
  '.mgp-problems{font-size:12px;color:var(--mgp-amber);}',
  '.mgp-retry{appearance:none;border:1px solid var(--mgp-line2);background:transparent;color:var(--mgp-ink);cursor:pointer;font-size:12px;padding:2px 9px;min-height:24px;border-radius:999px;font-family:inherit;}',
  '.mgp-retry:hover{border-color:var(--mgp-accent);color:var(--mgp-accent);}',
  '.mgp-updated{font-size:12px;color:var(--mgp-ink3);font-variant-numeric:tabular-nums;}',
  // ---- collapsed rail + its popup ----
  '.mgp-railwrap{position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;cursor:default;}',
  '.mgp-railwrap:hover{background:rgba(255,255,255,.07);}',
  '.mgp-raildot{position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-radius:50%;border:1px solid var(--mgp-card);}',
  // The rail popup escapes the sidebar through a portal, so it needs its own
  // stacking context and a fixed anchor near the icon.
  '.mgp-railpopup{position:fixed;left:12px;bottom:56px;z-index:2147483000;width:250px;padding:10px 11px 11px;display:flex;flex-direction:column;gap:9px;background:var(--mgp-card);border:1px solid var(--mgp-line);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.5);color:var(--mgp-ink);font-size:12px;}',
  '.mgp-railpopup-head{display:flex;align-items:center;gap:7px;min-width:0;}',
  '.mgp-railpopup-title{font-weight:600;font-size:13px;white-space:nowrap;}',
  '.mgp-railpopup-sub{color:var(--mgp-ink3);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.mgp-railpopup-close{margin-left:auto;appearance:none;background:transparent;border:none;color:var(--mgp-ink3);cursor:pointer;font-size:15px;line-height:1;min-width:24px;min-height:24px;border-radius:999px;flex:0 0 auto;}',
  '.mgp-railpopup-close:hover{background:rgba(255,255,255,.07);color:var(--mgp-ink);}',
  '.mgp-railpopup-rows{display:flex;flex-direction:column;}',
  '.mgp-railpopup-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0;font-size:12px;}',
  '.mgp-railpopup-row + .mgp-railpopup-row{border-top:1px solid var(--mgp-line);}',
  '.mgp-railpopup-label{color:var(--mgp-ink3);}',
  '.mgp-railpopup-value{font-variant-numeric:tabular-nums;color:var(--mgp-ink);}',
  '.mgp-railpopup-quota{display:flex;flex-direction:column;gap:0;padding-top:7px;border-top:1px solid var(--mgp-line);}',
  // ---- minimal ----
  '.mgp-minimal{display:flex;align-items:center;gap:7px;font-size:12px;min-width:0;}',
  '.mgp-min-num{font-variant-numeric:tabular-nums;color:var(--mgp-ink2);white-space:nowrap;}',
  '.mgp-min-cost{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--mgp-ink);}',
  '.mgp-min-quota{margin-left:auto;font-size:12px;color:var(--mgp-ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 7px;border:1px solid var(--mgp-line);border-radius:999px;}',
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
  '.mgp-style-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(172px,1fr));gap:10px;}',
  '.mgp-style-card{position:relative;display:flex;flex-direction:column;gap:8px;align-items:stretch;text-align:left;appearance:none;cursor:pointer;background:var(--dsw-alias-bg-base,#0d0d0d);border:1px solid var(--dsw-alias-border-l1,#2a2a2a);border-radius:10px;padding:10px;color:inherit;font:inherit;}',
  '.mgp-style-card:hover{border-color:var(--dsw-alias-border-l2,#3a3a3a);}',
  '.mgp-style-card-on{border-color:var(--dsw-alias-brand-primary,#7aa2ff);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#7aa2ff);}',
  '.mgp-style-name{font-size:12px;font-weight:600;}',
  '.mgp-style-desc{font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);line-height:1.4;}',
  '.mgp-style-radio{position:absolute;top:8px;right:8px;width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,#3a3a3a);box-sizing:border-box;}',
  '.mgp-style-radio-on{border-color:var(--dsw-alias-brand-primary,#7aa2ff);background:var(--dsw-alias-brand-primary,#7aa2ff);box-shadow:inset 0 0 0 2px var(--dsw-alias-bg-base,#0d0d0d);}',
  '.mgp-mini{display:flex;flex-direction:column;gap:4px;height:56px;padding:6px;border-radius:8px;background:var(--mgp-inset,#1f1f23);border:1px solid var(--mgp-line,#2d2d32);overflow:hidden;}',
  '.mgp-mini-head{display:flex;align-items:center;gap:4px;}',
  '.mgp-mini-dot{width:6px;height:6px;border-radius:50%;background:var(--mgp-mint,#6ee7b7);flex:0 0 auto;}',
  '.mgp-mini-line{height:5px;flex:1 1 auto;border-radius:3px;background:var(--mgp-line2,#3a3a41);}',
  '.mgp-mini-cells{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;}',
  '.mgp-mini-cells i{height:12px;border-radius:3px;background:var(--mgp-line,#2d2d32);}',
  '.mgp-mini-chart{display:flex;align-items:flex-end;gap:2px;height:14px;}',
  '.mgp-mini-chart i{flex:1 1 0;background:var(--mgp-accent,#a5b4fb);border-radius:1px;}',
  '.mgp-mini-bars{display:flex;flex-direction:column;gap:3px;}',
  '.mgp-mini-bars i{height:4px;border-radius:2px;background:var(--mgp-mint,#6ee7b7);}',
  '.mgp-mini-compact{gap:3px;}',
  '.mgp-mini-minimal{flex-direction:row;align-items:center;height:56px;}',
  '.mgp-mini-minimal .mgp-mini-line{flex:1 1 auto;}',
  '.mgp-mini-pill{width:26px;height:10px;border-radius:5px;background:var(--mgp-accent,#a5b4fb);flex:0 0 auto;}',
  '.mgp-toggle-list{display:flex;flex-direction:column;}',
  '.mgp-toggle-subwrap{display:flex;flex-direction:column;padding-left:12px;margin-left:1px;border-left:2px solid var(--mgp-line);}',
  '.mgp-toggle-subwrap .mgp-toggle-row{padding:7px 0;}',
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
  '.mgp-preview-note{font-size:12px;color:var(--mgp-ink3,#8b8b94);}',
  '.mgp-set-fallback{padding:16px;font-size:12px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
  // ---- settings page: same card language as the panel ----
  '.mgp-set-card{background:var(--mgp-card);border-color:var(--mgp-line);border-radius:14px;}',
  '.mgp-preview-frame{border-radius:14px;border-color:var(--mgp-line);background:var(--mgp-card);}',
  '.mgp-style-card{background:var(--mgp-inset);border-color:var(--mgp-line);border-radius:12px;}',
  '.mgp-style-card:hover{border-color:var(--mgp-line2);}',
  '.mgp-style-card-on{border-color:var(--mgp-accent);box-shadow:0 0 0 1px var(--mgp-accent);}',
  '.mgp-style-radio-on{border-color:var(--mgp-accent);background:var(--mgp-accent);}',
  '.mgp-switch{background:var(--mgp-line2);}',
  '.mgp-switch-on{background:var(--mgp-accent);}',
  '.mgp-input,.mgp-select{background:var(--mgp-inset);border-color:var(--mgp-line);border-radius:10px;}',
  '.mgp-input:focus,.mgp-select:focus{border-color:var(--mgp-accent);}',
  '.mgp-btn,.mgp-note{border-radius:10px;}',
  '.mgp-btn:hover{border-color:var(--mgp-accent);color:var(--mgp-accent);}',
  '.mgp-set-title{font-size:20px;letter-spacing:-.01em;}',
  '.mgp-set-sub,.mgp-note,.mgp-field-label,.mgp-toggle-desc{color:var(--mgp-ink2);}',
  '.mgp-toggle-row{border-bottom-color:var(--mgp-line);}',
  '.mgp-mini{background:var(--mgp-inset);}',
  '.mgp-mini-chart i,.mgp-mini-pill{background:var(--mgp-accent);}',
  '.mgp-saved{color:var(--mgp-mint);}',
  // ---- readability floor: no data text below 12px, values keep their own scale ----
  '.mgp-latest-label,.mgp-latest-meta,.mgp-latest-route,.mgp-rmeta,.mgp-tab,.mgp-tlab,.mgp-metrics,.mgp-expand,.mgp-dhead,.mgp-stale,.mgp-problems,.mgp-retry,.mgp-updated,.mgp-min-quota{font-size:12px;}',
  '.mgp-qname,.mgp-qpct,.mgp-rline,.mgp-mline,.mgp-req,.mgp-empty,.mgp-banner{font-size:12px;}',
  '.mgp-style-name,.mgp-toggle-label{font-size:13px;}',
  '.mgp-style-desc,.mgp-toggle-desc,.mgp-field-label,.mgp-field-hint,.mgp-note,.mgp-preview-note,.mgp-saved{font-size:12px;}',
  '.mgp-switch{width:44px;height:26px;}',
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
    // react-dom is optional: the rail popup uses a portal when the host
    // provides it, and renders inline when it does not.
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch { ReactDOM = null }

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
        // The locale registration must be disposable: on a hot reload the
        // namespace is still taken, and a second register() would throw
        // "already has locale" and take the whole client UI down.
        ctx.effect(() => {
          const disposer = ctx.locale.register(NS, { en: EN, zh: ZH })
          return typeof disposer === 'function' ? disposer : () => {}
        }, NS + ': locale')
        const t = ctx.locale.bind(NS)

        function useLocaleTick() {
          const [, force] = React.useReducer((x) => x + 1, 0)
          React.useEffect(() => ctx.locale.subscribe(force), [])
        }

        // A rail popup has to escape the sidebar's own stacking and overflow
        // context, so it renders into document.body through a portal. When the
        // host does not expose react-dom we fall back to inline rendering.
        function usePortalTarget() {
          const [target, setTarget] = React.useState(null)
          React.useEffect(() => {
            if (typeof document === 'undefined' || !document.body) return undefined
            setTarget(document.body)
            return undefined
          }, [])
          return target
        }

        function useDismissOnOutside(ref, onDismiss, active) {
          React.useEffect(() => {
            if (!active || typeof document === 'undefined') return undefined
            const onPointer = (event) => {
              const node = ref.current
              if (node && event.target && node.contains(event.target)) return
              onDismiss()
            }
            const onKey = (event) => { if (event.key === 'Escape') onDismiss() }
            document.addEventListener('pointerdown', onPointer, true)
            document.addEventListener('keydown', onKey)
            return () => {
              document.removeEventListener('pointerdown', onPointer, true)
              document.removeEventListener('keydown', onKey)
            }
          }, [active, onDismiss])
        }

        // The mark is magpie's own bird (icons/magpie.svg, lifted from the app),
        // never a redrawing: the same silhouette at every size.
        function MagpieIcon({ size, active }) {
          const s = size || 18
          return h('img', {
            className: 'mgp-bird', src: BRAND_ICONS.magpie, alt: '', draggable: false,
            'aria-hidden': true,
            style: { width: s + 'px', height: s + 'px', opacity: active === false ? 0.55 : 1 },
          })
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

        // The flight strip is drawn in its own pixel space: measure the box so
        // the wire can be built to the sidebar's actual width instead of being
        // letterboxed from a fixed viewBox. `last` guards against re-rendering
        // when nothing changed (ResizeObserver fires on the first observe).
        function useBoxWidth(ref, fallback) {
          const [width, setWidth] = React.useState(0)
          const last = React.useRef(-1)
          React.useEffect(() => {
            const el = ref.current
            if (!el) return undefined
            const read = () => {
              const next = el.clientWidth || 0
              if (next === last.current) return
              last.current = next
              setWidth(next)
            }
            read()
            if (typeof ResizeObserver === 'function') {
              const ro = new ResizeObserver(read)
              ro.observe(el)
              return () => ro.disconnect()
            }
            window.addEventListener('resize', read)
            return () => window.removeEventListener('resize', read)
          }, [ref])
          return width > 0 ? width : fallback
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
          // Reading the persisted envelope costs up to 300 KB of JSON parsing, so
          // it happens once per mount instead of once per render.
          const bootRef = React.useRef(null)
          if (bootRef.current === null) bootRef.current = loadPersisted()
          const persisted = bootRef.current
          const ui = useUi()
          const auto = ui.auto
          const masked = ui.masked
          const [snap, setSnap] = React.useState(persisted.snap)
          const [updatedAt, setUpdatedAt] = React.useState(persisted.savedAt)
          const [failed, setFailed] = React.useState(false)
          // Why the last read failed, in the host's vocabulary, so the banner can
          // print a translated reason instead of a bare "refresh failed".
          const [failCode, setFailCode] = React.useState('')
          // Consecutive failures. A gateway that is down is asked less and less
          // often instead of every refresh tick for the rest of the day.
          const [backoff, setBackoff] = React.useState(0)
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
              if (!clean) { setFailed(true); setFailCode('unknown'); return }
              cfgRef.current = clean.config
              setSnap(clean)
              setUpdatedAt(clean.fetchedAt || Date.now())
              setFailed(false)
              setFailCode('')
              setBackoff(0)
              persist(false, clean)
            }).catch((err) => {
              if (!aliveRef.current) return
              if (err && err.name === 'AbortError') return
              setFailed(true)
              setFailCode(err && typeof err.code === 'string' ? err.code : '')
              setBackoff((n) => Math.min(4, n + 1))
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
          // 5s → 10s → 20s → 40s → 60s while the gateway stays down, then back
          // to the configured interval as soon as a read succeeds again.
          const tickMs = failed
            ? Math.min(60000, Math.max(1000, refreshMs) * 2 ** backoff)
            : Math.max(1000, refreshMs)
          React.useEffect(() => {
            if (!auto) return undefined
            const id = setInterval(() => {
              if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
              refresh(false)
            }, tickMs)
            return () => clearInterval(id)
          }, [auto, tickMs, refresh])

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
            // The store holds the truth; the ref only catches up on the next
            // render, so two quick clicks would otherwise read one value twice.
            uiStore.set({ masked: !uiStore.get().masked })
            setTimeout(() => persist(true), 0)
          }, [persist])

          const toggleAuto = React.useCallback(() => {
            uiStore.set({ auto: !uiStore.get().auto })
            setTimeout(() => persist(true), 0)
          }, [persist])

          React.useEffect(() => () => {
            aliveRef.current = false
            if (abortRef.current) { try { abortRef.current.abort() } catch { /* noop */ } }
            persist(true)
          }, [persist])

          return { snap, updatedAt, failed, failCode, auto, toggleAuto, period, changePeriod, masked, toggleMask, manualBusy, refresh }
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
          // live is the ordinary case: the dot says it, so the pill collapses to
          // the dot. Offline, paused or busy keep the words, which are the reason
          // the reader is looking at it.
          const quiet = mode === 'live' && !compact
          return h('button', {
            type: 'button',
            className: 'mgp-statusbtn' + (compact ? ' mgp-statusbtn-compact' : '') + (quiet ? ' mgp-statusbtn-quiet' : ''),
            title: hint,
            'aria-label': hint,
            disabled: !!busy,
            onClick: onRefresh,
          }, h('span', { className: dotCls }), compact || quiet ? null : h('span', { className: 'mgp-statusbtn-label' }, label))
        }
        function rateOf(row) {
          const out = Number(row && row.out) || 0
          const ms = Number(row && row.ms) || 0
          return out > 0 && ms > 0 ? Math.round(out / (ms / 1000)) : 0
        }
        // A dot only reads as "all good, right now": once the request is older
        // than a minute it fades to the muted ink instead of glowing mint.
        function StatusChip({ row }) {
          const ok = statusOk(row && row.status)
          const when = Number(row && row.t) || 0
          const fresh = when > 0 && Date.now() - when < 90000
          const cls = ok ? 'mgp-status-ok' + (fresh ? '' : ' mgp-status-idle') : 'mgp-status-err'
          return h('span', { className: 'mgp-status ' + cls })
        }
        function badgeLetter(provName, fallback) {
          const a = String(provName || '').trim().charAt(0)
          if (a) return a.toUpperCase()
          const b = String(fallback || '').trim().charAt(0)
          return b ? b.toUpperCase() : '·'
        }
        function tintStyle(tint) { return { color: tint, background: alpha(tint, 0.16), borderColor: alpha(tint, 0.34) } }

        // Which shipped mark stands for a provider or a model, in the gateway's
        // own order of preference: the app first matches the provider's name,
        // then the lab that owns the model id.
        const PROVIDER_ICONS = [
          [/qoder/, 'qoder'], [/zcode/, 'zcode'], [/workbuddy/, 'workbuddy-color'],
          [/minimax|abab/, 'minimax-color'], [/opencode/, 'opencode'],
          [/qwenwork|qwen-work/, 'qwenwork'], [/qwenpaw/, 'qwenpaw'], [/qwen|qwq/, 'qwen-color'],
          [/deepseek/, 'deepseek-color'],
          [/claude/, 'claude-color'], [/anthropic/, 'anthropic'],
          [/kimi/, 'kimi'], [/moonshot/, 'moonshot'],
          [/chatglm/, 'chatglm-color'], [/glm|zhipu|bigmodel/, 'zhipu-color'],
          [/gemini|google/, 'gemini-color'], [/grok|xai/, 'grok'],
          [/gpt|openai|codex/, 'openai'], [/mimo/, 'mimocode'], [/doubao|seed/, 'doubao-color'],
        ]
        /** The data URI of the mark for a provider/model name, or '' when none fits. */
        function brandIconOf(name) {
          const key = String(name || '').toLowerCase()
          if (!key) return ''
          for (const [re, icon] of PROVIDER_ICONS) {
            if (re.test(key) && BRAND_ICONS[icon]) return BRAND_ICONS[icon]
          }
          return ''
        }
        // A provider chip: the app's real mark when one is shipped, otherwise
        // the tinted initial, never a made-up shape.
        function BrandBadge({ name, fallback, size }) {
          const src = brandIconOf(name || fallback)
          const s = size || 18
          if (src) {
            return h('img', {
              className: 'mgp-badge mgp-badge-img', src, alt: '', draggable: false, 'aria-hidden': true,
              style: { width: s + 'px', height: s + 'px' },
            })
          }
          return h('span', { className: 'mgp-badge', style: tintStyle(tintOf(name || fallback)) },
            badgeLetter(name, fallback))
        }
        // "12 小时后重置" — the countdown the panel prints next to each window.
        function resetIn(iso) {
          const ts = typeof iso === 'number' ? iso : Date.parse(String(iso || ''))
          if (!Number.isFinite(ts) || ts <= 0) return ''
          const diff = ts - Date.now()
          if (diff <= 0) return t('quota.reset.now')
          const hours = diff / 3600000
          if (hours < 1) return t('quota.reset.m', { n: Math.max(1, Math.round(diff / 60000)) })
          if (hours < 48) return t('quota.reset.h', { n: Math.round(hours) })
          return t('quota.reset.d', { n: Math.round(hours / 24) })
        }
        // ---- harness -> magpie -> provider, with the magpie flying the wire ----
        // The bird only moves while the panel is actually talking to the gateway
        // (auto-refresh on, gateway online, a request seen in the last half minute),
        // so an idle widget looks idle instead of decorative.
        // the arc clears the node row: a flight starts and ends above it, the way
        // the app keeps dots and birds clear of the cards they leave from
        // Wire geometry lives in the strip's own pixel space. A fixed 320-unit
        // viewBox letterboxes at the sidebar's widest setting (the line stops
        // short of the marks) and squeezes past its narrowest, so the path is
        // rebuilt from the measured width: marks at y=30, hub on the apex.
        const ROUTE_H = 30
        const ROUTE_APEX = 12
        const wirePath = (x0, x1, dy) => {
          const mid = (x0 + x1) / 2
          const dx = Math.max(28, (mid - x0) * 0.62)
          const y = ROUTE_H + dy
          const apex = ROUTE_APEX + dy
          return 'M' + x0 + ' ' + y
            + ' C' + (x0 + dx) + ' ' + y + ' ' + (mid - dx) + ' ' + apex + ' ' + mid + ' ' + apex
            + ' C' + (mid + dx) + ' ' + apex + ' ' + (x1 - dx) + ' ' + y + ' ' + x1 + ' ' + y
        }
        // The bird rides the wire but does not fly through the hub: it lifts to the
        // wire, swings around the mark (below it — the strip only leaves room
        // there), and picks the wire back up on the other side. `low` is the
        // underside of that detour, deep enough to clear the 22px hub at y 2..24.
        const flightPath = (x0, x1, dy, low, back) => {
          const mid = (x0 + x1) / 2
          const dx = Math.max(28, (mid - x0) * 0.62)
          const y = ROUTE_H + dy
          const apex = ROUTE_APEX + dy
          const near = Math.max(9, Math.min(20, (mid - x0) * 0.2))
          const pts = [
            [x0, y],
            [x0 + dx, y], [mid - near - 12, apex + 2], [mid - near, apex + 9],
            [mid - near + 7, low], [mid + near - 7, low], [mid + near, apex + 9],
            [mid + near + 12, apex + 2], [x1 - dx, y], [x1, y],
          ]
          // the answer flies the same curve the other way: reverse the segments
          // (start at the far mark, end at the near one) instead of mirroring them
          if (back) pts.reverse()
          return 'M' + pts[0][0] + ' ' + pts[0][1]
            + ' C' + pts[1][0] + ' ' + pts[1][1]
            + ' ' + pts[2][0] + ' ' + pts[2][1]
            + ' ' + pts[3][0] + ' ' + pts[3][1]
            + ' C' + pts[4][0] + ' ' + pts[4][1]
            + ' ' + pts[5][0] + ' ' + pts[5][1]
            + ' ' + pts[6][0] + ' ' + pts[6][1]
            + ' C' + pts[7][0] + ' ' + pts[7][1]
            + ' ' + pts[8][0] + ' ' + pts[8][1]
            + ' ' + pts[9][0] + ' ' + pts[9][1]
        }
        // The two marks do not sit at a fixed inset: each label can be wide, and
        // the mark is centred under its own label, so "26px from the edge" drifts
        // right past the icon on a long provider name. Measure the two marks and
        // draw the wire between their centres instead of guessing.
        function useMarkEdges(boxRef, leftRef, rightRef) {
          const [edges, setEdges] = React.useState({ left: 0, right: 0 })
          React.useEffect(() => {
            const box = boxRef.current
            if (!box || typeof box.getBoundingClientRect !== 'function') return undefined
            let last = ''
            const read = () => {
              const lb = leftRef.current
              const rb = rightRef.current
              if (!lb || !rb) return
              const bb = box.getBoundingClientRect()
              const lc = lb.getBoundingClientRect()
              const rc = rb.getBoundingClientRect()
              if (!bb || !lc || !rc || !bb.width) return
              const left = Math.round(lc.left + lc.width / 2 - bb.left)
              const right = Math.round(rc.left + rc.width / 2 - bb.left)
              const key = left + ':' + right
              if (key === last) return
              last = key
              setEdges({ left: left, right: right })
            }
            read()
            if (typeof ResizeObserver !== 'function') return undefined
            const ro = new ResizeObserver(read)
            ro.observe(box)
            if (leftRef.current) ro.observe(leftRef.current)
            if (rightRef.current) ro.observe(rightRef.current)
            return () => ro.disconnect()
          }, [boxRef, leftRef, rightRef])
          return edges
        }
        function RouteFlight({ latest, online, auto }) {          const provName = latest ? String(latest.providerName || latest.provider || '') : ''
          const lastT = latest ? msOf(latest.t) : 0
          // the wire is alive whenever the widget is polling a reachable gateway;
          // a request seen in the last half minute makes the birds fly faster
          const recent = lastT > 0 && (Date.now() - lastT) < 30000
          // they fly while requests are going through, not merely because the
          // widget is polling: an idle gateway parks them (the strip says so)
          const live = Boolean(auto) && online !== false && recent
          const dur = recent ? '2.2s' : '4.6s'
          const boxRef = React.useRef(null)
          const leftRef = React.useRef(null)
          const rightRef = React.useRef(null)
          const stripW = useBoxWidth(boxRef, 320)
          const marks = useMarkEdges(boxRef, leftRef, rightRef)
          // the two marks carry the ends of the line; before they are measured fall
          // back to the padding inset, and never let the line run past a mark
          const x0 = marks.left > 0 ? marks.left : 26
          const markRight = marks.right > x0 + 40 ? marks.right : stripW - 26
          const x1 = Math.max(x0 + 40, markRight)
          const away = flightPath(x0, x1, 0, 31, false)
          // the answer comes back on its own lane, low enough that the two never
          // merge into one bird where they pass — and heading the other way
          const home = flightPath(x0, x1, 4, 40, true)
          // the wire itself keeps running straight through the hub
          const wire = wirePath(x0, x1, 0)
          // The bird is the app's own drawing, not its app icon: routing draws a
          // magpie to fly (assets/plugins/routing/client.js, FLIER) out of a body,
          // a tail, a belly and a near and a far wing that beat from the shoulder,
          // and the packet it carries sits at the tip of its beak. Copied here
          // with the same proportions, so the wings move as the app's do
          // (@keyframes mgp-flap: down hard, up easy), while animateMotion walks
          // it down the wire. The answer comes back mirrored, ringed rather than
          // filled, the way a reply is drawn.
          const part = (cls, tag, attrs) => h(tag, Object.assign({ className: cls }, attrs))
          const FLIER = (k, back) => h('g', { className: 'mgp-lift' },
            h('g', { transform: 'scale(' + k + ') scale(' + (back ? -1 : 1) + ' 1) translate(-6.5 3.2)' },
              part('wing far', 'path', { d: 'M-14.5 -3.4C-16.5 -9.5 -14.2 -15 -8.6 -18.6C-9.4 -12.6 -9.6 -7.4 -9.2 -3.2Z' }),
              part('tail', 'path', { d: 'M-31.5 3.1L-18.6 -1.8L-17.4 1.2L-30.8 4.6Z' }),
              part('body', 'ellipse', { cx: '-12.2', cy: '-1.4', rx: '7.6', ry: '3.9' }),
              part('belly', 'ellipse', { cx: '-12.8', cy: '0.4', rx: '4.3', ry: '1.6' }),
              part('body', 'circle', { cx: '-4.9', cy: '-3.7', r: '3.1' }),
              part('body', 'path', { d: 'M-2.3 -4.8L1.4 -3.3L-2.3 -2.2Z' }),
              h('g', { className: 'wing near' },
                part('', 'path', { d: 'M-15.6 -3.2C-17.8 -10.2 -15.2 -16.4 -8.4 -20.4C-9.3 -13.6 -9.4 -7.8 -8.8 -2.8Z' }),
                part('bar', 'path', { d: 'M-14.6 -5.6C-15.4 -10.4 -13.8 -14.4 -10.4 -17.2' }),
              ),
              h('circle', { className: 'mgp-fly-dot' + (back ? ' back' : ''), cx: '1.4', cy: '-3.3', r: back ? '2.1' : '2.3' }),
            ),
          )
          const bird = (cls, dur, back) => h('g', { className: 'mgp-fly mgp-flier ' + cls },
            FLIER(0.5, back),
            h('animateMotion', { dur: dur, repeatCount: 'indefinite', path: back ? home : away }),
          )
          return h('div', {
            className: 'mgp-route',
            ref: boxRef,
            'data-live': live ? '1' : '0',
            title: t('route.hint'),
          },
            h('svg', {
              className: 'mgp-route-wire',
              viewBox: '0 0 ' + stripW + ' 58',
              preserveAspectRatio: 'none',
              'aria-hidden': true,
            },
              h('path', { className: 'mgp-wire', d: wire }),
              live ? bird('mgp-fly-a', dur, false) : null,
              live ? bird('mgp-fly-b', dur, true) : null,
            ),
            h('div', { className: 'mgp-route-nodes' },
              h('span', { className: 'mgp-node', 'data-edge': 'left', ref: leftRef, title: 'DeepSeek Harness' },
                // the harness's own app icon, lifted from resources/icon.png and
                // embedded like the rest: DSH is DeepSeek Harness, so the node
                // wears its mark rather than a bare ring
                h('img', { className: 'mgp-node-ic', src: BRAND_ICONS.dsh, alt: '' }),
                h('span', { className: 'mgp-node-name' }, t('route.dsh')),
              ),
              h('span', { className: 'mgp-node', 'data-edge': 'right', ref: rightRef, title: provName || '' },
                h(BrandBadge, { name: provName, fallback: latest ? servedOf(latest) : '' }),
                h('span', { className: 'mgp-node-name' }, provName || '—'),
              ),
            ),
            // the hub rides the apex between the two lanes, so the bird passes
            // through the mark rather than alongside it
            h('span', { className: 'mgp-node mgp-node-mid', title: 'magpie' },
              h('span', { className: 'mgp-node-hub' }, h(MagpieIcon, { size: 14, active: online })),
            ),
          )
        }

        // ---- one request, printed the way the gateway panel prints it ----
        // time · session dot · route › provider badge · served model
        // second line: duration · TTFT · tokens · cache · rate · cost
        function ReqLine({ row, masked, symbol, showTime, hideTime, hideRate, meta: showMeta }) {
          if (!row) return null
          const served = servedOf(row)
          const req = row.req || row.model || ''
          const provName = String(row.providerName || row.provider || '')
          const rate = rateOf(row)
          const cache = cachePctOf(row)
          const acct = row.providerAccount || ''
          const meta = [
            Number(row.ms) > 0 ? t('req.dur') + ' ' + fmtMs(row.ms) : '',
            Number(row.ttftMs) > 0 ? t('req.ttft') + ' ' + fmtMs(row.ttftMs) : '',
            fmtCompact(Number(row.in) || 0) + '→' + fmtCompact(Number(row.out) || 0) + ' ' + t('req.tok'),
            cache !== null ? t('req.cache') + ' ' + cache + '%' : '',
            rate > 0 && !hideRate ? fmtInt(rate) + ' ' + t('metrics.tps') : '',
            row.priced && Number(row.cost) > 0 ? (symbol || '$') + Number(row.cost).toFixed(3) : '',
            acct ? (masked ? maskAccount(acct) : shortAccount(acct)) : '',
          ].filter(Boolean)
          return h('div', { className: 'mgp-req', title: req + ' → ' + (served || '—') },
            h('div', { className: 'mgp-req-top' },
              showTime && !hideTime ? h('span', { className: 'mgp-rtime' }, fmtTime(row.t)) : null,
              h('span', { className: 'mgp-sdot' }),
              h('span', { className: 'mgp-reqname' }, req || '—'),
              h('span', { className: 'mgp-flow' }, '›'),
              h(BrandBadge, { name: provName, fallback: served || req }),
              h('span', { className: 'mgp-served' }, served || '—'),
              h(StatusChip, { row }),
            ),
            showMeta !== false && meta.length ? h('div', { className: 'mgp-req-meta' }, meta.map((m, i) => h('span', { key: i }, m))) : null,
          )
        }
        // One session is many requests; this folds them into the same shape so
        // the "by session" view reuses the request row.
        function groupSessions(rows) {
          const map = new Map()
          const out = []
          for (const r of rows) {
            const key = r.session || (r.req || '') + '|' + (r.agent || '')
            let s = map.get(key)
            if (!s) {
              s = { key, last: r, calls: 0, tin: 0, tout: 0, tcache: 0, cost: 0, tps: 0, tpsN: 0 }
              map.set(key, s)
              out.push(s)
            }
            s.calls++
            s.tin += Number(r.in) || 0
            s.tout += Number(r.out) || 0
            s.tcache += Number(r.cacheRead) || 0
            s.cost += Number(r.cost) || 0
            const tps = rateOf(r)
            if (tps > 0) { s.tps += tps; s.tpsN++ }
            if (Number(r.t) > Number(s.last.t)) s.last = r
          }
          return out.sort((a, b) => Number(b.last.t) - Number(a.last.t))
        }
        function SessLine({ s, masked, symbol, meta: showMeta }) {
          const last = s.last || {}
          const provName = String(last.providerName || last.provider || '')
          const billed = s.tin + s.tout + s.tcache
          const cache = billed > 0 ? Math.round((s.tcache / billed) * 100) : null
          const tps = s.tpsN > 0 ? Math.round(s.tps / s.tpsN) : 0
          const sid = String(s.key || '')
          const short = sid.length > 16 ? sid.slice(0, 16) + '…' : sid
          const served = servedOf(last)
          const meta = [
            fmtInt(s.calls) + ' ' + t('sess.calls'),
            fmtCompact(s.tin + s.tout) + ' ' + t('req.tok'),
            cache !== null ? t('req.cache') + ' ' + cache + '%' : '',
            tps > 0 ? fmtInt(tps) + ' ' + t('metrics.tps') : '',
            s.cost > 0 ? (masked ? '••••' : (symbol || '$') + s.cost.toFixed(3)) : '',
          ].filter(Boolean)
          return h('div', { className: 'mgp-req', title: sid },
            h('div', { className: 'mgp-req-top' },
              h('span', { className: 'mgp-rtime' }, fmtTime(last.t)),
              h('span', { className: 'mgp-sdot' }),
              h('span', { className: 'mgp-reqname' }, short || '—'),
              h('span', { className: 'mgp-flow' }, '›'),
              h(BrandBadge, { name: provName, fallback: served }),
              h('span', { className: 'mgp-served' }, servedOf(last) || '—'),
            ),
            showMeta !== false && meta.length ? h('div', { className: 'mgp-req-meta' }, meta.map((m, i) => h('span', { key: i }, m))) : null,
          )
        }

        function Spark({ points }) {
          if (!points || points.length < 2) return null
          const w = 44, ht = 12
          const xs = points.map((p, i) => (i / (points.length - 1)) * w)
          const ys = points.map((p) => ht - (Math.max(0, Math.min(100, Number(p.left) || 0)) / 100) * ht)
          const d = xs.map((x, i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ')
          return h('svg', { className: 'mgp-spark', width: w, height: ht, viewBox: '0 0 ' + w + ' ' + ht, 'aria-hidden': true },
            h('path', { d, fill: 'none', stroke: 'var(--mgp-accent, #a5b4fb)', strokeWidth: 1.2, strokeLinejoin: 'round', strokeLinecap: 'round' }))
        }
        // A quota row: badge · provider · window — remaining % on the right,
        // a 3px track under it, then the raw numbers and the reset countdown.
        function QuotaBar({ q, w, spark, masked }) {
          const used = Math.max(0, Math.min(100, Number(w.used) || 0))
          const left = Math.max(0, 100 - used)
          // one hue for every bar; a thin share is said with brighter type, not
          // with a different colour
          const level = usageLevel(used)
          const pctCls = level === 'high' ? ' mgp-qpct-low' : ''
          const acct = q.alias || q.user || ''
          const name = String(q.name || q.provider || '')
          const meta = [
            w.display || '',
            resetIn(w.resetsAt || q.until),
            w.runsOutAt ? t('quota.expires') + ' ' + fmtClock(w.runsOutAt) : '',
            acct ? (masked ? maskAccount(acct) : shortAccount(acct)) : '',
          ].filter(Boolean)
          const title = [
            name + ' · ' + w.name,
            t('quota.account') + ': ' + (acct ? (masked ? maskAccount(acct) : shortAccount(acct)) : '—'),
            q.plan ? t('quota.plan') + ': ' + q.plan : '',
            w.display || '',
            (w.resetsAt || q.until) ? t('quota.resets') + ': ' + fmtClock(w.resetsAt || q.until) : '',
            w.runsOutAt ? t('quota.expires') + ': ' + fmtClock(w.runsOutAt) : '',
          ].filter(Boolean).join(' · ')
          // The bar measures what is LEFT, matching the percentage printed on the
          // right: a brand new window draws full, an exhausted one draws empty.
          // (Drawn from `used` it read as "0% left" on an untouched quota.)
          return h('div', { className: 'mgp-qbar', title, role: 'progressbar', 'aria-valuenow': Math.round(left), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': name + ' · ' + w.name + ' · ' + t('quota.left') + ' ' + left.toFixed(0) + '%' },
            h(BrandBadge, { name: q.provider || name, fallback: name }),
            h('span', { className: 'mgp-qname' }, name, ' ', h('span', { className: 'mgp-qwin' }, w.name)),
            h('span', { className: 'mgp-qpct' + pctCls }, t('quota.left') + ' ' + left.toFixed(0) + '%'),
            h('div', { className: 'mgp-track' }, h('div', { className: 'mgp-fill', style: { width: left + '%' } })),
            meta.length ? h('div', { className: 'mgp-qmeta' }, meta.map((m, i) => h('span', { key: i }, m))) : null,
            spark ? h(Spark, { points: spark }) : null,
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
          // Urgent windows first: the one closest to running out wins.
          out.sort((a, b) => (Number(b.w.used) || 0) - (Number(a.w.used) || 0))
          return out.slice(0, limit)
        }
        function MiniChart({ series, masked, symbol }) {
          if (!series || !series.length) return null
          const max = Math.max(1, ...series.map((b) => Number(b.calls) || 0))
          return h('div', { className: 'mgp-chart', role: 'img', 'aria-label': t('chart.label') },
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
        // Per-model throughput the gateway measured itself. /usage has no such
        // field, so this only appears when the requests endpoint reported it.
        function SpeedLine({ sp, masked, symbol }) {
          const tps = Number(sp.tps) || 0
          const cost = (symbol || '$') + Number(sp.cost || 0).toFixed(2)
          return h('div', { className: 'mgp-mline mgp-speed' },
            h('span', { className: 'mgp-served', style: { flex: '1 1 auto' } }, sp.name || sp.model || '—'),
            h('span', { className: 'mgp-muted', style: { fontSize: '12px', whiteSpace: 'nowrap' } },
              fmtInt(sp.requests) + ' ' + t('usage.calls')),
            h('span', { className: 'mgp-num', style: { marginLeft: '6px' } },
              tps > 0 ? fmtInt(tps) + ' ' + t('metrics.tps') : '—'),
            h('span', { className: 'mgp-num', style: { marginLeft: '6px' } }, masked ? '••••' : cost),
          )
        }
        // How the traffic reached the gateway: proxied, direct or reported.
        function ChannelRow({ label, c }) {
          if (!c) return null
          const share = Number(c.calls) || 0
          return h('div', { className: 'mgp-mline mgp-channel' },
            h('span', { className: 'mgp-served', style: { flex: '1 1 auto' } }, label),
            h('span', { className: 'mgp-muted', style: { fontSize: '12px', whiteSpace: 'nowrap' } },
              fmtInt(share) + ' ' + t('usage.calls')),
            h('span', { className: 'mgp-num', style: { marginLeft: '6px' } }, fmtInt(c.errors)),
          )
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
          // The request/session switch lives in the footer: this component stays
          // hook-free so it can also render as plain markup (preview, tests).
          const groupBy = props.groupBy || 'req'
          const setGroupBy = props.onGroupChange || (() => {})
          const usage = snap && snap.usage
          const health = snap && snap.health
          const currency = (snap && snap.currency) || { symbol: '$' }
          const symbol = currency.symbol || '$'
          const online = health && health.name === 'magpie' && !props.failed
          const cash = (v) => (masked ? '••••' : symbol + Number(v || 0).toFixed(2))
          const effDensity = style === 'compact' ? 'tight' : density
          const limits = ROW_LIMITS[effDensity] || ROW_LIMITS.normal
          const quotas = collectQuotas(snap && snap.quotas, snap && snap.history, expanded ? limits.moreQuota : limits.quota)
          const allQuotas = collectQuotas(snap && snap.quotas, snap && snap.history, 99)
          const requests = (snap && snap.requests) || []
          const models = (snap && snap.models) || []
          const speeds = (snap && snap.speeds) || []
          const channels = (snap && snap.channels) || {}
          const series = (snap && snap.series) || []
          const latest = requests[0]
          // The panel follows the host's configured period until the user picks
          // a tab, so the label must not claim 'today' while the data is 7d.
          const periodValue = props.period || (snap && snap.config && snap.config.period) || 'today'
          const periodLabel = t('period.' + periodValue)

          // minimal: a single summary line
          if (style === 'minimal') {
            const top = quotas[0]
            const topLeft = top ? Math.max(0, 100 - (Number(top.w.used) || 0)).toFixed(0) : ''
            return h('div', { className: 'mgp-footstack', 'data-style': 'minimal', 'data-density': density },
              h('style', null, css),
              h('div', { className: 'mgp-minimal' },
                h('span', { className: 'mgp-flogo' }, h(MagpieIcon, { size: 13, active: online })),
                show.usage && usage ? h('span', { className: 'mgp-min-num' }, periodLabel) : null,
                show.usage && usage ? h('span', { className: 'mgp-min-num', style: { fontWeight: 600, color: 'var(--mgp-ink)' } }, fmtCompact(usage.calls) + ' ' + t('usage.calls')) : null,
                show.usage && usage ? h('span', { className: 'mgp-min-cost' }, cash(usage.cost)) : null,
                show.quotas && top ? h('span', { className: 'mgp-min-quota', title: top.q.name + ' · ' + top.w.name }, (top.q.name || '') + ' ' + topLeft + '%') : null,
                h(StatusButton, { online, auto, busy: props.manualBusy, compact: true, onRefresh: props.onRefresh }),
              ))
          }

          const showUsageSection = (show.usage || show.metrics || show.chart) && usage
          const showExpand = show.requests || show.models || show.quotas || show.speeds || show.channels
          const dataStyle = style === 'compact' ? 'compact' : undefined
          const sessions = groupSessions(requests)

          return h('div', { className: 'mgp-footstack', 'data-density': density, 'data-style': dataStyle },
            h('style', null, css),
            // header: the name, the mask, and the state only when it is not
            // simply live — a running gateway needs no pill saying so
            h('div', { className: 'mgp-fhead' },
              h('div', { className: 'mgp-ftitle', title: t('widget.title') + ' v' + VERSION + ' · ' + periodLabel },
                h('span', { className: 'mgp-fname' }, t('widget.title')),
              ),
              h('button', { type: 'button', className: 'mgp-fbtn', title: t('btn.mask'), 'aria-pressed': masked, onClick: props.onToggleMask, 'aria-label': t('btn.mask') }, '◐'),
              h(StatusButton, { online, auto, busy: props.manualBusy, onRefresh: props.onRefresh }),
            ),
            show.flight ? h(RouteFlight, { latest, online, auto }) : null,
            // failure banners
            props.failed && !snap ? h('div', { className: 'mgp-banner' },
              h('span', { className: 'mgp-banner-text' }, t('banner.first')),
              props.failCode ? h('span', { className: 'mgp-muted' }, errHint(t, props.failCode)) : null,
              h('button', { type: 'button', className: 'mgp-retry', onClick: props.onRefresh }, t('retry')),
            ) : null,
            props.failed && snap ? h('div', { className: 'mgp-stale' },
              t('stale', { time: fmtRelative(props.updatedAt, t) }),
              props.failCode ? h('span', { className: 'mgp-muted' }, ' · ' + errHint(t, props.failCode)) : null,
            ) : null,
            snap && snap.problems && snap.problems.length ? h('div', { className: 'mgp-problems' },
              t('problems') + ': ' + snap.problems.map((p) => {
                const why = errHint(t, p.code, p.message)
                return p.what ? t('problems.item', { what: p.what, why }) : why
              }).join('; ')) : null,
            // latest request, in the panel's own row layout
            show.route ? h('div', { className: 'mgp-latest' },
              h('div', { className: 'mgp-latest-top' },
                h('div', { className: 'mgp-latest-head' },
                  h('span', { className: 'mgp-latest-label' }, t('latest')),
                  latest ? h('span', { className: 'mgp-rtime' }, fmtTime(latest.t)) : null,
                ),
                latest ? h('span', {
                  className: 'mgp-latest-meta',
                  title: t('latest.rate') + ' ' + (rateOf(latest) > 0 ? fmtInt(rateOf(latest)) + ' ' + t('metrics.tps') : '—'),
                },
                  h('span', { className: 'mgp-latest-metatext' },
                    [
                      String(latest.providerName || latest.provider || '').trim(),
                      rateOf(latest) > 0 ? fmtInt(rateOf(latest)) + ' ' + t('metrics.tps') : '',
                    ].filter(Boolean).join(' · '),
                  ),
                ) : null,
              ),
              latest ? h(ReqLine, { row: latest, masked, symbol, hideTime: true, hideRate: true, meta: show.reqmeta }) : h('div', { className: 'mgp-empty' }, t('latest.none')),
            ) : null,
            // usage section
            showUsageSection ? h('div', { className: 'mgp-usage', style: { display: 'flex', flexDirection: 'column', gap: 'var(--mgp-gap,7px)' } },
              show.usage && show.tabs ? h(PeriodTabs, { value: periodValue, onChange: props.onChangePeriod }) : null,
              show.usage && show.cells ? h('div', { className: 'mgp-today' },
                h('div', { className: 'mgp-tcell' }, h('span', { className: 'mgp-tval' }, fmtCompact(usage.calls)), h('span', { className: 'mgp-tlab' }, t('usage.calls'))),
                h('div', { className: 'mgp-tcell' }, h('span', { className: 'mgp-tval' }, fmtCompact((Number(usage.input) || 0) + (Number(usage.output) || 0))), h('span', { className: 'mgp-tlab' }, t('usage.tokens.compact'))),
                h('div', { className: 'mgp-tcell' }, h('span', { className: 'mgp-tval' }, cash(usage.cost)), h('span', { className: 'mgp-tlab' }, t('usage.cost'))),
              ) : null,
              show.metrics ? h('div', { className: 'mgp-metrics' },
                h('span', { className: (Number(usage.errors) || 0) > 0 ? 'mgp-warn' : '' }, t('metrics.errors') + ' ' + fmtInt(usage.errors)),
                h('span', null, t('metrics.ttft') + ' ' + fmtMs(usage.avgTtftMs)),
                h('span', null, fmtInt(usage.avgTokensPerSecond) + ' ' + t('metrics.tps')),
                h('span', { className: 'mgp-mint' }, t('metrics.cache') + ' ' + (Number(usage.cacheHitPct) || 0).toFixed(0) + '%'),
              ) : null,
              show.chart ? h(MiniChart, { series, masked, symbol }) : null,
            ) : null,
            // quota rows: section head, then one row per window
            show.quotas ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--mgp-gap,7px)' } },
              h('div', { className: 'mgp-sec' },
                h('span', { className: 'mgp-sec-t' }, t('quota.title')),
                h('span', { className: 'mgp-sec-l' }),
                h('span', { className: 'mgp-sec-n' }, quotas.length + '/' + allQuotas.length),
              ),
              h('div', { className: 'mgp-qwrap' },
                quotas.length ? quotas.map((item, i) => h(QuotaBar, { key: i, q: item.q, w: item.w, spark: show.spark ? item.spark : null, masked })) : h('div', { className: 'mgp-empty' }, t('quota.none')),
              ),
            ) : null,
            // expand / details
            showExpand ? h('button', { type: 'button', className: 'mgp-expand', onClick: props.onToggleExpand, 'aria-expanded': expanded }, expanded ? '▴ ' + t('expand.less') : '▾ ' + t('expand.more')) : null,
            showExpand && expanded ? h('div', { className: 'mgp-detail' },
              show.requests ? h('div', null,
                h('div', { className: 'mgp-dhead' },
                  h('span', { className: 'mgp-dhead-t' }, t('detail.recent')),
                  h('div', { className: 'mgp-seg', role: 'tablist' },
                    h('button', { type: 'button', role: 'tab', 'aria-selected': groupBy === 'req', className: 'mgp-segbtn' + (groupBy === 'req' ? ' mgp-segbtn-on' : ''), onClick: () => setGroupBy('req') }, t('seg.requests')),
                    h('button', { type: 'button', role: 'tab', 'aria-selected': groupBy === 'session', className: 'mgp-segbtn' + (groupBy === 'session' ? ' mgp-segbtn-on' : ''), onClick: () => setGroupBy('session') }, t('seg.sessions')),
                  ),
                ),
                h('div', { className: 'mgp-recent' },
                  groupBy === 'session'
                    ? (sessions.length
                      ? sessions.slice(0, limits.more).map((s, i) => h(SessLine, { key: i, s, masked, symbol, meta: show.reqmeta }))
                      : h('div', { className: 'mgp-empty' }, t('empty.recent')))
                    : (requests.length
                      ? requests.slice(0, limits.more).map((r, i) => h(ReqLine, { key: i, row: r, masked, symbol, showTime: true, meta: show.reqmeta }))
                      : h('div', { className: 'mgp-empty' }, t('empty.recent'))),
                )) : null,
              show.models ? h('div', null,
                h('div', { className: 'mgp-dhead' }, h('span', { className: 'mgp-dhead-t' }, t('detail.models'))),
                models.length ? models.slice(0, limits.more).map((m, i) => h(ModelLine, { key: i, m, masked, symbol })) : h('div', { className: 'mgp-empty' }, t('empty.models')),
              ) : null,
              show.speeds ? h('div', null,
                h('div', { className: 'mgp-dhead' }, h('span', { className: 'mgp-dhead-t' }, t('speeds.title'))),
                speeds.length ? speeds.map((sp, i) => h(SpeedLine, { key: i, sp, masked, symbol })) : h('div', { className: 'mgp-empty' }, t('speeds.none')),
              ) : null,
              show.channels && (channels.through || channels.direct || channels.reported) ? h('div', null,
                h('div', { className: 'mgp-dhead' }, h('span', { className: 'mgp-dhead-t' }, t('channels.title'))),
                h('div', { className: 'mgp-recent' },
                  h(ChannelRow, { label: t('channels.through'), c: channels.through }),
                  h(ChannelRow, { label: t('channels.direct'), c: channels.direct }),
                  h(ChannelRow, { label: t('channels.reported'), c: channels.reported }),
                ),
              ) : null,
              // Only worth a second list when the summary above is hiding windows.
              show.quotas && allQuotas.length > quotas.length ? h('div', null,
                h('div', { className: 'mgp-dhead' }, h('span', { className: 'mgp-dhead-t' }, t('detail.quota'))),
                h('div', { className: 'mgp-qwrap' },
                  allQuotas.map((item, i) => h(QuotaBar, { key: i, q: item.q, w: item.w, spark: show.spark ? item.spark : null, masked })),
                )) : null,
            ) : null,
            // updated
          )
        }
        // ---- rail popup ----
        // Clicking the collapsed rail icon opens this small card. It renders
        // into document.body through a portal so the sidebar's overflow does
        // not clip it, and it closes on Escape or an outside click.
        function RailPopup({ snap, masked, online, onClose }) {
          const ref = React.useRef(null)
          const target = usePortalTarget()
          useDismissOnOutside(ref, onClose, true)
          const usage = snap && snap.usage
          const health = snap && snap.health
          const symbol = (snap && snap.currency && snap.currency.symbol) || '$'
          const cash = (value) => (masked ? '••••' : symbol + Number(value || 0).toFixed(2))
          const periodLabel = t('period.' + ((snap && snap.config && snap.config.period) || 'today'))
          const rows = [
            [t('usage.calls'), usage ? fmtInt(usage.calls) : '—'],
            [t('usage.tokens'), usage ? fmtCompact((Number(usage.input) || 0) + (Number(usage.output) || 0)) : '—'],
            [t('usage.cost'), usage ? cash(usage.cost) : '—'],
            [t('metrics.ttft'), usage && usage.avgTtftMs ? fmtMs(usage.avgTtftMs) : '—'],
            [t('metrics.tps'), usage && usage.avgTokensPerSecond ? fmtInt(usage.avgTokensPerSecond) + ' tok/s' : '—'],
            [t('metrics.cache'), usage ? (Number(usage.cacheHitPct) || 0).toFixed(0) + '%' : '—'],
          ]
          const card = h('div', { className: 'mgp-railpopup', role: 'dialog', 'aria-label': t('rail.open') },
            h('div', { className: 'mgp-railpopup-head' },
              h('span', { className: 'mgp-flogo' }, h(MagpieIcon, { size: 13, active: online })),
              h('span', { className: 'mgp-railpopup-title' }, 'Magpie'),
              h('span', { className: 'mgp-railpopup-sub' }, periodLabel + (health && health.version ? ' · v' + health.version : '')),
              h('button', {
                type: 'button', className: 'mgp-railpopup-close', 'aria-label': t('rail.close'),
                onClick: (event) => { event.stopPropagation(); onClose() },
              }, '×'),
            ),
            h('div', { className: 'mgp-railpopup-rows' },
              rows.map(([label, value]) => h('div', { className: 'mgp-railpopup-row', key: label },
                h('span', { className: 'mgp-railpopup-label' }, label),
                h('span', { className: 'mgp-railpopup-value' }, value)))),
            snap && snap.quotas && snap.quotas.length
              ? h('div', { className: 'mgp-railpopup-quota' },
                h('div', { className: 'mgp-sec' },
                  h('span', { className: 'mgp-sec-t' }, t('quota.title')),
                  h('span', { className: 'mgp-sec-l' }),
                ),
                collectQuotas(snap.quotas, snap.history, 3).map((item, i) => h(QuotaBar, {
                  key: i, q: item.q, w: item.w, spark: false, masked,
                })))
              : null,
          )
          if (ReactDOM && ReactDOM.createPortal && target) {
            return ReactDOM.createPortal(card, target)
          }
          return card
        }
        // ---- footer widget ----
        function MagpieFooter(props) {
          useLocaleTick()
          const wide = props && props.wide
          const mon = useMonitor()
          const density = useDensity()
          const ui = useUi()
          const [expanded, setExpanded] = React.useState(false)
          const [railOpen, setRailOpen] = React.useState(false)
          const [groupBy, setGroupBy] = React.useState('req')
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
              h('div', {
                className: 'mgp-railwrap',
                title: tip,
                role: 'button',
                tabIndex: 0,
                'aria-label': t('rail.open'),
                onClick: () => setRailOpen((x) => !x),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setRailOpen((x) => !x) }
                },
              },
                h(MagpieIcon, { size: 20, active: online }),
                h('span', { className: 'mgp-raildot ' + (online ? 'mgp-dot-on' : 'mgp-dot-off') }),
              ),
              // Rendered as an element, never called: the popup owns hooks, and
              // calling it inline would attach them to this component's hook list
              // only while it is open — React then throws as it closes.
              railOpen ? h(RailPopup, {
                snap: mon.snap, masked: mon.masked, online, onClose: () => setRailOpen(false),
              }) : null,
            )
          }

          return h(MagpieBody, {
            snap: mon.snap, updatedAt: mon.updatedAt, failed: mon.failed, failCode: mon.failCode, auto: mon.auto,
            period: mon.period || (mon.snap && mon.snap.config && mon.snap.config.period) || 'today',
            masked: mon.masked, manualBusy: mon.manualBusy, density, display, expanded,
            groupBy, onGroupChange: setGroupBy,
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
            { route_id: 'r1', t: Date.now(), req: 'group/never-stuck', served: 'glm-5.3', model: 'glm-5.3', provider: 'qoder', providerName: 'Qoder', providerAccount: '134****3762', session: 's1', in: 12000, out: 3000, cacheRead: 9000, ms: 4200, ttftMs: 800, status: 200, cost: 0.05, priced: true },
            { route_id: 'r2', t: Date.now(), req: 'claude-opus', served: 'glm-5.3', model: 'claude-opus', provider: 'qoder', providerName: 'Qoder', providerAccount: '134****3762', session: 's2', in: 8000, out: 2000, cacheRead: 4000, ms: 3100, ttftMs: 600, status: 200, cost: 0.03, priced: true },
            { route_id: 'r3', t: Date.now(), req: 'gpt-5', served: 'gpt-5', model: 'gpt-5', provider: 'zcode', providerName: 'ZCode', providerAccount: '134****0000', session: 's3', in: 5000, out: 1500, cacheRead: 2000, ms: 2600, ttftMs: 500, status: 500, cost: 0, priced: false },
          ],
          speeds: [
            { model: 'glm-5.3', name: 'glm-5.3', requests: 400, tps: 83, tpsN: 71, ttftMs: 800, cost: 1.4 },
            { model: 'claude-opus', name: 'claude-opus', requests: 200, tps: 64, tpsN: 58, ttftMs: 600, cost: 0.9 },
          ],
          channels: {
            through: { calls: 640, errors: 1, cost: 1.8 },
            direct: { calls: 223, errors: 1, cost: 0.7 },
            reported: { calls: 0, errors: 0, cost: 0 },
          },
          problems: [],
        })

        function MagpieSettings() {
          useLocaleTick()
          const ui = useUi()
          const { state: cfgState, setField } = useConfigForm()
          const [previewExpanded, setPreviewExpanded] = React.useState(false)
          const [savedFlash, setSavedFlash] = React.useState(false)
          const [perm, setPerm] = React.useState(() => notifyPermission())
          const [soundOk, setSoundOk] = React.useState(null)
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
          const alertSeconds = cfg ? sanitizeAlertSeconds(cfg.turnDoneAlert) : 0
          const alertTone = cfg && typeof cfg.alertTone === 'string' ? cfg.alertTone : 'alarm'

          return h('div', { className: 'mgp-set' },
            h('style', null, css),
            h('div', { className: 'mgp-set-head' },
              h(MagpieIcon, { size: 30, active: true }),
              h('div', { className: 'mgp-set-headtext' },
                h('div', { className: 'mgp-set-title' }, t('settings.title')),
                h('div', { className: 'mgp-set-sub' }, t('settings.subtitle') + ' · v' + VERSION))),
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
                // numbers inside the panel — the usage block owns its own numbers
                h('div', { className: 'mgp-set-card' },
                  h('div', { className: 'mgp-set-cardtitle' }, t('settings.details')),
                  h('div', { className: 'mgp-toggle-list' },
                    h(ToggleRow, {
                      key: 'usage', label: t('settings.content.usage'), desc: t('settings.content.usage.desc'),
                      checked: ui.show.usage !== false, onChange: (v) => setShow('usage', v),
                    }),
                    h('div', { className: 'mgp-toggle-subwrap' },
                      USAGE_CHILDREN.map((k) => h(ToggleRow, {
                        key: k, label: t('settings.details.' + k), desc: t('settings.details.' + k + '.desc'),
                        checked: ui.show[k] !== false, disabled: ui.show.usage === false,
                        onChange: (v) => setShow(k, v),
                      }))),
                    ['metrics', 'chart', 'reqmeta'].map((k) => h(ToggleRow, {
                      key: k, label: t('settings.details.' + k), desc: t('settings.details.' + k + '.desc'),
                      checked: ui.show[k] !== false, onChange: (v) => setShow(k, v),
                    })))),
                // host config
                h('div', { className: 'mgp-set-card' },
                  h('div', { className: 'mgp-set-cardtitle' }, t('settings.data')),
                  cfgState.status !== 'ready' ? h('div', { className: 'mgp-note' }, t('settings.data.unavailable')) : null,
                  cfg ? h('div', { className: 'mgp-field-grid' },
                    h(Field, { label: t('settings.data.gateway'), hint: t('settings.data.gateway.hint') },
                      h(ConfigInput, { value: draftVal('gatewayUrl'), disabled: !writable, onChange: editDraft('gatewayUrl'), onBlur: () => commitText('gatewayUrl'), onEnter: () => commitText('gatewayUrl') })),
                    h(Field, { label: t('settings.data.discover'), hint: t('settings.data.discover.desc') },
                      h('div', { className: 'mgp-field-inline' },
                        h(Switch, { checked: cfg.discover !== false, disabled: !writable, label: t('settings.data.discover'), onChange: (v) => setField('discover', v).then(flashSaved) }),
                        !writable ? h('span', { className: 'mgp-field-hint' }, t('settings.data.readonly')) : null)),
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
                // task done alert — Magpie's turnDoneAlert, same rule and same sound
                cfg ? h('div', { className: 'mgp-set-card' },
                  h('div', { className: 'mgp-set-cardtitle' }, t('settings.alerts')),
                  h('div', { className: 'mgp-field-grid' },
                    h(Field, { label: t('settings.alerts.turnDone'), hint: t('settings.alerts.turnDone.hint') },
                      h('div', { className: 'mgp-alert-row' },
                        h('div', { className: 'mgp-seg mgp-alert-seg', role: 'radiogroup', 'aria-label': t('settings.alerts.turnDone') },
                          ALERT_PRESETS.map((sec) => h('button', {
                            key: sec, type: 'button', role: 'radio', 'aria-checked': alertSeconds === sec,
                            className: 'mgp-segbtn' + (alertSeconds === sec ? ' mgp-segbtn-on' : ''),
                            disabled: !writable,
                            onClick: () => { clearDraft('turnDoneAlert'); setField('turnDoneAlert', sec).then(flashSaved) },
                          }, sec === 0 ? t('settings.alerts.off') : t('units.min', { n: sec / 60 })))))),
                    h(Field, { label: t('settings.alerts.custom') },
                      h(ConfigInput, { value: draftVal('turnDoneAlert'), type: 'number', min: 0, max: 86400, step: 30, disabled: !writable, onChange: editDraft('turnDoneAlert'), onBlur: () => commitNum('turnDoneAlert', 0, 86400), onEnter: () => commitNum('turnDoneAlert', 0, 86400) })),
                    h(Field, { label: t('settings.alerts.sound') },
                      h('div', { className: 'mgp-alert-row' },
                        h('div', { className: 'mgp-seg mgp-alert-seg', role: 'radiogroup', 'aria-label': t('settings.alerts.sound') },
                          ALERT_TONE_KEYS.map((key) => h('button', {
                            key, type: 'button', role: 'radio', 'aria-checked': alertTone === key,
                            className: 'mgp-segbtn' + (alertTone === key ? ' mgp-segbtn-on' : ''),
                            disabled: !writable || (cfg.alertTones && cfg.alertTones[key] === false),
                            onClick: () => {
                              clearDraft('alertTone')
                              setField('alertTone', key).then(() => {
                                playAlertSound(key).then((ok) => { setSoundOk(ok); flashSaved() })
                              })
                            },
                          }, t('settings.alerts.sound.' + key)))))),
                    h(Field, { label: t('settings.alerts.flash'), hint: t('settings.alerts.flash.hint') },
                      h('div', { className: 'mgp-field-inline' },
                        h(Switch, { checked: cfg.alertFlash !== false, disabled: !writable, label: t('settings.alerts.flash'), onChange: (v) => setField('alertFlash', v).then(flashSaved) }),
                        !writable ? h('span', { className: 'mgp-field-hint' }, t('settings.data.readonly')) : null)),
                    soundOk === false ? h('div', { className: 'mgp-note' }, t('settings.alerts.noSound')) : null,
                    h('div', { className: 'mgp-alert-row' },
                      h('button', { type: 'button', className: 'mgp-btn', onClick: () => { playAlertSound(alertTone).then((ok) => { setSoundOk(ok); flashSaved() }) } }, t('settings.alerts.test')),
                      perm === 'granted'
                        ? h('span', { className: 'mgp-field-hint' }, t('settings.alerts.perm.granted'))
                        : perm === 'denied'
                          ? h('span', { className: 'mgp-field-hint' }, t('settings.alerts.perm.denied'))
                          : perm === 'unsupported'
                            ? h('span', { className: 'mgp-field-hint' }, t('settings.alerts.perm.unsupported'))
                            : h('button', { type: 'button', className: 'mgp-btn', onClick: () => { requestNotifyPermission().then((p) => setPerm(p === 'granted' ? 'granted' : notifyPermission())) } }, t('settings.alerts.perm.ask'))))) : null,
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

        // task done alert: Magpie rings when a long task ends; so do we, with the
        // same threshold rule and the same system sound.
        const startAlertWatch = (sessionCtx) => {
          const scope = sessionCtx || ctx
          scope.effect(() => {
            // Threshold, tone and flash all come from the same host config, so
            // the panel never carries a second copy that could drift.
            const readAlert = () => {
              try {
                const ctrl = ctx.configForms && typeof ctx.configForms.get === 'function' ? ctx.configForms.get(WIDGET_ID) : null
                const snap = ctrl && typeof ctrl.getSnapshot === 'function' ? ctrl.getSnapshot() : null
                const value = snap && snap.value ? snap.value : {}
                return { seconds: value.turnDoneAlert, tone: value.alertTone, flash: value.alertFlash }
              } catch {
                return { seconds: 0, tone: undefined, flash: undefined }
              }
            }
            return watchTurnDone(scope, () => readAlert().seconds, ({ row, ran }) => {
              const alert = readAlert()
              const name = row.displayTitle || row.title || row.id
              const title = t('alert.done.title', { name })
              const body = t('alert.done.body', { time: alertSpan(ran, t) })
              playAlertSound(alert.tone)
              // The blink is the shell's job; a Host that cannot start it
              // changes nothing about the sound or the notification.
              if (alert.flash !== false) flashTaskbar()
              // One sound per turn: a granted notification is silent by design,
              // the corner card carries the text when notifications are off.
              if (!showDoneNotification(title, body)) showInlineAlert(title, body)
            })
          }, NS + ': task done alert')
        }
        // The service is optional, and the offline preview has no inject at all.
        if (typeof ctx.inject === 'function') ctx.inject(['sessions'], startAlertWatch)
        else startAlertWatch(ctx)

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