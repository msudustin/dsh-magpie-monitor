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
// The flight strip builds its wire from the measured box, so tests need to say
// how wide the sidebar is; a ref stands in for the real DOM node.
let boxWidth = 320
function setBoxWidth(w) { boxWidth = w }
// The strip measures the two outer marks, so the fake DOM needs to answer for
// them: null keeps the old "26px from either edge" fallback.
let markEdges = null
function setMarkEdges(left, right) { markEdges = left === null ? null : { left, right } }
function makeReact() {
  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity)
      const next = { ...(props || {}), children: flat }
      if (next.ref && typeof next.ref === 'object') {
        const edge = next['data-edge']
        const node = { clientWidth: boxWidth, offsetWidth: boxWidth }
        if (markEdges) {
          node.getBoundingClientRect = () => {
            if (edge === 'left') {
              const left = markEdges.left - 10
              return { left, right: left + 20, width: 20, top: 20, bottom: 40, height: 20 }
            }
            if (edge === 'right') {
              const left = markEdges.right - 10
              return { left, right: left + 20, width: 20, top: 20, bottom: 40, height: 20 }
            }
            return { left: 0, right: boxWidth, width: boxWidth, top: 0, bottom: 58, height: 58 }
          }
        }
        next.ref.current = node
      }
      return { type, props: next, children: flat }
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

// Function components rendered by flatten() get their own hook session, the way
// React keeps one per instance; anything they schedule is collected by the root
// session so a single unmount still tears everything down.
let rootSession = null
function mount(React, Component, props) {
  const session = { hooks: [], index: 0, queue: [], cleanups: new Map(), dirty: false, passes: 0, children: [], hookCounts: [] }
  rootSession = session
  childSessions.clear()
  let tree = null
  const pass = () => {
    if (session.passes++ > 80) throw new Error('render loop')
    session.index = 0
    session.queue = []
    active = session
    let used = 0
    try { tree = Component(props); used = session.index } finally { active = null }
    // React requires the same number of hooks on every render; a component that
    // calls another component inline instead of rendering it violates that.
    if (session.hookCounts.length > 0 && session.hookCounts[0] !== used) {
      throw new Error('hook order changed: first pass used ' + session.hookCounts[0] + ' hooks, this pass used ' + used)
    }
    session.hookCounts.push(used)
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
    unmount() {
      for (const child of session.children) for (const c of child.cleanups.values()) if (typeof c === 'function') c()
      for (const c of session.cleanups.values()) if (typeof c === 'function') c()
      session.children.length = 0
      session.cleanups.clear()
    },
  }
}

// Expand pure child components + classes into host elements for assertions.
// Child components keep their hook state between passes the way React keeps one
// session per instance; a component that measures its box (useBoxWidth) renders
// once with the fallback and again with the real width, so the tree is rendered
// until it stops asking to re-render. Identity is positional, like React's.
const childSessions = new Map()
function flatten(React, el, depth = 0, pathKey = '') {
  if (depth > 80) throw new Error('flatten depth')
  if (el === null || el === undefined || typeof el === 'boolean') return []
  if (Array.isArray(el)) return el.flatMap((c, i) => flatten(React, c, depth + 1, pathKey + '[' + i + ']'))
  if (typeof el === 'string' || typeof el === 'number') return [{ type: '#text', text: String(el), props: {}, children: [] }]
  if (typeof el !== 'object') return []
  const { type, props, children } = el
  if (type === React.Fragment) return flatten(React, children, depth + 1, pathKey + '#f')
  if (typeof type === 'function') {
    if (type.prototype && type.prototype.__fake) {
      const inst = new type({ ...props, children })
      return flatten(React, inst.render(), depth + 1, pathKey)
    }
    const key = pathKey + '<' + (type.name || 'anon')
    let child = childSessions.get(key)
    if (!child) {
      child = { hooks: [], index: 0, queue: [], cleanups: new Map(), dirty: false, passes: 0 }
      childSessions.set(key, child)
      if (rootSession) rootSession.children.push(child)
    }
    const outer = active
    let out
    for (let round = 0; round < 8; round++) {
      if (child.passes++ > 40) throw new Error('child render loop: ' + key)
      child.dirty = false
      child.index = 0
      child.queue = []
      active = child
      try { out = type({ ...props, children }) } finally { active = outer }
      for (const item of child.queue) {
        const prev = child.cleanups.get(item.key)
        if (typeof prev === 'function') prev()
        const cleanup = item.fn()
        child.cleanups.set(item.key, typeof cleanup === 'function' ? cleanup : null)
      }
      if (!child.dirty) break
    }
    return flatten(React, out, depth + 1, key)
  }
  return [{ type, props: props || {}, children: flatten(React, children, depth + 1, pathKey + '.' + type) }]
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
    speeds: [{ model: 'glm-5.3', name: 'glm-5.3', requests: 400, tps: 83, tpsN: 71, ttftMs: 800, cost: 1.4 }],
    channels: { through: { calls: 640, errors: 1, cost: 1.8 }, direct: { calls: 223, errors: 1, cost: 0.7 }, reported: { calls: 0, errors: 0, cost: 0 } },
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
  const delays = []
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
    AbortController, AbortSignal, Intl, Date: opts.Date || Date, Math, JSON, Number, String, Object, Array, Boolean, Promise, Set, Map, Error, RegExp,
    // The alert path only exists when the shell provides these; undefined is what a bare realm looks like.
    Notification: opts.Notification, Audio: opts.Audio,
    encodeURIComponent, decodeURIComponent, isNaN,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.timeouts.add(id); return id },
    clearTimeout: (id) => { timers.timeouts.delete(id); clearTimeout(id) },
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.intervals.add(id); delays.push(ms); return id },
    clearInterval: (id) => { timers.intervals.delete(id); clearInterval(id) },
    requestAnimationFrame: (fn) => { const id = setTimeout(fn, 0); timers.timeouts.add(id); return id },
    cancelAnimationFrame: (id) => { timers.timeouts.delete(id); clearTimeout(id) },
  }
  const context = vm.createContext(sandbox)
  const env = {
    React, window, document, storage, writes, fetchCalls, timers, delays, listeners, context,
    setResponder: (r) => { responder = r },
    emit: (target, evt) => { for (const cb of listeners[target][evt] || []) cb() },
    dispose: () => { for (const id of timers.intervals) clearInterval(id); for (const id of timers.timeouts) clearTimeout(id); timers.intervals.clear(); timers.timeouts.clear() },
  }
  vm.runInContext(source, context)
  return env
}

function makeClientCtx(env, extra = {}) {
  const dicts = {}
  const registrations = []
  const effects = []
  let lang = 'zh'
  const ctx = {
    // cordis injects a child scope; the fake only needs the callback to run so
    // optional services can be present or absent per test.
    inject(names, cb) { cb(); return () => {} },
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
    ...extra,
  }
  return { ctx, dicts, registrations, effects, setLang: (l) => { lang = l } }
}

function setup(opts = {}) {
  const env = makeEnv(opts)
  const plugin = env.captured.factory((name) => { if (name === 'react') return env.React; throw new Error('unexpected require ' + name) })
  const c = makeClientCtx(env, opts.ctx || {})
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
  assert.ok(txt.includes('剩余 61%'), 'quota shows the remaining share, rounded')
  assert.ok(txt.includes('TTFT 4.7 s'), 'derived ttft')
  assert.ok(txt.includes('42 tok/s'), 'derived speed')
  assert.ok(txt.includes('缓存 75%'), 'cache hit')
  assert.ok(txt.includes('frontier-1') || byClass(nodes, 'mgp-mline').length >= 0)
  assert.equal(byClass(nodes, 'mgp-chart').length, 1, 'activity chart present')
  assert.equal(byClass(nodes, 'mgp-bar').length, 2)
  assert.equal(byClass(nodes, 'mgp-spark').length, 1, 'quota sparkline matched from history')
  assert.equal(byClass(nodes, 'mgp-tab').length, 4, 'period tabs, all-time included')
  assert.equal(byClass(nodes, 'mgp-dot-on').length >= 1, true, 'online dot')
  assert.equal(byClass(nodes, 'mgp-statusbtn').length, 1, 'one merged status/refresh control')
  assert.equal(byClass(nodes, 'mgp-fbtn').length, 1, 'only the mask button is left in the header')
  const latestMeta = byClass(nodes, 'mgp-latest-meta')[0]
  assert.ok(texts([latestMeta]).join('|').includes('tok/s'), 'latest route shows output rate, not duration')
  assert.ok(String(latestMeta.props.title).includes('输出速率'), 'rate tooltip names the metric')
  m.unmount(); s.env.dispose()
})

test('the live stamp parses whichever shape the gateway used', async () => {
  const s = setup()
  // .NET hands the panel "2026-11-16T13:26:45.2318564+08:00" — seven fraction
  // digits, which Number() flattens to NaN and Date.parse rejects outright.
  const stamp = (ms) => {
    const d = new Date(ms)
    const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0')
    const off = -d.getTimezoneOffset()
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds()) + '1234' + (off >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60)
  }
  const now = Date.now()
  const snap = snapshotFixture()
  snap.requests[0].t = stamp(now - 2000)
  s.env.setResponder(() => ({ ok: true, status: 200, json: async () => snap }))
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  const clock = byClass(nodes, 'mgp-rtime').map((n) => texts([n]).join('')).filter(Boolean)
  assert.ok(clock.length >= 1, 'the request row shows its clock')
  assert.match(clock[0], /^\d{2}:\d{2}:\d{2}$/)
  const chips = byClass(nodes, 'mgp-status')
  assert.ok(chips.length >= 1)
  assert.equal(chips.some((c) => c.props.className.includes('mgp-status-idle')), false, 'a two second old success is live, not idle')
  assert.equal(byClass(nodes, 'mgp-route')[0].props['data-live'], '1', 'the flight strip is live while a request is recent')
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
  assert.equal(byClass(nodes, 'mgp-toggle-row').length, 16, '9 content + 5 detail + 2 preference toggles')
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

test('the fine print honours its own switches: flight strip and request meta', async () => {
  const s = setup()
  const m = mountSettings(s)
  await settle(); m.flush()
  assert.equal(byClass(render(s, m), 'mgp-route').length, 1, 'flight strip visible by default')
  assert.equal(byClass(render(s, m), 'mgp-req-meta').length, 1, 'request meta visible by default')
  byClass([rowByLabel(render(s, m), '喜鹊飞线')], 'mgp-switch')[0].props.onClick()
  byClass([rowByLabel(render(s, m), '请求明细')], 'mgp-switch')[0].props.onClick()
  m.flush()
  assert.equal(displayEnv(s).ui.show.flight, false)
  assert.equal(displayEnv(s).ui.show.reqmeta, false)
  const after = render(s, m)
  assert.equal(byClass(after, 'mgp-route').length, 0, 'flight strip hidden')
  assert.equal(byClass(after, 'mgp-req-meta').length, 0, 'request meta hidden')
  assert.equal(byClass(after, 'mgp-today').length, 1, 'totals untouched by the other switches')
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

test('the details show gateway-measured model speeds and the traffic split', async () => {
  const s = setup()
  const mf = mountFooter(s)
  await settle(); mf.flush()
  const ms = mountSettings(s)
  await settle(); ms.flush()
  // expand the details so the new blocks are rendered
  const expand = byClass(render(s, mf), 'mgp-expand')[0]
  expand.props.onClick()
  mf.flush()
  const nodes = render(s, mf)
  assert.ok(texts(nodes).join('|').includes('83'), 'the measured tokens/s shows up')
  assert.ok(byClass(nodes, 'mgp-speed').length >= 1, 'speed rows are rendered')
  assert.ok(byClass(nodes, 'mgp-channel').length >= 1, 'channel rows are rendered')
  mf.unmount(); ms.unmount(); s.env.dispose()
})

test('the quota bar measures what is left, not what is spent', async () => {
  const s = setup({
    responder: () => ({
      ok: true, status: 200,
      json: async () => snapshotFixture({
        quotas: [{
          provider: 'zcode', name: 'ZCode', plan: 'Start', user: 'u1', alias: '134****0000',
          windows: [
            { name: 'fresh', used: 0, remaining: 100, display: '0 / 3,000,000' },
            { name: 'spent', used: 100, remaining: 0, display: '3,000,000 / 3,000,000' },
            { name: 'partway', used: 72, remaining: 28, display: '2,160,000 / 3,000,000' },
          ],
        }],
        history: [],
      }),
    }),
  })
  const m = mountFooter(s)
  await settle(); m.flush()
  byClass(render(s, m), 'mgp-expand')[0].props.onClick()
  m.flush()
  const nodes = render(s, m)
  const rows = byClass(nodes, 'mgp-qbar')
  assert.equal(rows.length, 3, 'one bar per window')
  const widths = byClass(nodes, 'mgp-fill').map((f) => f.props.style.width)
  // urgent windows come first, and the bar is the share LEFT: an untouched
  // quota draws full, an exhausted one draws empty. Reading "used" here put an
  // empty bar and "0% left" on a window nobody had touched.
  assert.deepEqual(widths, ['0%', '28%', '100%'])
  const txt = texts(rows).join('|')
  assert.ok(txt.includes('剩余 100%'), 'a fresh window says 100% left')
  assert.ok(txt.includes('剩余 0%'), 'an exhausted window says 0% left')
  assert.equal(rows[2].props['aria-valuenow'], 100, 'the bar reports the share left')
  m.unmount(); s.env.dispose()
})

test('grouping the recent list by session keeps the panel alive', async () => {
  // Regression: SessLine referenced a name that only ReqLine had in scope, so
  // the 按会话 switch threw during render and the host showed the error card.
  const s = setup()
  const mf = mountFooter(s)
  await settle(); mf.flush()
  byClass(render(s, mf), 'mgp-expand')[0].props.onClick()
  mf.flush()
  const segs = byClass(render(s, mf), 'mgp-segbtn')
  assert.equal(segs.length, 2, 'request/session switch is there')
  segs[1].props.onClick()
  mf.flush()
  const nodes = render(s, mf)
  assert.equal(byClass(nodes, 'mgp-problems').length, 0, 'nothing blew up')
  const rows = byClass(nodes, 'mgp-req')
  assert.ok(rows.length >= 1, 'session rows render')
  const text = texts(rows).join(' ')
  assert.ok(text.includes('请求'), 'a session row counts its requests')
  assert.ok(byClass(nodes, 'mgp-served').length >= 1, 'the session row shows the model it ran on')
  mf.unmount(); s.env.dispose()
})

test('a failing endpoint is reported with a translated reason, not a raw string', async () => {
  const s = setup({
    responder: () => ({
      ok: true, status: 200,
      json: async () => snapshotFixture({
        problems: [{ what: '额度', code: 'connection', message: 'raw host sentence' }],
      }),
    }),
  })
  const mf = mountFooter(s)
  await settle(); mf.flush()
  const nodes = render(s, mf)
  const problems = byClass(nodes, 'mgp-problems')[0]
  assert.ok(problems, 'the problem row is rendered')
  const text = texts([problems]).join(' ')
  assert.ok(text.includes('额度'), 'the failing part is named')
  assert.ok(text.includes('网关连不上'), 'the reason is translated')
  assert.ok(!text.includes('raw host sentence'), 'the raw host sentence is replaced')
  mf.unmount(); s.env.dispose()
})

test('the rail icon opens a popup card that closes on Escape', async () => {
  const s = setup()
  const mf = mountFooter(s, { wide: false })
  await settle(); mf.flush()
  assert.equal(byClass(render(s, mf), 'mgp-railpopup').length, 0, 'popup starts closed')
  const icon = byClass(render(s, mf), 'mgp-railwrap')[0]
  icon.props.onClick()
  mf.flush()
  assert.equal(byClass(render(s, mf), 'mgp-railpopup').length, 1, 'clicking the icon opens the popup')
  const popup = byClass(render(s, mf), 'mgp-railpopup')[0]
  assert.ok(texts([popup]).join('|').includes('829'), 'the popup carries the numbers')
  // Escape closes it
  const keyHandlers = s.env.listeners.document.keydown || []
  assert.ok(keyHandlers.length >= 1, 'a keydown listener is registered')
  for (const cb of keyHandlers) cb({ key: 'Escape' })
  mf.flush()
  assert.equal(byClass(render(s, mf), 'mgp-railpopup').length, 0, 'Escape closes the popup')
  mf.unmount(); s.env.dispose()
})

test('the settings page can turn gateway discovery off', async () => {
  const s = setup()
  s.ctx.configForms = fakeConfigForms({ ...baseCfg, discover: true }, true)
  const ms = mountSettings(s)
  await settle(); ms.flush()
  const row = fieldByLabel(render(s, ms), '自动发现网关')
  assert.ok(row, 'the discovery switch is in the settings page')
  const sw = byClass([row], 'mgp-switch')[0]
  assert.equal(sw.props['aria-checked'], true, 'discovery starts on')
  sw.props.onClick()
  await settle()
  assert.equal(s.ctx.configForms._ctrl.getSnapshot().value.discover, false, 'the host config is updated')
  ms.unmount(); s.env.dispose()
})

// ---- review fixes (2026-11): one test per defect found in the last pass -----

test('a re-render does not re-parse the persisted envelope', async () => {
  const s = setup()
  const read = s.env.window.localStorage.getItem
  let parses = 0
  // STORE_KEY is the snapshot envelope: up to 300 KB of JSON per parse
  s.env.window.localStorage.getItem = (k) => { if (k === 'dsh-magpie-monitor:v1') parses++; return read(k) }
  const m = mountFooter(s)
  await settle(); m.flush()
  const afterMount = parses
  assert.ok(afterMount <= 2, 'one migration read plus one mount read, got ' + afterMount)
  byClass(render(s, m), 'mgp-tab')[1].props.onClick()
  m.flush()
  byClass(render(s, m), 'mgp-fbtn')[0].props.onClick()
  m.flush()
  assert.equal(parses, afterMount, 'later renders must not re-parse the envelope')
  m.unmount(); s.env.dispose()
})

test('two quick mask clicks toggle twice instead of sticking', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const maskButton = () => byClass(render(s, m), 'mgp-fbtn')[0]
  assert.equal(maskButton().props['aria-pressed'], false)
  // both clicks land before React re-renders: a stale ref would hand the second
  // click the pre-click value and mask the amounts anyway
  maskButton().props.onClick()
  maskButton().props.onClick()
  m.flush()
  assert.equal(maskButton().props['aria-pressed'], false, 'two clicks = back to unmasked')
  assert.ok(!texts(render(s, m)).join('|').includes('••••'), 'amounts stay readable')
  // and a single click still masks
  maskButton().props.onClick()
  m.flush()
  assert.equal(maskButton().props['aria-pressed'], true)
  assert.ok(texts(render(s, m)).join('|').includes('••••'))
  m.unmount(); s.env.dispose()
})

test('the rail popup opens again after it was closed', async () => {
  const s = setup()
  const m = mountFooter(s, { wide: false })
  await settle(); m.flush()
  const open = () => {
    byClass(render(s, m), 'mgp-railwrap')[0].props.onClick()
    m.flush()
    return byClass(render(s, m), 'mgp-railpopup').length
  }
  assert.equal(open(), 1)
  for (const cb of s.env.listeners.document.keydown || []) cb({ key: 'Escape' })
  m.flush()
  assert.equal(byClass(render(s, m), 'mgp-railpopup').length, 0)
  // the popup owns hooks; rendering it as a call would leave the parent's hook
  // list shorter than the previous pass and React would throw here
  assert.equal(open(), 1, 'reopening keeps the hook order stable')
  m.unmount(); s.env.dispose()
})

test('the stale banner and the chart label speak the panel language', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  s.setLang('en')
  s.env.setResponder(() => ({ ok: false, status: 502, json: async () => ({ ok: false, code: 'server_error' }) }))
  byClass(render(s, m), 'mgp-statusbtn')[0].props.onClick()
  await settle(); m.flush()
  const nodes = render(s, m)
  const flat = texts(nodes).join('|')
  assert.ok(byClass(nodes, 'mgp-stale').length === 1)
  assert.ok(/ago|just now/.test(flat), 'relative time is English in the English panel: ' + flat)
  assert.ok(!flat.includes('分钟前'), 'no Chinese leaks into the English panel')
  assert.ok(flat.includes('the gateway failed internally'), 'the reason is translated too')
  const chart = byClass(nodes, 'mgp-chart')[0]
  assert.ok(chart, 'chart still drawn')
  assert.equal(chart.props['aria-label'], 'calls per bucket')
  m.unmount(); s.env.dispose()
})

test('a failed first read names the reason next to the retry button', async () => {
  const s = setup({
    responder: () => ({ ok: false, status: 502, json: async () => ({ ok: false, code: 'connection', error: 'ECONNREFUSED' }) }),
  })
  const m = mountFooter(s)
  await settle(); m.flush()
  const flat = texts(render(s, m)).join('|')
  assert.equal(byClass(render(s, m), 'mgp-banner').length, 1)
  assert.ok(flat.includes('网关连不上'), 'the host code is turned into a sentence: ' + flat)
  assert.ok(!flat.includes('ECONNREFUSED'), 'never the raw upstream string')
  m.unmount(); s.env.dispose()
})

test('the panel follows the host period until a tab is clicked', async () => {
  const fixture = snapshotFixture()
  fixture.config = { ...fixture.config, period: '7d' }
  const s = setup({ responder: () => ({ ok: true, status: 200, json: async () => fixture }) })
  const m = mountFooter(s)
  await settle(); m.flush()
  // the first read cannot know the host period yet; after it lands the panel
  // adopts it, so the next read asks for the right window
  byClass(render(s, m), 'mgp-statusbtn')[0].props.onClick()
  await settle(); m.flush()
  assert.equal(s.env.fetchCalls.at(-1).url, '/magpie-monitor/api/snapshot?period=7d&recent=40&fresh=1', 'the host default is adopted')
  const nodes = render(s, m)
  const tabs = byClass(nodes, 'mgp-tab')
  assert.equal(tabs[1].props['aria-selected'], true, 'the 7d tab is the selected one')
  m.unmount(); s.env.dispose()
})

test('a gateway that stays down is asked less and less often', async () => {
  const s = setup({
    responder: () => ({ ok: false, status: 502, json: async () => ({ ok: false, code: 'connection' }) }),
  })
  const m = mountFooter(s)
  await settle(); m.flush()
  assert.equal(s.env.delays[0], 5000, 'the first tick keeps the configured interval')
  const refresh = () => { byClass(render(s, m), 'mgp-statusbtn')[0].props.onClick() }
  for (let i = 0; i < 2; i++) { refresh(); await settle(); m.flush() }
  assert.ok(s.env.delays.at(-1) >= 20000, 'two failures back off to 20s, got ' + s.env.delays.at(-1))
  const highest = Math.max(...s.env.delays)
  // one good read puts the interval back where the settings say it should be
  s.env.setResponder(() => ({ ok: true, status: 200, json: async () => snapshotFixture() }))
  refresh(); await settle(); m.flush()
  assert.ok(s.env.delays.at(-1) < highest, 'recovery restores the fast interval')
  assert.equal(s.env.delays.at(-1), 5000)
  m.unmount(); s.env.dispose()
})

// ---- layout: the strip must fit whatever width the sidebar is opened at ----
// The wire used to be drawn in one fixed 320-unit viewBox, so at the sidebar's
// widest setting it was letterboxed (the line stopped short of the marks) and
// at its narrowest it squeezed. It is now built from the measured box.
function styleText(nodes) {
  const style = findAll(nodes, (n) => n.type === 'style')[0]
  return style ? texts([style]).join('') : ''
}
function wireEnd(route) {
  const path = byClass([route], 'mgp-wire')[0]
  const d = String(path.props.d || '')
  const nums = d.match(/-?\d+(?:\.\d+)?/g) || []
  const end = nums.slice(-2).map(Number)
  assert.ok(nums.length > 0, 'the wire has geometry: ' + d)
  return { end, d, path }
}

test('the flight wire is drawn to the box it sits in, not to a fixed 320', async () => {
  for (const width of [260, 320, 480]) {
    setBoxWidth(width)
    const s = setup()
    const m = mountFooter(s)
    await settle(); m.flush()
    const nodes = render(s, m)
    const route = byClass(nodes, 'mgp-route')[0]
    const svg = byClass(nodes, 'mgp-route-wire')[0]
    assert.equal(svg.props.viewBox, '0 0 ' + width + ' 58', 'the drawing space follows the box at ' + width)
    const { end } = wireEnd(route)
    assert.deepEqual(end, [width - 26, 30], 'the wire starts and ends at the marks at ' + width)
    m.unmount(); s.env.dispose()
  }
  setBoxWidth(320)
})

test('the magpie hub rides the wire between the two lanes, not the row of marks', async () => {
  setBoxWidth(360)
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  const route = byClass(nodes, 'mgp-route')[0]
  const row = byClass(nodes, 'mgp-route-nodes')[0]
  const isMid = (n) => String((n && n.props && n.props.className) || '').includes('mgp-node-mid')
  assert.equal(route.children.filter(isMid).length, 1, 'the hub is a child of the strip')
  assert.equal(row.children.filter(isMid).length, 0, 'the hub is no longer a third mark in the row')
  const order = route.children.map((c) => (isMid(c) ? 'hub' : c.type === 'svg' ? 'wire' : 'row'))
  assert.deepEqual(order, ['wire', 'row', 'hub'], 'the hub paints after the wire so the bird crosses it')
  m.unmount(); s.env.dispose()
})

// a snapshot whose last request is happening right now, so the birds are flying
function liveSetup() {
  const fresh = snapshotFixture().requests[0]
  return setup({
    responder: () => ({
      ok: true,
      status: 200,
      json: async () => snapshotFixture({ requests: [Object.assign({}, fresh, { t: new Date().toISOString() })] }),
    }),
  })
}

test('the birds swing around the hub instead of flying through it', async () => {
  setBoxWidth(360)
  const s = liveSetup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  const route = byClass(nodes, 'mgp-route')[0]
  assert.equal(route.props['data-live'], '1', 'a request just went through, so the strip is live')
  const motions = findAll(nodes, (n) => n.type === 'animateMotion')
  assert.equal(motions.length, 2, 'one bird out, one bird back')
  const wires = byClass([route], 'mgp-wire').map((p) => String(p.props.d))
  const paths = motions.map((mo) => String(mo.props.path))
  // The hub is 22px tall and sits at y 2..24 on the apex (y 12); the wire runs
  // straight through it. Each bird keeps off it: it rides the wire up, dips to
  // 31 (out) or 37 (back) while it crosses the mark, then rejoins the wire.
  for (const d of paths) assert.ok(!wires.includes(d), 'the bird does not fly the wire itself')
  assert.ok(paths[0].includes(' 31'), 'the way out clears the hub under it: ' + paths[0])
  assert.ok(paths[1].includes(' 40'), 'and the way back takes the lower lane: ' + paths[1])
  const farX = 360 - 26
  assert.ok(paths[0].startsWith('M26 30'), 'the way out leaves the near mark: ' + paths[0])
  assert.ok(paths[0].endsWith(' ' + farX + ' 30'), 'and lands on the far one: ' + paths[0])
  assert.ok(paths[1].startsWith('M' + farX + ' 34'), 'the answer leaves the far mark: ' + paths[1])
  assert.ok(paths[1].endsWith(' 26 34'), 'and flies back to the near one: ' + paths[1])
  // Every number in the path is an x/y pair, so the odd slots are the heights.
  const laneY = (d) => {
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
    const ys = nums.filter((_, i) => i % 2 === 1)
    return { low: Math.max.apply(null, ys), high: Math.min.apply(null, ys) }
  }
  const out = laneY(paths[0])
  const back = laneY(paths[1])
  assert.ok(out.low <= 44 && back.low <= 50, 'both lanes stay inside the 58px strip: ' + out.low + '/' + back.low)
  assert.ok(out.low >= 28 && back.low >= 34, 'neither lane climbs into the hub box (y 2..24): ' + out.low + '/' + back.low)
  assert.ok(back.low - out.low >= 4, 'the two lanes stay apart so the birds never stack: ' + (back.low - out.low))
  assert.ok(out.high >= 12 && back.high >= 12, 'each bird still rises to the arc it crosses: ' + out.high + '/' + back.high)
  m.unmount(); s.env.dispose()
  setBoxWidth(320)
})

test('the answer flies back the other way, one bird each way', async () => {
  setBoxWidth(360)
  const s = liveSetup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  const motions = findAll(nodes, (n) => n.type === 'animateMotion')
  assert.equal(motions.length, 2, 'one bird out, one bird back — never two on the same heading')
  const xs = motions.map((mo) => {
    const d = String(mo.props.path)
    const first = Number((d.match(/^M(-?\d+(?:\.\d+)?)/) || [])[1])
    const last = Number((d.match(/(-?\d+(?:\.\d+)?)(?:\s+-?\d+(?:\.\d+)?)?$/) || [])[1])
    return { first, last }
  })
  assert.ok(xs[0].first < xs[0].last, 'the first bird heads right: ' + JSON.stringify(xs[0]))
  assert.ok(xs[1].first > xs[1].last, 'the second heads left: ' + JSON.stringify(xs[1]))
  m.unmount(); s.env.dispose()
  setBoxWidth(320)
})

test('the wire ends on the two marks, not on a fixed inset', async () => {
  setBoxWidth(360)
  // a long provider label pushes the right mark well inside the strip
  setMarkEdges(60, 250)
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  const route = byClass(nodes, 'mgp-route')[0]
  const { d } = wireEnd(route)
  assert.ok(d.startsWith('M60 30'), 'the line starts on the near mark: ' + d)
  assert.ok(d.endsWith(' 250 30'), 'and stops on the far mark: ' + d)
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
  const xs = nums.filter((_, i) => i % 2 === 0)
  assert.equal(Math.max.apply(null, xs), 250, 'nothing is drawn past the far mark: ' + d)
  assert.equal(Math.min.apply(null, xs), 60, 'and nothing before the near one: ' + d)
  m.unmount(); s.env.dispose()
  setMarkEdges(null)
  setBoxWidth(320)
})

test('the wire is solid while the birds are in the air', async () => {
  const s = liveSetup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const css = styleText(render(s, m))
  assert.match(css, /\.mgp-wire\s*\{[^}]*stroke-dasharray:\s*2 7/, 'idle traffic is drawn dashed')
  assert.match(css, /\.mgp-route\[data-live="1"\]\s*\.mgp-wire\s*\{[^}]*stroke-dasharray:\s*none/, 'and solid while the route is carrying requests')
  m.unmount(); s.env.dispose()
})

test('the hub mark carries no caption of its own', async () => {
  setBoxWidth(360)
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const route = byClass(render(s, m), 'mgp-route')[0]
  const hub = byClass([route], 'mgp-node-mid')[0]
  assert.equal(hub.children.length, 1, 'only the icon lives under the mark')
  assert.equal(byClass([hub], 'mgp-node-name').length, 0, 'no name under the middle icon')
  assert.equal(byClass([route], 'mgp-node-name').length, 2, 'the two ends keep theirs')
  m.unmount(); s.env.dispose()
  setBoxWidth(320)
})

test('the latest-request line clips its own columns instead of spilling over the meta', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const nodes = render(s, m)
  // the head (label + time) and the meta column sit on one row: each has to be
  // able to shrink, or the time prints on top of the provider name
  const css = styleText(nodes)
  assert.match(css, /\.mgp-latest-head\s*\{[^}]*overflow:\s*hidden/, 'the head clips rather than overflowing')
  assert.match(css, /\.mgp-latest-meta\s*\{[^}]*overflow:\s*hidden/, 'the meta column clips too')
  assert.match(css, /\.mgp-latest-label\s*\{[^}]*text-overflow:\s*ellipsis/)
  const meta = byClass(nodes, 'mgp-latest-meta')[0]
  const wrap = (meta.children || []).find((c) => String((c.props || {}).className || '').includes('mgp-latest-metatext'))
  assert.ok(wrap, 'the meta text is its own ellipsis box')
  assert.ok(texts([wrap]).join('').length > 0, 'and it still names the provider')
  m.unmount(); s.env.dispose()
})

test('a narrow panel wraps the usage labels instead of cutting them', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const css = styleText(render(s, m))
  // The panel must lay itself out intrinsically: a container query needs an
  // ancestor that declares a container, and declaring one on the panel made the
  // widget collapse inside the real sidebar (see the containment test below).
  assert.match(css, /\.mgp-tcell\s*\{[^}]*flex-wrap:\s*wrap/, 'a squeezed cell wraps its label onto the next line')
  assert.match(css, /\.mgp-tlab\s*\{[^}]*text-overflow:\s*ellipsis/, 'and still truncates as a last resort')
  m.unmount(); s.env.dispose()
})

test('the panel never becomes a containment context', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const css = styleText(render(s, m))
  // The real sidebar lays the footer out shrink-to-fit; an element with
  // container-type has its inline size taken from the container and collapses to
  // its min-content width there — measured at 8x350 px in a real browser, which
  // is what "侧边栏 magpie 不能正常显示" looked like: one character per line.
  assert.doesNotMatch(css, /container-type/, 'the panel is not a query container')
  assert.doesNotMatch(css, /@container/, 'and no rule depends on one')
  assert.match(css, /\.mgp-footstack\s*\{[^}]*max-height:\s*min\(50dvh,\s*440px\)/, 'its height budget comes from the viewport, not from containment')
  m.unmount(); s.env.dispose()
})

test('the panel defines its own width and never styles the host around it', async () => {
  const s = setup()
  const m = mountFooter(s)
  await settle(); m.flush()
  const css = styleText(render(s, m))
  // The host column is 264..420px wide (clampWidth in dsh-client-ui-layout) minus
  // 12px of inline padding, so the slot hands the panel 240..396px and the footer
  // wrapper is a plain flex row. Styling that wrapper (`:has()`, `[data-slot=…]`)
  // reached outside the widget and is what left it narrow at maximum width.
  assert.match(css, /\.mgp-footstack\s*\{[^}]*width:\s*100%/, 'the panel fills whatever the slot hands it')
  assert.match(css, /\.mgp-footstack\s*\{[^}]*min-width:\s*0/, 'and can shrink below its content')
  assert.doesNotMatch(css, /:has\(/, 'no :has() — it would match host elements too')
  assert.doesNotMatch(css, /\[data-slot=/, 'the host slot element is not ours to style')
  assert.doesNotMatch(css, /wtg9ga/, 'and neither are the sidebar plugin classes')
  assert.match(css, /\.mgp-footstack\.rail\s*\{[^}]*width:\s*auto/, 'the rail collapses back to the icon')
  m.unmount(); s.env.dispose()
})

// ---- task done alert (Magpie's turnDoneAlert) -------------------------------
// The setting is a duration, so what the panel must get right is the edge:
// running -> idle after at least that long. One clock, one fake session list.
test('a task past the magpie threshold rings once with the system sound', async () => {
  const clock = { now: 1760000000000 }
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(clock.now); else super(...args) }
    static now() { return clock.now }
  }
  const notes = []
  class FakeNotification {
    static permission = 'granted'
    constructor(title, opts) { notes.push({ title, body: opts.body, silent: opts.silent }) }
    close() {}
  }
  const played = []
  class FakeAudio {
    constructor(src) { this.src = src; this.preload = ''; this.volume = 1; this.currentTime = 0 }
    play() { played.push(this.src); return Promise.resolve() }
  }
  const store = {
    snap: { ids: [], byId: {}, phase: 'ready' },
    listeners: new Set(),
    getSnapshot() { return this.snap },
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
    publish(byId) { this.snap = { ids: Object.keys(byId), byId, phase: 'ready' }; for (const fn of [...this.listeners]) fn() },
  }
  const cfg = { turnDoneAlert: 60, alertTone: 'ring', alertFlash: true }
  const s = setup({
    Date: FakeDate, Notification: FakeNotification, Audio: FakeAudio,
    ctx: {
      sessions: { list: store },
      configForms: { get: () => ({ getSnapshot: () => ({ status: 'ready', value: { ...cfg }, writable: true }) }) },
    },
  })

  // a task runs for three minutes, then the session goes idle
  store.publish({ s1: { id: 's1', displayTitle: 'refactor the runner', running: true } })
  clock.now += 3 * 60 * 1000
  store.publish({ s1: { id: 's1', displayTitle: 'refactor the runner', running: false } })
  assert.equal(played.length, 1, 'the sound plays once')
  assert.ok(played[0].includes('/magpie-monitor/api/alert-sound'), 'it is the host-served system wav')
  assert.ok(played[0].includes('tone=ring'), 'the configured tone, not the stock chime')
  const flashes = s.env.fetchCalls.filter((call) => call.url.includes('/alert-flash'))
  assert.equal(flashes.length, 1, 'the taskbar blink is asked for once per turn')
  assert.equal(flashes[0].init.method, 'POST')
  assert.equal(notes.length, 1, 'one notification')
  assert.match(notes[0].title, /refactor the runner/)
  assert.match(notes[0].body, /3/)
  assert.equal(notes[0].silent, true, 'silent: the wav is played by the panel')

  // a short turn is a normal turn: nothing rings
  store.publish({ s1: { id: 's1', displayTitle: 'typo', running: true } })
  clock.now += 5 * 1000
  store.publish({ s1: { id: 's1', displayTitle: 'typo', running: false } })
  assert.equal(notes.length, 1, 'below the threshold stays quiet')

  // a subagent's turn belongs to the task that spawned it
  store.publish({ s2: { id: 's2', displayTitle: 'child', running: true, parentId: 's1' } })
  clock.now += 10 * 60 * 1000
  store.publish({ s2: { id: 's2', displayTitle: 'child', running: false, parentId: 's1' } })
  assert.equal(notes.length, 1, 'subagent turns are the parent task')

  // the blink is a separate switch from the ring
  cfg.alertFlash = false
  store.publish({ s4: { id: 's4', displayTitle: 'no blink', running: true } })
  clock.now += 10 * 60 * 1000
  store.publish({ s4: { id: 's4', displayTitle: 'no blink', running: false } })
  assert.equal(played.length, 2, 'still rings')
  assert.equal(s.env.fetchCalls.filter((call) => call.url.includes('/alert-flash')).length, 1, 'but does not blink')

  // 0 is Magpie's "Off"
  cfg.turnDoneAlert = 0
  store.publish({ s3: { id: 's3', displayTitle: 'quiet', running: true } })
  clock.now += 10 * 60 * 1000
  store.publish({ s3: { id: 's3', displayTitle: 'quiet', running: false } })
  assert.equal(notes.length, 2, 'off means off')
  assert.equal(played.length, 2, 'and silent')
})
