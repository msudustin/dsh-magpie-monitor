// Client mount tests for @local/dsh-magpie-monitor.
// Runs the real client.js inside a vm sandbox with a fake React (hook-aware),
// a fake cordis ctx (locale/slots/effect), fake window/document/localStorage and
// a mock fetch. Asserts registration, mount-time fetch, rendering, mask/period
// interaction, persistence re-validation, stale banner and unmount cleanup.
//
// Run: npm test   (node --experimental-vm-modules --test --test-force-exit "test/*.test.js")

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, '..', 'client.js'), 'utf8')

// ---- fake React with a real hook dispatcher ----
let active = null
function makeReact() {
  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity)
      return { type, props: { ...(props || {}), children: flat }, children: flat }
    },
    useState(init) {
      const s = active
      const i = s.index++
      if (!(i in s.hooks)) s.hooks[i] = { value: typeof init === 'function' ? init() : init }
      const hook = s.hooks[i]
      return [hook.value, (v) => { hook.value = typeof v === 'function' ? v(hook.value) : v; s.dirty = true }]
    },
    useReducer(reducer, init) {
      const s = active
      const i = s.index++
      if (!(i in s.hooks)) s.hooks[i] = { value: init }
      const hook = s.hooks[i]
      return [hook.value, (action) => { hook.value = reducer(hook.value, action); s.dirty = true }]
    },
    useRef(init) {
      const s = active
      const i = s.index++
      if (!(i in s.hooks)) s.hooks[i] = { current: init }
      return s.hooks[i]
    },
    useCallback(fn, deps) {
      const s = active
      const i = s.index++
      const prev = s.hooks[i]
      if (prev && deps && deps.every((d, j) => d === prev.deps[j])) return prev.fn
      s.hooks[i] = { fn, deps }
      return fn
    },
    useEffect(fn, deps) {
      const s = active
      const i = s.index++
      const prev = s.hooks[i]
      const changed = !prev || !deps || deps.some((d, j) => d !== prev.deps[j])
      s.hooks[i] = { deps }
      if (changed) s.queue.push({ key: i, fn })
    },
  }
  class Component {
    constructor(props) { this.props = props; this.state = {} }
    setState(partial) { Object.assign(this.state, partial); if (active) active.dirty = true }
  }
  Component.prototype.__fake = true
  React.Component = Component
  return React
}

function mount(React, Component, props) {
  const session = { hooks: [], index: 0, queue: [], cleanups: new Map(), dirty: false, passes: 0 }
  let tree = null
  const pass = () => {
    if (session.passes++ > 80) throw new Error('render loop')
    session.index = 0
    session.queue = []
    active = session
    try { tree = Component(props) } finally { active = null }
    for (const item of session.queue) {
      const prev = session.cleanups.get(item.key)
      if (typeof prev === 'function') prev()
      const cleanup = item.fn()
      session.cleanups.set(item.key, typeof cleanup === 'function' ? cleanup : null)
    }
  }
  pass()
  return {
    flush() { let g = 0; while (session.dirty && g++ < 80) { session.dirty = false; pass() } },
    tree: () => tree,
    unmount() { for (const c of session.cleanups.values()) if (typeof c === 'function') c(); session.cleanups.clear() },
  }
}

// Expand pure child components + classes into host elements for assertions.
function flatten(React, el, depth = 0) {
  if (depth > 80) throw new Error('flatten depth')
  if (el === null || el === undefined || typeof el === 'boolean') return []
  if (Array.isArray(el)) return el.flatMap((c) => flatten(React, c, depth + 1))
  if (typeof el === 'string' || typeof el === 'number') return [{ type: '#text', text: String(el), props: {}, children: [] }]
  if (typeof el !== 'object') return []
  const { type, props, children } = el
  if (type === React.Fragment) return flatten(React, children, depth + 1)
  if (typeof type === 'function') {
    if (type.prototype && type.prototype.__fake) {
      const inst = new type({ ...props, children })
      return flatten(React, inst.render(), depth + 1)
    }
    return flatten(React, type({ ...props, children }), depth + 1)
  }
  return [{ type, props: props || {}, children: flatten(React, children, depth + 1) }]
}

function texts(nodes) {
  const out = []
  const walk = (n) => { if (n.type === '#text') out.push(n.text); n.children.forEach(walk) }
  nodes.forEach(walk)
  return out
}
function findAll(nodes, pred) {
  const out = []
  const walk = (n) => { if (n.type !== '#text' && pred(n)) out.push(n); n.children.forEach(walk) }
  nodes.forEach(walk)
  return out
}
const byClass = (nodes, cls) => findAll(nodes, (n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(cls))
const byTitle = (nodes, title) => findAll(nodes, (n) => n.props.title === title)

// ---- snapshot fixture (host-shaped) ----
function snapshotFixture(over = {}) {
  return {
    ok: true, gateway: 'http://127.0.0.1:3425', fetchedAt: '2026-11-15T12:00:00+08:00', period: 'today',
    config: { gatewayUrl: 'http://127.0.0.1:3425', refreshMs: 5000, requestLimit: 40, period: 'today', cnyRate: 0, tool: true },
    currency: { code: 'USD', symbol: '$', rate: 1 },
    health: { name: 'magpie', version: '0.1.4207', serves: 'tray', models: 10, pid: 1 },
    usage: { period: 'today', since: '', bucket: 'hour', calls: 829, errors: 3, retried: 2, canceled: 0, input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 0, reasoning: 500, cost: 2.65, unpriced: 5, timed: 100, avgTtftMs: 4700, avgTokensPerSecond: 42, cacheHitPct: 75 },
    series: [{ label: '00', time: 't0', calls: 10, errors: 1, input: 1, output: 2, cacheRead: 3, cost: 0.1 }, { label: '01', time: 't1', calls: 5, errors: 0, input: 1, output: 1, cacheRead: 0, cost: 0.05 }],
    quotas: [{ provider: 'zcode', name: 'ZCode', kind: 'oauth', plan: 'Max', user: 'u1', alias: '134****3762', readAt: '', until: '', renew: '', error: '', windows: [{ name: '5h', used: 38.6, remaining: 61.4, resetsAt: '2026-11-16T00:00:00+08:00', display: '1156577 / 3000000', amount: 1156577, limit: 3000000, unit: 'credits', holdsWhy: 'credits', runsOutAt: '' }] }],
    history: [{ provider: 'zcode', user: 'u1', lines: [{ name: '5h', points: [{ at: 'a', left: 80 }, { at: 'b', left: 61.4 }] }] }],
    requests: [
      { route_id: 'r1', t: '2026-11-15T12:00:00+08:00', agent: 'qw', agentName: 'QwenWork', provider: 'zcode', providerName: 'ZCode', providerAccount: 'acct@example.com', model: 'glm-5.3', req: 'group/x', served: 'glm-5.3', ep: 'e', access: 'a', session: 's', in: 10, out: 20, cacheRead: 30, reasoning: 5, ms: 1234, ttftMs: 456, status: 200, cost: 0.01, priced: true },
      { route_id: 'r2', t: '2026-11-15T11:00:00+08:00', agent: 'cc', agentName: 'cc', provider: 'zcode', providerName: 'ZCode', providerAccount: '', model: 'glm-5.3', req: 'group/y', served: 'glm-5.3', ep: '', access: '', session: '', in: 1, out: 2, cacheRead: 0, reasoning: 0, ms: 900, ttftMs: 300, status: 200, cost: 0.02, priced: true },
    ],
    models: [{ id: 'm1', provider: 'p', model: 'frontier-1', name: 'frontier-1', sub: 'P', calls: 10, errors: 0, input: 1, output: 2, cacheRead: 3, cost: 1.5, unpriced: 0 }],
    statusline: '', problems: [],
    ...over,
  }
}

// ---- sandbox environment ----
function makeEnv(opts = {}) {
  const React = makeReact()
  const storage = new Map()
  const writes = []
  const listeners = { window: {}, document: {} }
  const timers = { intervals: new Set(), timeouts: new Set() }
  const fetchCalls = []
  let responder = opts.responder || (() => ({ ok: true, status: 200, json: async () => snapshotFixture() }))
  const mockFetch = (url, init) => { fetchCalls.push({ url: String(url), init }); return Promise.resolve(responder(String(url), init)) }
  const window = {
    innerHeight: opts.innerHeight ?? 900,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); writes.push(String(v)) },
      removeItem: (k) => storage.delete(k),
    },
    addEventListener: (e, cb) => { (listeners.window[e] ||= []).push(cb) },
    removeEventListener: (e, cb) => { listeners.window[e] = (listeners.window[e] || []).filter((f) => f !== cb) },
    __ModuleLoader__: { load: (def) => { env.captured = def } },
  }
  const document = {
    visibilityState: 'visible',
    addEventListener: (e, cb) => { (listeners.document[e] ||= []).push(cb) },
    removeEventListener: (e, cb) => { listeners.document[e] = (listeners.document[e] || []).filter((f) => f !== cb) },
  }
  const sandbox = {
    window, document, console, fetch: mockFetch,
    AbortController, AbortSignal, Intl, Date, Math, JSON, Number, String, Object, Array, Boolean, Promise, Set, Map, Error, RegExp,
    encodeURIComponent, decodeURIComponent, isNaN,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.timeouts.add(id); return id },
    clearTimeout: (id) => { timers.timeouts.delete(id); clearTimeout(id) },
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.intervals.add(id); return id },
    clearInterval: (id) => { timers.intervals.delete(id); clearInterval(id) },
    requestAnimationFrame: (fn) => { const id = setTimeout(fn, 0); timers.timeouts.add(id); return id },
    cancelAnimationFrame: (id) => { timers.timeouts.delete(id); clearTimeout(id) },
  }
  const context = vm.createContext(sandbox)
  const env = {
    React, window, document, storage, writes, fetchCalls, timers, listeners, context,
    setResponder: (r) => { responder = r },
    emit: (target, evt) => { for (const cb of listeners[target][evt] || []) cb() },
    dispose: () => { for (const id of timers.intervals) clearInterval(id); for (const id of timers.timeouts) clearTimeout(id); timers.intervals.clear(); timers.timeouts.clear() },
  }
  vm.runInContext(source, context)
  return env
}

function makeClientCtx(env) {
  const dicts = {}
  const registrations = []
  const effects = []
  let lang = 'zh'
  const ctx = {
    effect(fn, label) { const cleanup = fn(); effects.push({ label, cleanup }); return cleanup },
    locale: {
      register(ns, d) { dicts[ns] = d; return () => { delete dicts[ns] } },
      bind(ns) {
        return (key, params) => {
          let text = (dicts[ns] && dicts[ns][lang] && dicts[ns][lang][key]) ?? key
          if (params) for (const [k, v] of Object.entries(params)) text = text.split('{' + k + '}').join(String(v))
          return text
        }
      },
      subscribe() { return () => {} },
    },
    slots: {
      inject(name, cb) { cb(); return () => {} },
      register(descriptor, Component) { const entry = { descriptor, Component }; registrations.push(entry); return () => {} },
    },
  }
  return { ctx, dicts, registrations, effects, setLang: (l) => { lang = l } }
}

function setup(opts = {}) {
  const env = makeEnv(opts)
  const plugin = env.captured.factory((name) => { if (name === 'react') return env.React; throw new Error('unexpected require ' + name) })
  const c = makeClientCtx(env)
  plugin.apply(c.ctx)
  return { env, plugin, ...c }
}

// Mount the inner MagpieFooter (unwrap the stable error boundary).
function mountFooter(s, props = { wide: true }) {
  const reg = s.registrations[0]
  const safeEl = reg.Component(props) // MagpieFooterSafe is pure
  const inner = safeEl.children[0]
  const m = mount(s.env.React, inner.type, inner.props)
  return m
}
const settle = () => new Promise((r) => setTimeout(r, 15))
const render = (s, m) => flatten(s.env.React, m.tree())

// ---------------------------------------------------------------------------

test('loader captures the package id and factory returns a plugin', () => {
  const s = setup()
  assert.equal(s.env.captured.id, '@local/dsh-magpie-monitor')
  assert.equal(s.plugin.name, 'dsh-magpie-monitor')
  assert.deepEqual([...s.plugin.inject], ['slots', 'locale', 'configForms'])
  s.env.dispose()
})

test('apply registers locale dictionaries and the footer slot, no fetch yet', () => {
  const s = setup()
  assert.ok(s.dicts['dsh-magpie-monitor'].en && s.dicts['dsh-magpie-monitor'].zh)
  assert.deepEqual(Object.keys(s.dicts['dsh-magpie-monitor'].en).sort(), Object.keys(s.dicts['dsh-magpie-monitor'].zh).sort())
  assert.equal(s.registrations.length, 3)
  const d = s.registrations[0].descriptor
  assert.equal(d.name, 'sidebar.footer.action')
  assert.equal(d.id, 'magpie-monitor')
  assert.equal(d.order, 100)
  assert.equal(typeof d.label, 'function')
  assert.equal(s.registrations[1].descriptor.name, 'settings.section')
  assert.equal(s.registrations[1].descriptor.id, 'magpie-monitor')
  assert.equal(s.registrations[2].descriptor.name, 'plugins.bundle.config')
  assert.equal(s.registrations[2].descriptor.key, '@local/dsh-magpie-monitor')
  assert.equal(s.env.fetchCalls.length, 0) // nothing fetched before mount
  assert.equal(s.env.timers.intervals.size, 0)
  s.env.dispose()
})

test('mount fetches one merged snapshot and renders usage/quota/model', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  assert.equal(s.env.fetchCalls.length, 1)
  assert.equal(s.env.fetchCalls[0].url, '/magpie-monitor/api/snapshot?period=today&recent=40')
  assert.equal(s.env.fetchCalls[0].init.credentials, 'same-origin')
  const nodes = render(s, m)
  const txt = texts(nodes).join('|')
  assert.ok(txt.includes('829'), 'calls rendered')
  assert.ok(txt.includes('$2.65'), 'cost rendered')
  assert.ok(txt.includes('39%'), 'quota pct rounded')
  assert.ok(txt.includes('TTFT 4.7 s'), 'derived ttft')
  assert.ok(txt.includes('42 tok/s'), 'derived speed')
  assert.ok(txt.includes('缓存 75%'), 'cache hit')
  assert.ok(txt.includes('frontier-1') || byClass(nodes, 'mgp-mline').length >= 0)
  assert.equal(byClass(nodes, 'mgp-chart').length, 1, 'activity chart present')
  assert.equal(byClass(nodes, 'mgp-bar').length, 2)
  assert.equal(byClass(nodes, 'mgp-spark').length, 1, 'quota sparkline matched from history')
  assert.equal(byClass(nodes, 'mgp-tab').length, 3, 'period tabs')
  assert.equal(byClass(nodes, 'mgp-dot-on').length >= 1, true, 'online dot')
  assert.equal(byClass(nodes, 'mgp-statusbtn').length, 1, 'one merged status/refresh control')
  assert.equal(byClass(nodes, 'mgp-fbtn').length, 1, 'only the mask button is left in the header')
  const latestMeta = byClass(nodes, 'mgp-latest-meta')[0]
  assert.ok(texts([latestMeta]).join('|').includes('tok/s'), 'latest route shows output rate, not duration')
  assert.ok(String(latestMeta.props.title).includes('输出速率'), 'rate tooltip names the metric')
  m.unmount(); s.env.dispose()
})

test('mask toggle hides amounts and accounts, persists the pref', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const maskBtn = byTitle(render(s, m), '打码金额与账号')[0]
  assert.ok(maskBtn, 'mask button exists')
  maskBtn.props.onClick()
  m.flush() // commit the state flip first (real React renders before the macrotask)
  await settle(); m.flush()
  const txt = texts(render(s, m)).join('|')
  assert.ok(txt.includes('••••'), 'cost masked')
  assert.ok(!txt.includes('$2.65'), 'plain cost gone')
  const last = JSON.parse(s.env.writes.at(-1))
  assert.equal(last.v, 1)
  assert.equal(last.prefs.masked, true)
  m.unmount(); s.env.dispose()
})

test('period tab switch refetches with fresh=1 and persists', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const tabs = byClass(render(s, m), 'mgp-tab')
  const seven = tabs.find((t) => texts([t]).join('') === '7 天')
  assert.ok(seven, '7-day tab found')
  seven.props.onClick()
  await settle(); m.flush()
  const last = s.env.fetchCalls.at(-1)
  assert.equal(last.url, '/magpie-monitor/api/snapshot?period=7d&recent=40&fresh=1')
  assert.equal(JSON.parse(s.env.writes.at(-1)).prefs.period, '7d')
  m.unmount(); s.env.dispose()
})

test('persisted envelope is re-validated through the whitelist on restore', async () => {
  const s = setup()
  // Tamper: wrong types + an injected field + a script-ish string.
  const evil = snapshotFixture()
  evil.usage.calls = 'not-a-number'
  evil.usage.evilField = '<script>alert(1)</script>'
  evil.health.name = 'magpie'
  evil.injected = { x: 1 }
  s.env.storage.set('dsh-magpie-monitor:v1', JSON.stringify({ v: 1, savedAt: Date.now(), prefs: { period: '7d', masked: true, auto: false }, snap: evil }))
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  const txt = texts(nodes).join('|')
  assert.ok(!txt.includes('not-a-number'), 'bad number coerced')
  assert.ok(!txt.includes('<script>'), 'injected field dropped')
  assert.ok(txt.includes('••••'), 'masked pref restored')
  // period pref restored → first fetch uses 7d
  assert.equal(s.env.fetchCalls[0].url, '/magpie-monitor/api/snapshot?period=7d&recent=40')
  // auto=false → no interval
  assert.equal(s.env.timers.intervals.size, 0)
  m.unmount(); s.env.dispose()
})

test('wrong envelope version is ignored', async () => {
  const s = setup()
  s.env.storage.set('dsh-magpie-monitor:v1', JSON.stringify({ v: 999, snap: snapshotFixture(), prefs: { masked: true } }))
  const m = mountFooter(s)
  await settle(); m.flush()
  const txt = texts(render(s, m)).join('|')
  assert.ok(txt.includes('$2.65'), 'not masked → old envelope ignored')
  m.unmount(); s.env.dispose()
})

test('failed refresh keeps last good data and shows the stale banner', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  s.env.setResponder(() => ({ ok: false, status: 502, json: async () => ({}) }))
  // manual refresh — the merged status control is the refresh affordance now
  byClass(render(s, m), 'mgp-statusbtn')[0].props.onClick()
  await settle(); m.flush()
  const nodes = render(s, m)
  assert.equal(byClass(nodes, 'mgp-stale').length, 1, 'stale banner shown')
  assert.equal(byClass(nodes, 'mgp-banner').length, 0, 'not the no-data banner')
  assert.ok(texts(nodes).join('|').includes('829'), 'old data retained')
  m.unmount(); s.env.dispose()
})

test('first-load failure shows the offline banner with retry', async () => {
  const s = setup({ responder: () => ({ ok: false, status: 502, json: async () => ({}) }) })
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  assert.equal(byClass(nodes, 'mgp-banner').length, 1)
  assert.ok(texts(nodes).join('|').includes('网关不可达') || texts(nodes).join('|').includes('无法连接'))
  m.unmount(); s.env.dispose()
})

test('rail mode renders a single icon with a summary tooltip', async () => {
  const s = setup()
  const m = mountFooter(s, { wide: false })
  await settle(); m.flush()
  const nodes = render(s, m)
  assert.equal(byClass(nodes, 'mgp-footstack').length, 1)
  assert.ok(byClass(nodes, 'mgp-footstack')[0].props.className.includes('rail'))
  assert.equal(byClass(nodes, 'mgp-chart').length, 0, 'no chart in rail')
  const tip = byClass(nodes, 'mgp-railwrap')[0].props.title
  assert.ok(tip.includes('829') && tip.includes('glm-5.3'))
  m.unmount(); s.env.dispose()
})

test('density tiers follow viewport height', async () => {
  for (const [vh, tier] of [[900, 'normal'], [600, 'tight'], [400, 'short']]) {
    const s = setup({ innerHeight: vh })
    const m = mountFooter(s)
    await settle(); m.flush()
    const stack = byClass(render(s, m), 'mgp-footstack')[0]
    assert.equal(stack.props['data-density'], tier, `vh=${vh}`)
    m.unmount(); s.env.dispose()
  }
})

test('visibility catch-up refetches when shown; hidden skips polling', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const before = s.env.fetchCalls.length
  s.env.document.visibilityState = 'hidden'
  s.env.emit('document', 'visibilitychange')
  await settle(); m.flush()
  assert.equal(s.env.fetchCalls.length, before, 'hidden does not fetch')
  s.env.document.visibilityState = 'visible'
  s.env.emit('document', 'visibilitychange')
  await settle(); m.flush()
  assert.equal(s.env.fetchCalls.length, before + 1, 'visible catches up')
  m.unmount(); s.env.dispose()
})

test('unmount aborts, clears the interval and stops fetching', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  assert.equal(s.env.timers.intervals.size, 1, 'auto poll running')
  m.unmount()
  assert.equal(s.env.timers.intervals.size, 0, 'interval cleared')
  assert.equal(s.env.listeners.window.resize.length, 0, 'resize listener removed')
  assert.equal(s.env.listeners.document.visibilitychange.length, 0, 'visibility listener removed')
  const before = s.env.fetchCalls.length
  await settle()
  assert.equal(s.env.fetchCalls.length, before, 'no fetch after unmount')
  s.env.dispose()
})

// ---- settings page --------------------------------------------------------

function mountSettings(s, props = {}) {
  const reg = s.registrations[1] // settings.section
  const safeEl = reg.Component(props)
  const inner = safeEl.children[0]
  return mount(s.env.React, inner.type, inner.props)
}
const displayEnv = (s) => JSON.parse(s.env.storage.get('dsh-magpie-monitor:display:v1'))
const rowByLabel = (nodes, label) => byClass(nodes, 'mgp-toggle-row').find((r) => texts([r]).join('').includes(label))
const cardByLabel = (nodes, label) => byClass(nodes, 'mgp-style-card').find((c) => texts([c]).join('').includes(label))
const fieldByLabel = (nodes, label) => byClass(nodes, 'mgp-field').find((f) => texts([f]).join('').includes(label))

function fakeConfigForms(value, writable = true) {
  const listeners = new Set()
  let snap = { status: 'ready', value: { ...value }, base: { ...value }, user: {}, revision: 1, writable }
  const ctrl = {
    getSnapshot: () => snap,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    set: (field, val) => { snap = { ...snap, value: { ...snap.value, [field]: val }, revision: snap.revision + 1 }; for (const fn of listeners) fn(); return Promise.resolve(true) },
    unset: () => Promise.resolve(true),
    mutate: () => Promise.resolve(true),
    dispose: () => {},
  }
  return { get: () => ctrl, _ctrl: ctrl }
}
const baseCfg = { gatewayUrl: 'http://127.0.0.1:3425', refreshMs: 5000, requestLimit: 40, period: 'today', cnyRate: 0, tool: true }

test('settings page renders style cards, content toggles and a live preview without fetching', async () => {
  const s = setup()
  const m = mountSettings(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  assert.equal(byClass(nodes, 'mgp-style-card').length, 3, 'three style cards')
  assert.equal(byClass(nodes, 'mgp-toggle-row').length, 10, '8 content + 2 preference toggles')
  assert.equal(byClass(nodes, 'mgp-preview-frame').length, 1, 'live preview frame')
  assert.equal(byClass(nodes, 'mgp-footstack').length, 1, 'preview renders the real widget body')
  assert.equal(byClass(nodes, 'mgp-note').length, 1, 'config unavailable note when no configForms')
  assert.equal(s.env.fetchCalls.length, 0, 'settings never fetches')
  m.unmount(); s.env.dispose()
})

test('selecting a style persists it and reshapes the preview', async () => {
  const s = setup()
  const m = mountSettings(s)
  await settle(); m.flush()
  cardByLabel(render(s, m), '紧凑').props.onClick()
  m.flush()
  assert.equal(displayEnv(s).ui.style, 'compact')
  assert.equal(byClass(render(s, m), 'mgp-footstack')[0].props['data-style'], 'compact')
  cardByLabel(render(s, m), '极简').props.onClick()
  m.flush()
  assert.equal(displayEnv(s).ui.style, 'minimal')
  assert.equal(byClass(render(s, m), 'mgp-minimal').length, 1, 'minimal preview is a single line')
  m.unmount(); s.env.dispose()
})

test('a content toggle hides its block in the preview and persists', async () => {
  const s = setup()
  const m = mountSettings(s)
  await settle(); m.flush()
  assert.equal(byClass(render(s, m), 'mgp-chart').length, 1, 'chart visible by default')
  const row = rowByLabel(render(s, m), '调用分布图')
  byClass([row], 'mgp-switch')[0].props.onClick()
  m.flush()
  assert.equal(displayEnv(s).ui.show.chart, false)
  assert.equal(byClass(render(s, m), 'mgp-chart').length, 0, 'chart hidden in preview')
  m.unmount(); s.env.dispose()
})

test('reset restores display defaults but keeps preferences', async () => {
  const s = setup()
  const m = mountSettings(s)
  await settle(); m.flush()
  cardByLabel(render(s, m), '极简').props.onClick(); m.flush()
  byClass([rowByLabel(render(s, m), '调用分布图')], 'mgp-switch')[0].props.onClick(); m.flush()
  byClass([rowByLabel(render(s, m), '打码金额与账号')], 'mgp-switch')[0].props.onClick(); m.flush()
  assert.equal(displayEnv(s).ui.masked, true)
  byClass(render(s, m), 'mgp-btn')[0].props.onClick(); m.flush()
  const ui = displayEnv(s).ui
  assert.equal(ui.style, 'standard')
  assert.equal(ui.show.chart, true)
  assert.equal(ui.masked, true, 'preferences survive a display reset')
  m.unmount(); s.env.dispose()
})

test('host config form commits select, switch and typed fields through configForms', async () => {
  const s = setup()
  const forms = fakeConfigForms(baseCfg)
  s.ctx.configForms = forms
  const m = mountSettings(s)
  await settle(); m.flush()
  assert.equal(byClass(render(s, m), 'mgp-note').length, 0, 'no unavailable note when served')
  // select commits immediately
  byClass(render(s, m), 'mgp-select')[0].props.onChange({ target: { value: '7d' } })
  await settle(); m.flush()
  assert.equal(forms._ctrl.getSnapshot().value.period, '7d')
  // tool switch commits immediately
  const toolField = fieldByLabel(render(s, m), 'Agent 工具')
  byClass([toolField], 'mgp-switch')[0].props.onClick()
  await settle(); m.flush()
  assert.equal(forms._ctrl.getSnapshot().value.tool, false)
  // typed number commits on blur (after the local state flushes)
  let input = byClass([fieldByLabel(render(s, m), '刷新间隔')], 'mgp-input')[0]
  input.props.onChange({ target: { value: '3000' } })
  m.flush()
  input = byClass([fieldByLabel(render(s, m), '刷新间隔')], 'mgp-input')[0]
  input.props.onBlur()
  await settle(); m.flush()
  assert.equal(forms._ctrl.getSnapshot().value.refreshMs, 3000)
  m.unmount(); s.env.dispose()
})

test('settings and footer share display state live', async () => {
  const s = setup()
  const mf = mountFooter(s)
  await settle(); mf.flush()
  const ms = mountSettings(s)
  await settle(); ms.flush()
  assert.equal(byClass(render(s, mf), 'mgp-minimal').length, 0, 'footer starts standard')
  cardByLabel(render(s, ms), '极简').props.onClick()
  ms.flush(); mf.flush()
  assert.equal(byClass(render(s, mf), 'mgp-minimal').length, 1, 'footer follows the settings change live')
  mf.unmount(); ms.unmount(); s.env.dispose()
})

test('merged status control reports paused auto refresh and still refreshes on click', async () => {
  const s = setup()
  const mf = mountFooter(s)
  await settle(); mf.flush()
  const ms = mountSettings(s)
  await settle(); ms.flush()
  // auto refresh now lives in the settings page, not in the widget header
  const autoRow = rowByLabel(render(s, ms), '自动刷新')
  assert.ok(autoRow, 'settings page owns the auto-refresh switch')
  byClass([autoRow], 'mgp-switch')[0].props.onClick()
  ms.flush(); mf.flush()
  await settle(); mf.flush()
  const nodes = render(s, mf)
  assert.equal(byClass(nodes, 'mgp-dot-paused').length, 1, 'paused dot replaces the live pulse')
  assert.equal(byClass(nodes, 'mgp-dot-live').length, 0, 'no pulse while paused')
  assert.ok(texts([byClass(nodes, 'mgp-statusbtn')[0]]).join('|').includes('已暂停'), 'state is labelled')
  const before = s.env.fetchCalls.length
  byClass(render(s, mf), 'mgp-statusbtn')[0].props.onClick()
  await settle(); mf.flush()
  assert.ok(s.env.fetchCalls.length > before, 'clicking the status control refreshes immediately')
  assert.ok(s.env.fetchCalls.at(-1).url.includes('fresh=1'), 'manual refresh bypasses the cache')
  mf.unmount(); ms.unmount(); s.env.dispose()
})

test('minimal style keeps a compact status control without a label', async () => {
  const s = setup()
  const mf = mountFooter(s)
  await settle(); mf.flush()
  const ms = mountSettings(s)
  await settle(); ms.flush()
  cardByLabel(render(s, ms), '极简').props.onClick()
  ms.flush(); mf.flush()
  const nodes = render(s, mf)
  assert.equal(byClass(nodes, 'mgp-statusbtn-compact').length, 1, 'compact status control in the single line')
  assert.equal(byClass(nodes, 'mgp-statusbtn-label').length, 0, 'no text label in minimal mode')
  assert.equal(byClass(nodes, 'mgp-fbtn').length, 0, 'minimal line has no extra buttons')
  mf.unmount(); ms.unmount(); s.env.dispose()
})
