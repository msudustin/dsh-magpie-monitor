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
    { route_id: 'r3', t: 1763173200000, agent: 'cc', provider: 'p', model: 'frontier-1', req: 'group/z', served: 'frontier-1', in: 1, out: 2, ms: 500, status: 200, cost: 0, priced: false },
  ],
}

function makeGateway(opts = {}) {
  const calls = []
  const fail = opts.fail || {}
  const hang = opts.hang || {}
  // Ports that refuse every call, so a discovery retry can be observed.
  const deadPorts = new Set(opts.deadPorts || [])
  const fetchImpl = (url, init) => {
    const u = String(url)
    const parsed = new URL(u)
    const p = parsed.pathname
    calls.push({ url: u, path: p, query: parsed.searchParams, init })
    if (deadPorts.has(parsed.port)) {
      const err = new Error('connect ECONNREFUSED ' + parsed.host)
      err.name = 'TypeError'
      err.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      return Promise.reject(err)
    }
    if (hang[p]) {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    if (fail[p]) {
      const err = new Error(fail[p])
      if (fail[p].startsWith('ECONNREFUSED')) err.name = 'TypeError'
      return Promise.reject(err)
    }
    const failStatus = opts.failStatus || {}
    if (failStatus[p] !== undefined) {
      const status = failStatus[p]
      return Promise.resolve({
        ok: false, status,
        json: async () => ({ error: { message: 'boom' } }),
        text: async () => JSON.stringify({ error: { message: 'boom' } }),
      })
    }
    let body
    if (p === '/') body = rootFixture
    else if (p === '/v1/magpie/usage') body = usageFixture(parsed.searchParams.get('period') || '30d')
    else if (p === '/v1/magpie/quotas') body = quotasFixture
    else if (p === '/v1/magpie/quotas/history') body = historyFixture
    else if (p === '/v1/magpie/statusline') body = 'magpie · ok'
    else if (p === '/v1/magpie/usage/requests') body = requestsFixture
    else if (p === '/v1/magpie/route') body = { route: { id: 'r', status: 200 }, seq: 1, session: parsed.searchParams.get('session') }
    else if (p === '/v1/models') body = { data: [] }
    else return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => 'not found' })
    const isText = p === '/v1/magpie/statusline'
    const payload = { ok: true, status: 200, json: async () => body, text: async () => (isText ? body : JSON.stringify(body)) }
    // A small delay keeps a read visibly in flight, which is when sharing and
    // cancellation actually happen.
    const wait = (opts.delay || {})[p]
    if (wait) return new Promise((resolve) => setTimeout(() => resolve(payload), wait))
    return Promise.resolve(payload)
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

function makeReq(url, method = 'GET', headers = {}) {
  const listeners = {}
  return {
    method, url,
    // A same-origin request from the harness page looks like this.
    headers: { host: '127.0.0.1:12097', origin: 'http://127.0.0.1:12097', ...headers },
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
  const raw = await callRaw(route, req)
  return { status: raw.status, headers: raw.headers, json: JSON.parse(raw.body) }
}
async function callRaw(route, req) {
  const res = makeRes()
  await route.handler(req, res)
  return { status: res.statusCode, headers: res.headers, body: res.body }
}

async function loadHost(config = {}, gatewayOpts = {}) {
  const gateway = makeGateway(gatewayOpts)
  const gatewayJson = gatewayOpts.gatewayJson ?? null
  const wav = gatewayOpts.wav ?? null
  const fsReads = []
  const env = gatewayOpts.env ?? {}
  const spawns = []
  const sandbox = {
    console, URL, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout,
    Date, Math, JSON, Number, String, Object, Array, Promise, Set, Map, Error,
    encodeURIComponent, isNaN, fetch: gateway.fetchImpl,
    process: { env, platform: gatewayOpts.platform ?? 'win32' },
  }
  const context = vm.createContext(sandbox)
  const mod = new vm.SourceTextModule(source, { context })
  const z = makeZ()
  await mod.link((specifier) => {
    if (specifier === '@deepseek-ai/schemastery') {
      return new vm.SyntheticModule(['default'], function () { this.setExport('default', z) }, { context })
    }
    if (specifier === 'node:fs') {
      return new vm.SyntheticModule(['default'], function () {
        this.setExport('default', {
          readFileSync(file) {
            fsReads.push(String(file))
            const name = String(file)
            if (wav && /.wav$/i.test(name)) return wav
            if (gatewayJson === null) throw new Error('no gateway.json in tests')
            if (!name.includes('gateway.json')) throw new Error('ENOENT: ' + name)
            return JSON.stringify(gatewayJson)
          },
        })
      }, { context })
    }
    if (specifier === 'node:os') {
      return new vm.SyntheticModule(['default'], function () { this.setExport('default', { homedir: () => 'C:\\test' }) }, { context })
    }
    if (specifier === 'node:path') {
      return new vm.SyntheticModule(['default'], function () {
        this.setExport('default', {
          join: (...parts) => parts.join('\\'),
          dirname: (value) => String(value).split('\\').slice(0, -1).join('\\'),
        })
      }, { context })
    }
    if (specifier === 'node:child_process') {
      return new vm.SyntheticModule(['spawn'], function () {
        this.setExport('spawn', (command, args, options) => {
          spawns.push({ command, args, options })
          return { on() {}, kill() {}, unref() {} }
        })
      }, { context })
    }
    if (specifier === 'node:url') {
      return new vm.SyntheticModule(['fileURLToPath'], function () {
        this.setExport('fileURLToPath', (value) => String(value))
      }, { context })
    }
    throw new Error('unexpected import: ' + specifier)
  })
  await mod.evaluate()
  const fake = makeCtx()
  mod.namespace.apply(fake.ctx, config)
  return { ...fake, gateway, config, fsReads, spawns }
}

// A wav-shaped buffer with a real length: the Host ignores anything too short
// to hold a header plus one sample.
const fakeWav = () => Buffer.concat([Buffer.from('RIFF0000WAVEfmt '), Buffer.alloc(84)])

const ALERT = '/magpie-monitor/api/alert-sound'
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
  // `limit` belongs to /usage/requests, not /usage: per-endpoint rules keep it out.
  assert.equal(call0.query.get('limit'), null)
  assert.equal(call0.query.get('evil'), null)
  const requests = await call(h.routes.get(DATA), makeReq(DATA + '?path=requests&limit=3&offset=2'))
  assert.equal(requests.status, 200)
  const call1 = h.gateway.calls.at(-1)
  assert.equal(call1.query.get('limit'), '3')
  assert.equal(call1.query.get('offset'), '2')
  const unknown = await call(h.routes.get(DATA), makeReq(DATA + '?path=../../etc'))
  assert.equal(unknown.status, 400)
  const post = await call(h.routes.get(DATA), makeReq(DATA + '?path=usage', 'POST'))
  assert.equal(post.status, 405)
  // /route needs a session id: refuse it locally instead of asking the gateway.
  const noSession = await call(h.routes.get(DATA), makeReq(DATA + '?path=route'))
  assert.equal(noSession.status, 400)
  assert.match(noSession.json.error, /missing required query: session/)
  const withSession = await call(h.routes.get(DATA), makeReq(DATA + '?path=route&session=abc'))
  assert.equal(withSession.status, 200)
  assert.equal(h.gateway.calls.at(-1).query.get('session'), 'abc')
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

test('a request stamp survives whichever shape the gateway sends', async () => {
  const h = await loadHost()
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  const b = r.json
  // the endpoint sends ISO text; its own request table sends epoch milliseconds.
  // Either way the client must receive something it can parse, or the row time,
  // the freshness dot and the flight strip all go dead.
  assert.equal(b.requests[0].t, '2026-11-15T12:00:00+08:00')
  assert.match(b.requests[2].t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(Date.parse(b.requests[2].t), 1763173200000)
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

test('the requests read is scoped to the selected period', async () => {
  // /usage/requests measures speeds and channels per window; asking without a
  // period silently widens them to the gateway's default window.
  const h = await loadHost()
  await call(h.routes.get(SNAP), makeReq(SNAP + '?period=7d'))
  const reqCall = h.gateway.calls.find((c) => c.path === '/v1/magpie/usage/requests')
  assert.equal(reqCall.query.get('period'), '7d')
  const usageCall = h.gateway.calls.find((c) => c.path === '/v1/magpie/usage')
  assert.equal(usageCall.query.get('period'), '7d')
})

test('optional endpoint failure becomes a problem, usage survives', async () => {
  const h = await loadHost({}, { fail: { '/v1/magpie/quotas': 'provider timeout' } })
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.quotas, [])
  assert.equal(r.json.usage.calls, 829)
  assert.ok(r.json.problems.some((p) => p.what === '额度' && typeof p.message === 'string' && p.message.length > 0),
    'the failed endpoint is reported with a structured problem')
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
  assert.equal(h.routes.size, 5)
  assert.equal(h.tools.size, 1)
  for (const d of h.disposers) d()
  assert.equal(h.routes.size, 0)
  assert.equal(h.tools.size, 0)
})

// ---------------------------------------------------------------------------
// v1.4: request trust, gateway discovery, failure classification
// ---------------------------------------------------------------------------

test('routes refuse a request that is not same-machine', async () => {
  const h = await loadHost()
  const foreign = await call(h.routes.get(SNAP), makeReq(SNAP, 'GET', { host: 'evil.example.com' }))
  assert.equal(foreign.status, 403)
  assert.match(foreign.json.error, /unexpected host/)

  const crossSite = await call(h.routes.get(SNAP), makeReq(SNAP, 'GET', { 'sec-fetch-site': 'cross-site' }))
  assert.equal(crossSite.status, 403)
  assert.match(crossSite.json.error, /cross-site/)

  const mismatch = await call(h.routes.get(SNAP), makeReq(SNAP, 'GET', { origin: 'http://evil.example.com' }))
  assert.equal(mismatch.status, 403)
  assert.match(mismatch.json.error, /origin mismatch/)

  // A refusal must happen before any network call.
  assert.equal(h.gateway.calls.length, 0)

  for (const route of [CONF, DATA]) {
    const r = await call(h.routes.get(route), makeReq(route, 'GET', { host: 'evil.example.com' }))
    assert.equal(r.status, 403)
  }
  assert.equal(h.gateway.calls.length, 0)
})

test('a same-origin request without an Origin header is allowed', async () => {
  const h = await loadHost()
  const r = await call(h.routes.get(SNAP), makeReq(SNAP, 'GET', { origin: undefined }))
  assert.equal(r.status, 200)
})

test('snapshot reports a classified failure instead of a raw stack', async () => {
  const h = await loadHost({}, { fail: { '/v1/magpie/usage': 'ECONNREFUSED 127.0.0.1:3425' } })
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 502)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.code, 'connection')
  assert.match(r.json.error, /连不上 Magpie 网关/)
})

test('a timeout is classified separately from a refused connection', async () => {
  const h = await loadHost({}, { fail: { '/v1/magpie/usage': 'The operation timed out' } })
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 502)
  assert.equal(r.json.code, 'timeout')
})

test('discovery finds a moved gateway port and remembers it', async () => {
  // The configured URL refuses; gateway.json points at 4599, which answers.
  const h = await loadHost(
    { gatewayUrl: 'http://127.0.0.1:3425' },
    { deadPorts: ['3425'], gatewayJson: { addr: '127.0.0.1:4599', pid: 1, version: '0.1.0' } },
  )
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 200)
  assert.equal(r.json.gateway, 'http://127.0.0.1:4599')
  assert.equal(r.json.usage.calls, 829)
  // The dead port was tried first, then the discovered one.
  assert.ok(h.gateway.calls.some((c) => c.url.includes(':3425')))
  assert.ok(h.gateway.calls.some((c) => c.url.includes(':4599')))
})

test('the env variable wins over gateway.json', async () => {
  const h = await loadHost(
    { gatewayUrl: 'http://127.0.0.1:3425' },
    {
      deadPorts: ['3425', '4599'],
      env: { MAGPIE_URL: 'http://127.0.0.1:7777' },
      gatewayJson: { addr: '127.0.0.1:4599' },
    },
  )
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 200)
  assert.equal(r.json.gateway, 'http://127.0.0.1:7777')
})

test('discover=false keeps the configured URL as the only candidate', async () => {
  const h = await loadHost(
    { discover: false },
    { deadPorts: ['3425'], gatewayJson: { addr: '127.0.0.1:4599' } },
  )
  const r = await call(h.routes.get(SNAP), makeReq(SNAP))
  assert.equal(r.status, 502)
  assert.equal(r.json.code, 'connection')
  assert.equal(h.gateway.calls.every((c) => c.url.startsWith('http://127.0.0.1:3425')), true)
})

test('an HTTP error is not retried on another candidate', async () => {
  const h = await loadHost(
    { gatewayUrl: 'http://127.0.0.1:3425' },
    { gatewayJson: { addr: '127.0.0.1:4599' }, failStatus: { '/v1/magpie/usage': 500 } },
  )
  // The gateway answers 500: the base is alive, so another base would be noise.
  const before = h.gateway.calls.length
  const r = await call(h.routes.get(DATA), makeReq(DATA + '?path=usage'))
  assert.equal(r.status, 502)
  assert.equal(r.json.code, 'server_error')
  assert.equal(h.gateway.calls.length, before + 1)
})

test('config exposes the discovery switch', async () => {
  const h = await loadHost()
  const r = await call(h.routes.get(CONF), makeReq(CONF))
  assert.equal(r.json.config.discover, true)
})

// ---- shared reads, cancellation and discovery cost -------------------------

test('concurrent snapshot calls share one gateway read', async () => {
  const h = await loadHost({}, { delay: { '/v1/magpie/usage': 20 } })
  const route = h.routes.get(SNAP)
  const [a, b] = await Promise.all([
    call(route, makeReq(SNAP + '?period=today')),
    call(route, makeReq(SNAP + '?period=today')),
  ])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.deepEqual(a.json.usage.calls, b.json.usage.calls)
  const usageReads = h.gateway.calls.filter((c) => c.path === '/v1/magpie/usage').length
  assert.equal(usageReads, 1, 'the panel tick, a manual refresh and the tool must not each open a read')
})

test('a caller that leaves does not cancel a read another caller is sharing', async () => {
  const h = await loadHost({}, { delay: { '/v1/magpie/usage': 25 } })
  const route = h.routes.get(SNAP)
  const closing = makeReq(SNAP)
  const first = call(route, closing)
  const second = call(route, makeReq(SNAP))
  closing.emit('close') // the panel closes; the agent tool is still waiting
  const [left, kept] = await Promise.all([first, second])
  assert.equal(left.status, 502)
  assert.equal(left.json.code, 'aborted', 'the caller that left is told it was interrupted')
  assert.equal(kept.status, 200, 'the remaining caller still gets its answer')
  assert.equal(kept.json.ok, true)
  assert.equal(h.gateway.calls.filter((c) => c.path === '/v1/magpie/usage').length, 1)
})

test('the alert sound is the machine wav, served behind the same gate', async () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60, 7)])
  const h = await loadHost({}, { wav })
  assert.ok(h.routes.has(ALERT), 'the route is registered')

  const ok = await callRaw(h.routes.get(ALERT), makeReq(ALERT))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['content-type'], 'audio/wav')
  assert.equal(ok.headers['content-length'], String(wav.length))
  assert.equal(ok.body.equals(wav), true, 'the bytes are the wav itself')

  const head = await callRaw(h.routes.get(ALERT), makeReq(ALERT, 'HEAD'))
  assert.equal(head.status, 200)
  assert.equal(head.body, undefined, 'HEAD answers headers only')

  const foreign = await callRaw(h.routes.get(ALERT), makeReq(ALERT, 'GET', { host: 'evil.example.com' }))
  assert.equal(foreign.status, 403, 'a foreign host never gets the file')

  const posted = await callRaw(h.routes.get(ALERT), makeReq(ALERT, 'POST'))
  assert.equal(posted.status, 405)
})

test('no wav on the machine is a named failure, not an empty sound', async () => {
  const h = await loadHost({})
  const res = await call(h.routes.get(ALERT), makeReq(ALERT))
  assert.equal(res.status, 404)
  assert.equal(res.json.code, 'no_sound')
  // the settings page needs to know, so it can say so instead of ringing nothing
  const conf = await call(h.routes.get(CONF), makeReq(CONF))
  assert.equal(conf.json.config.alertSound, false)
})

test('the threshold travels through the config as Magpie states it', async () => {
  const h = await loadHost({ turnDoneAlert: 180 })
  const conf = await call(h.routes.get(CONF), makeReq(CONF))
  assert.equal(conf.json.config.turnDoneAlert, 180)
  const huge = await loadHost({ turnDoneAlert: 1e9 })
  const clamped = await call(huge.routes.get(CONF), makeReq(CONF))
  assert.equal(clamped.json.config.turnDoneAlert, 86400, 'one day is the ceiling')
  const negative = await loadHost({ turnDoneAlert: -5 })
  const off = await call(negative.routes.get(CONF), makeReq(CONF))
  assert.equal(off.json.config.turnDoneAlert, 0, 'a negative value means off')
})

test('the detail read stops when the panel closes it', async () => {
  const h = await loadHost({}, { hang: { '/v1/magpie/quotas': true } })
  const req = makeReq(DATA + '?path=quotas')
  const started = Date.now()
  const pending = call(h.routes.get(DATA), req)
  await new Promise((r) => setTimeout(r, 10))
  req.emit('close')
  const r = await pending
  assert.equal(r.status, 502)
  // the 10 s budget would also end the read; closing the panel must end it now
  assert.ok(Date.now() - started < 2000, 'the read ends when the panel closes, not on its budget')
  const record = h.gateway.calls.find((c) => c.path === '/v1/magpie/quotas')
  assert.equal(record.init.signal.aborted, true, 'the upstream fetch goes down with the request')
})

test('a detail read that needs a parameter refuses without it', async () => {
  const h = await loadHost({})
  const missing = await call(h.routes.get(DATA), makeReq(DATA + '?path=route'))
  assert.equal(missing.status, 400)
  assert.match(missing.json.error, /session/)
  const ok = await call(h.routes.get(DATA), makeReq(DATA + '?path=route&session=abc'))
  assert.equal(ok.status, 200)
  const record = h.gateway.calls.find((c) => c.path === '/v1/magpie/route')
  assert.equal(record.query.get('session'), 'abc')
})

test('gateway.json is read once per discovery window, not once per read', async () => {
  const h = await loadHost({}, { gatewayJson: { addr: '127.0.0.1:3425', pid: 1 } })
  const route = h.routes.get(SNAP)
  await call(route, makeReq(SNAP + '?period=today'))
  await call(route, makeReq(SNAP + '?period=7d')) // a different period misses the snapshot cache
  // The alert wav is read once too, so count the discovery file itself.
  assert.equal(h.fsReads.filter((file) => /gateway\.json$/.test(file)).length, 1,
    'discovery must not put a synchronous disk read on every refresh')
})

test('a tone picks a louder system wav, behind the same gate', async () => {
  const wav = fakeWav()
  const h = await loadHost({ alertTone: 'alarm' }, { wav, gatewayJson: { url: 'http://127.0.0.1:3425' } })
  const conf = await call(h.routes.get(CONF), makeReq(CONF))
  assert.equal(conf.json.config.alertTone, 'alarm')
  assert.deepEqual(conf.json.config.alertTones, { alarm: true, ring: true, bell: true, chime: true })
  assert.equal(conf.json.config.alertFlash, true)

  const ring = await callRaw(h.routes.get(ALERT), makeReq(ALERT + '?tone=ring'))
  assert.equal(ring.status, 200)
  assert.ok(h.fsReads.some((file) => /Ring05\.wav$/.test(file)), 'the ring tone reads its own wav')

  // an unknown tone is the configured one, never an error
  const unknown = await callRaw(h.routes.get(ALERT), makeReq(ALERT + '?tone=nope'))
  assert.equal(unknown.status, 200)
  assert.ok(h.fsReads.some((file) => /Alarm01\.wav$/.test(file)), 'it fell back to the configured alarm')
})

test('the flash route starts the one fixed helper, once per gap', async () => {
  const h = await loadHost({}, { wav: fakeWav(), gatewayJson: { url: 'http://127.0.0.1:3425' } })
  const FLASH = '/magpie-monitor/api/alert-flash'
  assert.ok(h.routes.has(FLASH), 'the route is registered')

  const get = await callRaw(h.routes.get(FLASH), makeReq(FLASH))
  assert.equal(get.status, 405, 'the blink has an effect, so it is POST only')

  const ok = await call(h.routes.get(FLASH), makeReq(FLASH, 'POST'))
  assert.equal(ok.status, 200)
  assert.equal(ok.json.flashed, true)
  assert.equal(h.spawns.length, 1)
  const [spawned] = h.spawns
  assert.equal(spawned.command, 'powershell.exe')
  assert.ok(spawned.args.includes('-File'))
  assert.ok(/flash-taskbar\.ps1$/.test(spawned.args.at(-1)), 'the helper is the plugin\'s own script')
  assert.equal(spawned.options.windowsHide, true)
  assert.equal(spawned.options.shell, undefined, 'no shell, so nothing is interpolated')

  const again = await call(h.routes.get(FLASH), makeReq(FLASH, 'POST'))
  assert.equal(again.json.code, 'throttled')
  assert.equal(h.spawns.length, 1, 'one blink per gap')

  const foreign = await callRaw(h.routes.get(FLASH), makeReq(FLASH, 'POST', { host: 'evil.example.com' }))
  assert.equal(foreign.status, 403)
})

test('alertFlash=false keeps the ring and drops the blink', async () => {
  const h = await loadHost({ alertFlash: false }, { wav: fakeWav(), gatewayJson: { url: 'http://127.0.0.1:3425' } })
  const FLASH = '/magpie-monitor/api/alert-flash'
  const res = await call(h.routes.get(FLASH), makeReq(FLASH, 'POST'))
  assert.deepEqual(res.json, { ok: true, flashed: false, code: 'off' })
  assert.equal(h.spawns.length, 0, 'the sound is untouched by this switch')
})
