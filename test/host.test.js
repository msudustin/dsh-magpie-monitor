// Host integration tests for @local/dsh-magpie-monitor.
// Loads the real index.js as an ES module inside a vm context with a stubbed
// schemastery and a mock gateway fetch, then drives the registered routes and
// the agent tool through a fake cordis context. No network, no Harness imports.
//
// Run: npm test   (node --experimental-vm-modules --test --test-force-exit "test/*.test.js")

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, '..', 'index.js'), 'utf8')

// ---- chainable schemastery stub (Config is built at module evaluation) ----
function makeZ() {
  const chain = () => {
    const node = {}
    for (const m of ['default', 'volatile', 'description', 'min', 'max', 'optional']) node[m] = () => node
    return node
  }
  return {
    object: (shape) => { const n = chain(); n.shape = shape; return n },
    string: chain,
    number: chain,
    boolean: chain,
  }
}

// ---- gateway fixture ----
function usageFixture(period) {
  return {
    period, since: '2026-11-15T00:00:00+08:00', bucket: period === 'today' ? 'hour' : 'day',
    calls: 829, errors: 3, retried: 2, canceled: 0,
    input: 1000, output: 2000, cache_read: 3000, cache_write: 0, reasoning: 500,
    cost: 2.65, unpriced: 5, timed: 100, ttft_ms: 470000, decode_ms: 100000, decode_out: 4200,
    series: [
      { label: '00', time: 't0', calls: 10, errors: 1, input: 1, output: 2, cache_read: 3, cost: 0.1 },
      { label: '01', time: 't1', calls: 0, errors: 0, input: 0, output: 0, cache_read: 0, cost: 0 },
    ],
    models: [
      { id: 'm2', provider: 'p', model: 'cheap', name: 'cheap', sub: 'P', calls: 50, errors: 0, input: 1, output: 1, cache_read: 0, cost: 0.5, unpriced: 0 },
      { id: 'm1', provider: 'p', model: 'frontier-1', name: 'frontier-1', sub: 'P', calls: 10, errors: 0, input: 1, output: 2, cache_read: 3, cost: 1.5, unpriced: 0 },
    ],
  }
}
const rootFixture = { name: 'magpie', version: '0.1.4207', serves: 'tray', models: 10, pid: 4321 }
const quotasFixture = {
  data: [{
    provider: 'zcode', name: 'ZCode', kind: 'oauth', plan: 'Max', user: 'u1', alias: '134****3762',
    readAt: '2026-11-15T12:00:00+08:00',
    windows: [{ name: '5h', used: 38.552566, remaining: 61.447433, resetsAt: '2026-11-16T00:00:00+08:00', display: '1156577 / 3000000', amount: 1156577, limit: 3000000, unit: 'credits', holdsWhy: 'credits' }],
  }],
}
const historyFixture = { data: [{ provider: 'zcode', user: 'u1', lines: [{ name: '5h', points: [{ at: 'a', left: 80 }, { at: 'b', left: 61.4 }] }] }] }
const requestsFixture = {
  rows: [
    { route_id: 'r1', t: '2026-11-15T12:00:00+08:00', agent: 'qw', agentName: 'QwenWork', provider: 'zcode', providerName: 'ZCode', providerAccount: 'acct', model: 'glm-5.3', req: 'group/x', served: 'glm-5.3', in: 10, out: 20, cache_read: 30, reasoning: 5, ms: 1234, ttft_ms: 456, status: 200, cost: 0.01, priced: true, ep: 'e', access: 'a', session: 's' },
    { route_id: 'r2', t: '2026-11-15T11:00:00+08:00', agent: 'cc', provider: 'zcode', model: 'glm-5.3', req: 'group/y', in: 1, out: 2, cache_read: 0, ms: 900, ttft_ms: 300, status: 200, cost: 0.02 },
    { route_id: 'r3', t: '2026-11-15T10:00:00+08:00', agent: 'cc', provider: 'p', model: 'frontier-1', req: 'group/z', served: 'frontier-1', in: 1, out: 2, ms: 500, status: 200, cost: 0, priced: false },
  ],
}

function makeGateway(opts = {}) {
  const calls = []
  const fail = opts.fail || {}
  const hang = opts.hang || {}
  const fetchImpl = (url, init) => {
    const u = String(url)
    const parsed = new URL(u)
    const p = parsed.pathname
    calls.push({ url: u, path: p, query: parsed.searchParams, init })
    if (hang[p]) {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    if (fail[p]) return Promise.reject(new Error(fail[p]))
    let body
    if (p === '/') body = rootFixture
    else if (p === '/v1/magpie/usage') body = usageFixture(parsed.searchParams.get('period') || '30d')
    else if (p === '/v1/magpie/quotas') body = quotasFixture
    else if (p === '/v1/magpie/quotas/history') body = historyFixture
    else if (p === '/v1/magpie/statusline') body = 'magpie · ok'
    else if (p === '/v1/magpie/usage/requests') body = requestsFixture
    else if (p === '/v1/models') body = { data: [] }
    else return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => 'not found' })
    const isText = p === '/v1/magpie/statusline'
    return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => (isText ? body : JSON.stringify(body)) })
  }
  return { fetchImpl, calls }
}

// ---- fake cordis context ----
function makeCtx() {
  const routes = new Map()
  const tools = new Map()
  const disposers = []
  const warnings = []
  const ctx = {
    inject(services, cb) {
      const sub = {
        logger: { warn: (...a) => warnings.push(a.join(' ')) },
        effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
        webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
        tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name) } },
      }
      cb(sub)
    },
  }
  return { ctx, routes, tools, disposers, warnings }
}

function makeReq(url, method = 'GET') {
  const listeners = {}
  return {
    method, url,
    on(evt, cb) { (listeners[evt] ||= []).push(cb); return this },
    emit(evt) { for (const cb of listeners[evt] || []) cb() },
  }
}
function makeRes() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    end(payload) { this.body = payload },
  }
}
async function call(route, req) {
  const res = makeRes()
  await route.handler(req, res)
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) }
}

async function loadHost(config = {}, gatewayOpts = {}) {
  const gateway = makeGateway(gatewayOpts)
  const sandbox = {
    console, URL, URLSearchParams, AbortController, AbortSignal,
    Date, Math, JSON, Number, String, Object, Array, Promise, Set, Map, Error,
    encodeURIComponent, isNaN, fetch: gateway.fetchImpl,
  }
  const context = vm.createContext(sandbox)
  const mod = new vm.SourceTextModule(source, { context })
  const z = makeZ()
  await mod.link((specifier) => {
    if (specifier === '@deepseek-ai/schemastery') {
      return new vm.SyntheticModule(['default'], function () { this.setExport('default', z) }, { context })
    }
    throw new Error('unexpected import: ' + specifier)
  })
  await mod.evaluate()
  const fake = makeCtx()
  mod.namespace.apply(fake.ctx, config)
  return { ...fake, gateway, config }
}

const SNAP = '/magpie-monitor/api/snapshot'
const DATA = '/magpie-monitor/api/data'
const CONF = '/magpie-monitor/api/config'

// ---------------------------------------------------------------------------

test('config route returns effective settings; POST is 405', async () => {
  const h = await loadHost()
  const ok = await call(h.routes.get(CONF), makeReq(CONF))
  assert.equal(ok.status, 200)
  assert.equal(ok.json.ok, true)
  assert.equal(ok.json.config.gatewayUrl, 'http://127.0.0.1:3425')
  assert.equal(ok.json.config.refreshMs, 5000)
  assert.equal(ok.json.config.requestLimit, 40)
  assert.equal(ok.json.config.period, 'today')
  assert.equal(ok.json.config.currency.code, 'USD')
  assert.equal(ok.headers['cache-control'], 'no-store')
  assert.equal(ok.headers['x-content-type-options'], 'nosniff')
  const bad = await call(h.routes.get(CONF), makeReq(CONF, 'POST'))
  assert.equal(bad.status, 405)
})

test('volatile config refs are unwrapped and gateway is normalized', async () => {
  const h = await loadHost({
    gatewayUrl: { get: () => 'http://127.0.0.1:9999/sub' },
    refreshMs: { get: () => 7000 },
    cnyRate: { get: () => 6.8 },
  })
  const conf = await call(h.routes.get(CONF), makeReq(CONF))
  assert.equal(conf.json.config.gatewayUrl, 'http://127.0.0.1:9999')
  assert.equal(conf.json.config.refreshMs, 7000)
  assert.equal(conf.json.config.currency.code, 'CNY')
  const snap = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(snap.status, 200)
  assert.ok(h.gateway.calls.every((c) => new URL(c.url).origin === 'http://127.0.0.1:9999'))
})

test('invalid gateway falls back to default; non-http rejected', async () => {
  const h = await loadHost({ gatewayUrl: 'ftp://example.com' })
  const conf = await call(h.routes.get(CONF), makeReq(CONF))
  assert.equal(conf.json.config.gatewayUrl, 'http://127.0.0.1:3425')
})

test('data route whitelists path keys and forwards only allowed query', async () => {
  const h = await loadHost()
  const ok = await call(h.routes.get(DATA), makeReq(DATA + '?path=usage&period=7d&limit=3&evil=1'))
  assert.equal(ok.status, 200)
  assert.equal(ok.json.key, 'usage')
  assert.equal(ok.json.data.calls, 829)
  const call0 = h.gateway.calls.at(-1)
  assert.equal(call0.query.get('period'), '7d')
  assert.equal(call0.query.get('limit'), '3')
  assert.equal(call0.query.get('evil'), null)
  const unknown = await call(h.routes.get(DATA), makeReq(DATA + '?path=../../etc'))
  assert.equal(unknown.status, 400)
  const post = await call(h.routes.get(DATA), makeReq(DATA + '?path=usage', 'POST'))
  assert.equal(post.status, 405)
})

test('snapshot merges, trims and derives metrics', async () => {
  const h = await loadHost()
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 200)
  const b = r.json
  assert.equal(b.ok, true)
  assert.equal(b.period, 'today')
  assert.equal(b.health.name, 'magpie')
  assert.equal(b.usage.calls, 829)
  assert.equal(b.usage.avgTtftMs, 4700)
  assert.equal(b.usage.avgTokensPerSecond, 42)
  assert.equal(b.usage.cacheHitPct, 75)
  assert.equal(b.usage.cost, 2.65)
  assert.equal(b.quotas[0].windows[0].used, 38.6)
  assert.equal(b.quotas[0].windows[0].remaining, 61.4)
  assert.equal(b.quotas[0].alias, '134****3762')
  assert.equal(b.history[0].lines[0].points.length, 2)
  assert.equal(b.models[0].model, 'frontier-1') // sorted by cost desc
  assert.equal(b.requests.length, 3)
  assert.equal(b.requests[1].agentName, 'cc') // fallback to agent
  assert.equal(b.requests[2].priced, false)
  assert.equal(b.statusline, 'magpie · ok')
  assert.deepEqual(b.problems, [])
  assert.ok(b.config && b.currency)
})

test('cnyRate converts every cost at one point', async () => {
  const h = await loadHost({ cnyRate: 6.8 })
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  const b = r.json
  assert.equal(b.currency.code, 'CNY')
  assert.equal(b.currency.symbol, '¥')
  assert.ok(Math.abs(b.usage.cost - 2.65 * 6.8) < 1e-9)
  assert.ok(Math.abs(b.models[0].cost - 1.5 * 6.8) < 1e-9)
  assert.ok(Math.abs(b.requests[0].cost - 0.01 * 6.8) < 1e-9)
})

test('snapshot cache shares one read within TTL; fresh=1 bypasses', async () => {
  const h = await loadHost()
  await call(h.routes.get(SNAP), makeReq(SNAP))
  const after1 = h.gateway.calls.length
  await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(h.gateway.calls.length, after1) // cache hit
  await call(h.routes.get(SNAP), makeReq(SNAP + '?fresh=1'))
  assert.ok(h.gateway.calls.length > after1) // bypassed
})

test('recent defaults to requestLimit, not 1 (null clamp regression)', async () => {
  const h = await loadHost()
  await call(h.routes.get(SNAP), makeReq(SNAP))
  const reqCall = h.gateway.calls.find((c) => c.path === '/v1/magpie/usage/requests')
  assert.equal(reqCall.query.get('limit'), '40')
  const h2 = await loadHost()
  await call(h2.routes.get(SNAP), makeReq(SNAP + '?recent=2'))
  const rc2 = h2.gateway.calls.find((c) => c.path === '/v1/magpie/usage/requests')
  assert.equal(rc2.query.get('limit'), '2')
  assert.equal((await call(h2.routes.get(SNAP), makeReq(SNAP + '?recent=2&fresh=1'))).json.requests.length, 2)
})

test('optional endpoint failure becomes a problem, usage survives', async () => {
  const h = await loadHost({}, { fail: { '/v1/magpie/quotas': 'provider timeout' } })
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.quotas, [])
  assert.equal(r.json.usage.calls, 829)
  assert.ok(r.json.problems.some((p) => p.startsWith('额度读取失败')))
})

test('required usage failure returns 502', async () => {
  const h = await loadHost({}, { fail: { '/v1/magpie/usage': 'gateway down' } })
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 502)
  assert.equal(r.json.ok, false)
  assert.match(r.json.error, /gateway down/)
})

test('client close aborts the in-flight snapshot', async () => {
  const h = await loadHost({}, { hang: { '/v1/magpie/usage': true } })
  const req = makeReq(SNAP)
  const pending = call(h.routes.get(SNAP), req)
  await new Promise((r) => setTimeout(r, 10))
  req.emit('close')
  const r = await pending
  assert.equal(r.status, 502)
  assert.equal(r.json.error, 'aborted')
})

test('snapshot rejects non-GET and unknown period falls back', async () => {
  const h = await loadHost({ period: '7d' })
  const post = await call(h.routes.get(SNAP), makeReq(SNAP, 'POST'))
  assert.equal(post.status, 405)
  const r = await call(h.routes.get(SNAP), makeReq(SNAP + '?period=bogus'))
  assert.equal(r.json.period, '7d')
})

test('magpie_usage tool reads the same snapshot and renders text', async () => {
  const h = await loadHost()
  const def = h.tools.get('magpie_usage')
  assert.ok(def, 'tool registered')
  assert.equal(def.parameters.additionalProperties, false)
  assert.equal(def.isConcurrencySafe(), true)
  const out = await def.execute({ recent: 2 }, { signal: new AbortController().signal })
  assert.equal(typeof out, 'string')
  assert.match(out, /Magpie 用量 · today/)
  assert.match(out, /调用 829/)
  assert.match(out, /最近 2 条请求/)
  assert.match(out, /额度/)
  assert.ok(out.includes('\n'), 'report uses real newlines')
  const rendered = def.output.render({}, out)
  assert.equal(JSON.stringify(rendered), JSON.stringify([{ type: 'text', text: out }]))
  const p = await def.execute({ period: '7d' }, {})
  assert.match(p, /Magpie 用量 · 7d/)
  assert.ok(h.gateway.calls.some((c) => c.path === '/v1/magpie/usage' && c.query.get('period') === '7d'))
})

test('tool=false skips registration', async () => {
  const h = await loadHost({ tool: false })
  assert.equal(h.tools.size, 0)
  assert.ok(h.routes.has(SNAP))
})

test('unloading disposes routes and tool', async () => {
  const h = await loadHost()
  assert.equal(h.routes.size, 3)
  assert.equal(h.tools.size, 1)
  for (const d of h.disposers) d()
  assert.equal(h.routes.size, 0)
  assert.equal(h.tools.size, 0)
})
