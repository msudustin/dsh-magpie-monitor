#!/usr/bin/env node
/**
 * Offline preview for @local/dsh-magpie-monitor.
 *
 * Borrowed from Hongcheng-LI/dsh-magpie-quota's scripts/preview.mjs: it loads
 * the real client.js in a vm sandbox, runs the real host `apply()` in-process
 * against fixture payloads, and captures the injected stylesheet, so one
 * self-contained preview.html can be opened in any browser — no DSH needed.
 *
 * Usage: node --experimental-vm-modules tools/preview.mjs [outFile]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const clientFile = process.env.MGP_CLIENT ? resolve(process.env.MGP_CLIENT) : join(root, 'client.js')
const clientSource = readFileSync(clientFile, 'utf8')
const hostSource = readFileSync(join(root, 'index.js'), 'utf8')

// ---- fixture payloads the gateway would serve ----
const now = Date.now()
// .NET writes seven fraction digits, which Date.parse rejects; the fixture keeps
// that shape so the preview exercises the same parser the panel uses live.
const isoStamp = (ms) => {
  const d = new Date(ms)
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds())}1234${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}
const hours = [40, 90, 120, 70, 30, 110, 150, 95, 60, 80, 45, 100, 130, 55]
const fixture = {
  root: { name: 'magpie', version: '0.1.4245', serves: 'tray', models: 10, pid: 26544 },
  usage: {
    period: 'today', since: '', bucket: 'hour',
    calls: 863, errors: 2, retried: 1, canceled: 0,
    input: 1200000, output: 340000, cache_read: 900000, cache_write: 12000, reasoning: 40000,
    cost: 2.65, unpriced: 3, timed: 620, ttft_ms: 5293000, decode_ms: 4074000, decode_out: 340000,
    series: hours.map((calls, i) => ({
      label: String(8 + i).padStart(2, '0'), time: '',
      calls, errors: i === 3 || i === 9 ? 1 : 0,
      input: 1000, output: 2000, cache_read: 3000, cache_write: 0, reasoning: 0,
      cost: 0.03 + i * 0.01, unpriced: 0,
    })),
  },
  quotas: {
    data: [
      {
        provider: 'qoder', name: 'Qoder', kind: 'oauth', plan: 'Pro', user: 'u1', alias: '134****3762',
        readAt: new Date(now).toISOString(),
        windows: [
          { name: '5h', used: 38.6, remaining: 61.4, resetsAt: new Date(now + 3600000).toISOString(), display: '1156577 / 3000000', amount: 1156577, limit: 3000000, unit: 'credits' },
          { name: 'Weekly', used: 72, remaining: 28, display: '7.2M / 10M', amount: 7200000, limit: 10000000, unit: 'credits' },
        ],
      },
      {
        provider: 'anthropic', name: 'Claude', kind: 'api', plan: 'Max', user: 'u2', alias: 'dev@example.com',
        readAt: new Date(now).toISOString(),
        windows: [{ name: '5h', used: 12, remaining: 88, display: '120 / 1000', amount: 120, limit: 1000, unit: 'credits' }],
      },
      {
        provider: 'zcode', name: 'ZCode', kind: 'oauth', plan: 'Team', user: 'u3', alias: '134****0000',
        readAt: new Date(now).toISOString(),
        windows: [{ name: 'Weekly', used: 94, remaining: 6, display: '9.4M / 10M', amount: 9400000, limit: 10000000, unit: 'credits' }],
      },
    ],
  },
  history: {
    data: [{
      provider: 'qoder', user: 'u1',
      lines: [{ name: '5h', points: [90, 84, 78, 72, 68, 64, 61].map((left, i) => ({ at: isoStamp(now - (7 - i) * 3600000), left })) }],
    }],
  },
  requests: {
    rows: [
      { route_id: 'r1', t: isoStamp(now - 4200), agent: 'qw', agentName: 'QwenWork', provider: 'qoder', providerName: 'Qoder', providerAccount: '134****3762', model: 'glm-5.3', req: 'group/never-stuck', served: 'glm-5.3', ms: 4200, ttft_ms: 800, in: 12000, out: 350, cache_read: 9000, reasoning: 0, status: 200, cost: 0.05, priced: true, session: 's1' },
      { route_id: 'r2', t: isoStamp(now - 9500), agent: 'cc', agentName: 'cc', provider: 'qoder', providerName: 'Qoder', providerAccount: '', model: 'claude-opus', req: 'claude-opus', served: 'glm-5.3', ms: 3100, ttft_ms: 600, in: 8000, out: 240, cache_read: 4000, reasoning: 100, status: 200, cost: 0.03, priced: true, session: 's2' },
      { route_id: 'r3', t: isoStamp(now - 26000), agent: 'cc', agentName: 'cc', provider: 'zcode', providerName: 'ZCode', providerAccount: '', model: 'gpt-5', req: 'gpt-5', served: 'gpt-5', ms: 2600, ttft_ms: 500, in: 5000, out: 180, cache_read: 2000, reasoning: 0, status: 500, cost: 0, priced: false, session: 's3' },
    ],
    speeds: [
      { model: 'glm-5.3', name: 'glm-5.3', requests: 400, tps: 83, tpsN: 71, ttftMs: 800, cost: 1.4 },
      { model: 'claude-opus', name: 'claude-opus', requests: 200, tps: 64, tpsN: 58, ttftMs: 600, cost: 0.9 },
      { model: 'gpt-5', name: 'gpt-5', requests: 120, tps: 52, tpsN: 49, ttftMs: 500, cost: 0.35 },
    ],
    channels: {
      through: { calls: 640, errors: 1, cost: 1.8 },
      direct: { calls: 223, errors: 1, cost: 0.7 },
      reported: { calls: 0, errors: 0, cost: 0 },
    },
  },
  statusline: 'magpie · 863 calls · $2.65 today',
}

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
}))

// ---- fake gateway ----
function mockGatewayFetch(url) {
  const u = new URL(url)
  const path = u.pathname
  const query = Object.fromEntries(u.searchParams.entries())
  if (path === '/v1/magpie/usage') return json(fixture.usage)
  if (path === '/') return json(fixture.root)
  if (path === '/v1/magpie/quotas') return json(fixture.quotas)
  if (path === '/v1/magpie/quotas/history') return json(fixture.history)
  if (path === '/v1/magpie/usage/requests') {
    return json({ ...fixture.requests, limit: Number(query.limit) || 40 })
  }
  if (path === '/v1/magpie/statusline') return Promise.resolve(new Response(fixture.statusline, { status: 200 }))
  return json({ error: { message: 'not found', type: 'invalid_request_error' } }, 404)
}

// ---- schemastery stub (chained .default/.volatile/.description) ----
const z = new Proxy(function () {}, {
  get: () => z,
  apply: () => z,
})

// ---- config refs shaped like the harness's volatile refs ----
const values = {
  gatewayUrl: 'http://127.0.0.1:3425', refreshMs: 5000, requestLimit: 40,
  period: 'today', cnyRate: 0, tool: true, discover: true,
}
const configRefs = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { get: () => v }]))

// ---- fake host context (webServer + tools) ----
const routes = new Map()
const registeredTools = []
const hostCtx = {
  inject(_names, fn) {
    const scope = {
      effect(fn2) { fn2(); return () => {} },
      webServer: {
        register(def) {
          routes.set(def.path, def.handler)
          return () => routes.delete(def.path)
        },
      },
      tools: { register(def) { registeredTools.push(def); return () => {} } },
      logger: { info() {}, warn() {}, error() {} },
    }
    fn(scope)
  },
  effect(fn) { return fn() },
}

async function loadHostApply() {
  const context = vm.createContext({
    console, fetch: mockGatewayFetch, AbortController, AbortSignal,
    Promise, Set, Map, Date, Math, JSON, Number, String, Object, Array, Boolean, Error, RegExp,
    encodeURIComponent, decodeURIComponent, isNaN,
    URL, Response, TextDecoder,
    process: { env: { ...process.env, MAGPIE_URL: '', MAGPIE_BASE_URL: '' } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (id) => clearTimeout(id),
  })
  const mod = new vm.SourceTextModule(hostSource, { context, identifier: 'index.js' })
  // SyntheticModule's evaluate callback runs with `this` bound to the module,
  // so it must be a function expression — an arrow function loses `this`.
  const synthetic = (spec, value) => new vm.SyntheticModule(['default'], function () {
    this.setExport('default', value)
  }, { context, identifier: spec })
  const fsShim = {
    readFileSync() {
      throw Object.assign(new Error('no gateway.json in preview'), { code: 'ENOENT' })
    },
  }
  const osShim = { homedir: () => '/nonexistent' }
  const pathShim = { join: (...parts) => parts.join('/') }
  await mod.link((spec) => {
    if (spec === '@deepseek-ai/schemastery') return synthetic(spec, z)
    if (spec === 'node:fs') return synthetic(spec, fsShim)
    if (spec === 'node:os') return synthetic(spec, osShim)
    if (spec === 'node:path') return synthetic(spec, pathShim)
    throw new Error('preview cannot resolve ' + spec)
  })
  await mod.evaluate()
  return mod.namespace.apply
}

// ---- call the real snapshot route through its real handler ----
function fakeRequest(url) {
  // The host refuses anything that does not look same-machine, so the preview
  // presents itself the way the real GUI does.
  return {
    method: 'GET', url,
    headers: { host: '127.0.0.1:12097', origin: 'http://127.0.0.1:12097' },
    header(name) { return this.headers[String(name).toLowerCase()] },
    on() { return this },
  }
}
function fakeResponse() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res },
    header(k, v) { res.headers[k.toLowerCase()] = v; return res },
    type() { return res },
    end(text) { res.body = text; return res },
    send(text) { res.body = text; return res },
  }
  return res
}
async function callRoute(path) {
  const handler = routes.get(path.split('?')[0])
  if (!handler) throw new Error('route was not registered: ' + path)
  const res = fakeResponse()
  await handler(fakeRequest(path), res)
  return { status: res.statusCode, body: res.body }
}

// ---- run the real client and capture its stylesheet ----
function captureCss(el, seen = new Set()) {
  if (!el || typeof el !== 'object' || seen.has(el)) return ''
  seen.add(el)
  if (el.type === 'style') {
    const child = [].concat(el.children || [])[0]
    if (typeof child === 'string') return child
  }
  for (const child of [].concat(el.children || [])) {
    const found = captureCss(child, seen)
    if (found) return found
  }
  // Component elements (function components and the error boundary class) carry
  // their own subtree: unwrap them so the <style> child is reachable.
  if (typeof el.type === 'function' && !seen.has(el.type)) {
    seen.add(el.type)
    try {
      const rendered = el.type.prototype && el.type.prototype.render
        ? new el.type(el.props).render()
        : el.type(el.props)
      return captureCss(rendered, seen)
    } catch {
      return ''
    }
  }
  return ''
}

function runClient(seedSnap) {
  const sandbox = {
    console, Intl, Date, Math, JSON, Number, String, Object, Array, Boolean, Promise, Set, Map,
    Error, RegExp, encodeURIComponent, decodeURIComponent, isNaN,
    setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController, AbortSignal,
    fetch: () => Promise.reject(new Error('the preview never fetches')),
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.document = { body: {}, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  sandbox.localStorage = {
    _m: new Map(),
    getItem(k) { return sandbox.localStorage._m.has(k) ? sandbox.localStorage._m.get(k) : null },
    setItem(k, v) { sandbox.localStorage._m.set(k, String(v)) },
    removeItem(k) { sandbox.localStorage._m.delete(k) },
  }
  if (seedSnap) {
    // The widget reads its cold-start snapshot from localStorage, which lets the
    // preview render real markup synchronously instead of waiting on fetch().
    sandbox.localStorage.setItem('dsh-magpie-monitor:v1', JSON.stringify({
      v: 1, savedAt: Date.now(), prefs: { period: 'today', masked: false, auto: true }, snap: seedSnap,
    }))
  }
  if (process.env.MGP_STYLE) {
    const ui = { style: process.env.MGP_STYLE, show: {} }
    sandbox.localStorage.setItem('dsh-magpie-monitor:display:v1', JSON.stringify({ v: 1, ui }))
  }
  sandbox.window.__ModuleLoader__ = { load: (def) => { sandbox.__plugin = def } }
  vm.createContext(sandbox)
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' })
  try {
    console.log('[dbg] stored', vm.runInContext("JSON.parse(localStorage.getItem('dsh-magpie-monitor:v1')).snap.usage.calls", sandbox))
    console.log('[dbg] persisted', vm.runInContext("(loadPersisted().snap ? loadPersisted().snap.usage.calls : 'NULL')", sandbox))
  } catch (err) { console.log('[dbg] probe failed', err.message) }
  const plugin = sandbox.__plugin
  if (!plugin) throw new Error('client.js did not register through __ModuleLoader__')

  // Minimal React: the preview only needs element objects so the component
  // tree can be walked for the <style> child.
  const ReactShim = {
    // React-shaped elements: children are also exposed on props.children, which
    // the error-boundary class and a few renderers read directly.
    createElement: (type, props, ...children) => {
      const flat = children.flat()
      const p = Object.assign({}, props || {})
      if (flat.length) p.children = flat.length === 1 ? flat[0] : flat
      return { type, props: p, children: flat }
    },
    Fragment: Symbol.for('react.fragment'),
    Component: class { constructor(props) { this.props = props } },
    // React invokes a lazy initializer; the preview must too, or components that
    // seed state from a function (uiStore.get, a density probe) render as blanks.
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useReducer: (r, v, init) => [typeof init === 'function' ? init(v) : (typeof v === 'function' ? v() : v), () => {}],
    useRef: (v) => ({ current: v }),
    useCallback: (fn) => fn,
    useEffect: () => {},
  }
  const clientRequire = (name) => {
    if (name === 'react') return ReactShim
    if (name === 'react-dom') return { createPortal: (el) => el }
    throw new Error('preview cannot resolve ' + name)
  }
  const applied = plugin.factory(clientRequire)

  let css = ''
  let dict = null
  let slotComponent = null
  const slots = {}
  applied.apply({
    effect(fn) { return fn() },
    locale: {
      register(ns, d) { dict = d; return () => {} },
      bind() {
        return (key, params) => {
          let text = (dict && dict.zh && dict.zh[key]) ?? key
          if (params) for (const [k, v] of Object.entries(params)) text = text.split('{' + k + '}').join(String(v))
          return text
        }
      },
      subscribe() { return () => {} },
    },
    slots: {
      inject(_owner, cb) { cb(); return () => {} },
      register(_descriptor, Component) {
        slotComponent = slotComponent || Component
        if (_descriptor && _descriptor.name) slots[_descriptor.name] = Component
        // The rail branch keeps the <style> element at the top of its own tree,
        // so rendering the narrow variant is the cheapest way to lift the css.
        css = css || captureCss(Component({ wide: false, view: 'page' }))
        return () => {}
      },
    },
  })
  if (!css) throw new Error('stylesheet capture failed')

  // ---- real markup, not a parallel mock ------------------------------------
  // The registered slot component is pure enough for a synchronous render: the
  // widgets get their snapshot from storage and hooks are single-shot shims.
  const escHtml = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])
  const styleText = (obj) => Object.entries(obj).map(([k, v]) => {
    const name = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
    return name + ':' + v
  }).join(';')
  const attrsOf = (props) => {
    let out = ''
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue
      if (k === 'children' || k === 'key' || k === 'ref' || k === 'dangerouslySetInnerHTML' || /^on[A-Z]/.test(k)) continue
      if (k === 'style') { if (v && typeof v === 'object') out += ' style="' + escHtml(styleText(v)) + '"'; continue }
      if (k === 'className') { out += ' class="' + escHtml(v) + '"'; continue }
      out += ' ' + k + '="' + escHtml(v === true ? '' : v) + '"'
    }
    return out
  }
  const renderNode = (node, depth = 0) => {
    if (node == null || node === false || node === true || depth > 400) {
      return ''
    }
    if (Array.isArray(node)) return node.map((child) => renderNode(child, depth + 1)).join('')
    if (typeof node === 'string' || typeof node === 'number') return escHtml(node)
    if (typeof node !== 'object') return ''
    if (typeof node.type === 'function') {
      let out
      try {
        out = node.type.prototype && node.type.prototype.render
          ? new node.type(node.props).render()
          : node.type(node.props)
      } catch (err) {
        return '<pre class="preview-error">' + escHtml(err && err.stack || err) + '</pre>'
      }
      return renderNode(out, depth + 1)
    }
    if (typeof node.type === 'symbol') return renderNode(node.children, depth + 1)
    if (node.type === 'style') return ''
    const kids = (node.children || []).map((child) => renderNode(child, depth + 1)).join('')
    const tag = node.type
    if (VOID_TAGS.has(tag)) return '<' + tag + attrsOf(node.props) + '>'
    return '<' + tag + attrsOf(node.props) + '>' + kids + '</' + tag + '>'
  }
  const renderSlot = (name, props) => (slots[name] ? renderNode(slots[name](props || {})) : '')
  const render = (props) => renderSlot('sidebar.footer.action', props)
  return { css, dict, render, renderSlot }
}

// ---- build the preview page ----
const apply = await loadHostApply()
apply(hostCtx, configRefs)

const snapshotRes = await callRoute('/magpie-monitor/api/snapshot?period=today&recent=40')
if (snapshotRes.status !== 200) throw new Error('snapshot route failed: ' + snapshotRes.body)
const snapshot = JSON.parse(snapshotRes.body)
console.log('[preview] host snapshot ok=%s gateway=%s calls=%d problems=%d',
  snapshot.ok, snapshot.gateway, snapshot.usage.calls, (snapshot.problems || []).length)

const { css, render, renderSlot } = runClient(snapshot)

// Real component markup for the two sidebar variants. The panel is the default
// (wide) footer; the rail is the collapsed dock. Nothing here is hand-written,
// so the preview cannot drift away from the shipped widget again.
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const panel = render({ wide: true, view: 'page' })
console.log('[preview] panel html %d bytes', panel.length)
if (process.env.MGP_DUMP) writeFileSync('.tmp_snapshot.json', JSON.stringify(snapshot, null, 1))
if (process.env.MGP_DUMP) writeFileSync('.tmp_panel.html', '<!doctype html><meta charset=utf-8><style>' + css + '</style>' + panel)
const rail = render({ wide: false, view: 'page' })
const settings = renderSlot('settings.section', {})

const ONLY = process.env.MGP_ONLY || ''
const MGP_W = process.env.MGP_W ? Number(process.env.MGP_W) : (ONLY ? 360 : 0)
const solo = (inner, max) => '<div class="frame solo" style="max-width:' + max + 'px">' + inner + '</div>'
const body = ONLY === 'panel' ? solo(panel, 420) : ONLY === 'rail' ? solo(rail, 420) : ONLY === 'settings' ? solo(settings, 1100) : `
<div class="row">
  <div class="col">
    <div class="colhead">侧栏面板 · 340px</div>
    <div class="frame" style="width:340px;max-width:100%">${panel}</div>
  </div>
  <div class="col">
    <div class="colhead">侧栏面板 · 300px（窄宽度：飞线只留图标）</div>
    <div class="frame" style="width:300px;max-width:100%">${panel}</div>
  </div>
  <div class="col">
    <div class="colhead">侧栏轨道 · 300px</div>
    <div class="frame" style="width:300px;max-width:100%">${rail}</div>
  </div>
</div>
${settings ? '<div class="colhead" style="margin-top:20px">设置页</div><div class="frame" style="max-width:1100px">' + settings + '</div>' : ''}`

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Magpie 监控 · 离线预览</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d0d0d; color: #e6e6e6; font: 13px/1.5 -apple-system, 'Segoe UI', 'PingFang SC', sans-serif; }

  h1 { font-size: 15px; margin: 0 0 4px; }
  p.note { color: #8a8a8a; font-size: 12px; margin: 0 0 16px; }
  .frame { background: #1a1a1e; border: 1px solid #2d2d32; border-radius: 12px; overflow: hidden; box-sizing: border-box; }
  .frame .mgp-footstack { max-height: none !important; overflow: visible !important; border-top: none; }
  .frame.solo { width: 100%; }
  .row { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .col { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: 100%; }
  .colhead { color: #8b8b94; font-size: 12px; letter-spacing: .02em; }
  .wrap { max-width: 760px; margin: 24px auto; padding: 0 16px; }
  .preview-error { white-space: pre-wrap; color: #f87171; font-size: 12px; margin: 0; padding: 8px; }
${ONLY ? '<style>body{overflow-x:hidden}.frame.solo{width:100%;max-width:none}</style>' : ''}
</style>
<style>
${css}
</style>
</head>
<body>

<div class="wrap"${ONLY ? ' style="width:' + MGP_W + 'px;margin:0;padding:0"' : ''}>
  <h1>Magpie 监控 · 离线预览</h1>
  <p class="note">真实 client.js 组件输出（非手写 markup） · 生成于 ${esc(new Date().toLocaleString('zh-CN'))}</p>
  ${body}
</div>
<script>
(() => {
  if (location.search.indexOf('diag') < 0) return
  const root = document.querySelector('.frame.solo') || document.querySelector('.frame')
  if (!root) return
  const box = root.getBoundingClientRect()
  const bad = []
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    const over = Math.round(r.right - box.right)
    const wide = Math.round(el.scrollWidth - el.clientWidth)
    if (over > 1 || wide > 1) {
      const cls = (el.getAttribute('class') || '').trim()
      bad.push(el.tagName.toLowerCase() + (cls ? '.' + cls.split(' ').join('.') : '') +
        ' over=' + over + ' scroll=' + wide + ' w=' + Math.round(r.width) +
        ' text=' + (el.textContent || '').trim().slice(0, 32))
    }
  }
  const pre = document.createElement('pre')
  pre.id = 'diag'
  const wrap = document.querySelector('.wrap'); const fs = getComputedStyle(root)
  pre.textContent = ['BOX ' + Math.round(box.width) + 'x' + Math.round(box.height),
    'vw=' + window.innerWidth + ' body=' + document.body.clientWidth + ' wrap=' + (wrap ? Math.round(wrap.getBoundingClientRect().width) : '?'),
    'frameW=' + fs.width + ' maxW=' + fs.maxWidth + ' pos=' + fs.position,
    'panel=' + Math.round((root.firstElementChild || root).getBoundingClientRect().width)].concat(bad.slice(0, 30)).join(' ~~ ')
  document.body.appendChild(pre)
})()
</script>
</body>
</html>
`

const outFile = process.argv[2] || join(root, 'preview.html')
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, html, 'utf8')
console.log('[preview] wrote %s (%d bytes, css %d bytes, tools registered: %d)',
  outFile, html.length, css.length, registeredTools.length)
