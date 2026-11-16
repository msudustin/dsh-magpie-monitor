// Source-level safety invariants + manifest checks. These are negative tests:
// they fail if a dangerous pattern ever appears in either half, independent of
// runtime behavior. Borrowed from dsh-magpie-dashboard's regex safety tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const client = readFileSync(path.join(root, 'client.js'), 'utf8')
const host = readFileSync(path.join(root, 'index.js'), 'utf8')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

test('client has no dynamic-code or navigation sinks', () => {
  for (const re of [/\beval\s*\(/, /new\s+Function\s*\(/, /\.innerHTML\b/, /document\.write\s*\(/, /window\.open\s*\(/, /\.outerHTML\b/, /insertAdjacentHTML/]) {
    assert.equal(re.test(client), false, `client must not match ${re}`)
  }
})

test('client only talks to the same origin and the default gateway constant', () => {
  const urls = client.match(/https?:\/\/[^\s'"`)]+/g) || []
  for (const u of urls) assert.equal(u, 'http://127.0.0.1:3425', `unexpected external URL ${u}`)
  assert.ok(client.includes("credentials: 'same-origin'"), 'fetch uses same-origin credentials')
  assert.equal(/api[_-]?key|password|secret/i.test(client), false, 'no credential collection')
})

test('client re-validates every snapshot and persisted envelope', () => {
  assert.ok(/function sanitizeSnapshot/.test(client))
  assert.ok(/env\.v !== 1/.test(client), 'envelope version gate')
  assert.ok(/sanitizeSnapshot\(res\)/.test(client), 'fresh fetch sanitized')
  assert.ok(/sanitizeSnapshot\(env\.snap\)/.test(client), 'restored snap sanitized')
})

test('client keeps a stable error boundary and cleans up on unmount', () => {
  assert.ok(/getDerivedStateFromError/.test(client))
  assert.ok(/aliveRef\.current = false/.test(client), 'unmount stops setState')
  assert.ok(/abortRef\.current\.abort\(\)/.test(client), 'unmount aborts in-flight')
  assert.ok(/clearInterval\(id\)/.test(client))
})

test('host is not an open proxy and spawns nothing', () => {
  for (const re of [/child_process/, /\bspawn\s*\(/, /\bexec\s*\(/, /require\s*\(/, /\.innerHTML\b/, /\beval\s*\(/]) {
    assert.equal(re.test(host), false, `host must not match ${re}`)
  }
  // The host may read the gateway's own discovery file, but nothing else: the
  // path is a literal under the user's config directory.
  assert.ok(/node:fs/.test(host), 'host reads the gateway discovery file')
  assert.ok(/gateway\.json/.test(host))
  assert.ok(/readFileSync/.test(host))
  // every upstream path is a fixed literal in the whitelist
  assert.ok(/const UPSTREAM = \{/.test(host))
  assert.ok(/Object\.prototype\.hasOwnProperty\.call\(UPSTREAM, key\)/.test(host), 'whitelist lookup')
  assert.ok(/const PASS_QUERY = new Set\(Object\.values\(QUERY_RULES\)/.test(host),
    'the forwarded query set is derived from the per-endpoint rules')
  assert.ok(/required: \['session'\]/.test(host), 'session is required where the endpoint needs it')
  // routes are GET-only
  assert.equal((host.match(/req\.method !== 'GET'/g) || []).length, 3, 'all three routes guard GET')
  assert.ok(/x-content-type-options', 'nosniff'/.test(host))
  assert.ok(/cache-control', 'no-store'/.test(host))
})

test('host verifies gateway identity and normalizes the base URL', () => {
  assert.ok(/url\.protocol !== 'http:' && url\.protocol !== 'https:'/.test(host))
  assert.ok(/health\.name === 'magpie'/.test(client), 'client checks responder identity')
})

test('host only answers the machine it runs on and classifies its failures', () => {
  assert.ok(/function isTrustedRequest/.test(host), 'every route passes a trust gate')
  assert.ok(/sec-fetch-site/.test(host), 'cross-site requests are refused')
  assert.ok(/resolvedGateway/.test(host), 'a discovered base is remembered')
  assert.ok(/getDiscoveryCandidates|gateway\.json/.test(host), 'discovery reads the gateway report')
  assert.ok(/function classifyFailure/.test(host), 'failures become a code plus a readable message')
  for (const code of ['connection', 'timeout', 'unauthorized', 'rate_limited', 'server_error']) {
    assert.ok(host.includes(`'${code}'`), `failure code ${code} is part of the contract`)
  }
  assert.ok(/problems\.push\(\{ what, code/.test(host), 'problems carry what/code/message')
  assert.ok(/function errHint/.test(client), 'client translates codes instead of echoing host text')
})

test('client ships the v1.4 readouts and keeps them validated', () => {
  assert.ok(/const speeds = arr\(raw\.speeds/.test(client), 'speeds are rebuilt from a whitelist')
  assert.ok(/channels = \{ through: pickChannel/.test(client), 'channels are rebuilt from a whitelist')
  assert.ok(/function SpeedLine/.test(client) && /function ChannelRow/.test(client))
  assert.ok(/function usageLevel/.test(client), 'one threshold helper for every quota bar')
  assert.ok(/>= 90/.test(client), 'severe usage is a separate level')
  assert.ok(/function windowKind/.test(client), 'window names are normalized before ordering')
  assert.ok(/createPortal/.test(client), 'the rail popup escapes the sidebar transform')
})

test('widget keeps one refresh affordance, a rate readout and a readable type floor', () => {
  assert.ok(/function StatusButton\(/.test(client), 'merged status/refresh control exists')
  assert.ok(!/'aria-pressed': auto/.test(client), 'no duplicate auto-refresh button in the widget header')
  assert.ok(/rateOf\(latest\)/.test(client), 'latest route reports output rate')
  assert.ok(/\.mgp-footstack > \*\{width:100%/.test(client), 'blocks stretch to the full sidebar width')

test('the panel blocks keep their height when the sidebar gets short', () => {
  // Regression: a footer slot shorter than the panel used to squeeze every
  // block (column flex items shrink by default) until the flight strip and the
  // header painted over the latest-route card. Items must not shrink; the
  // stack itself shrinks and scrolls instead.
  assert.ok(/\.mgp-footstack > \*\{[^}]*flex:0 0 auto/.test(client), 'panel blocks must not shrink')
  assert.ok(/\.mgp-footstack\{[^}]*min-height:0/.test(client), 'the stack must be allowed to shrink below its content')
  assert.ok(/\.mgp-footstack\{[^}]*overflow:auto/.test(client), 'the stack scrolls its own overflow')
  // A percentage cap would resolve against a content-sized footer slot, i.e.
  // against the panel itself, so the panel would grow and push the sidebar up.
  assert.ok(/\.mgp-footstack\{[^}]*max-height:min\(\d+dvh/.test(client), 'the stack cap is viewport-relative, never 100%')
  assert.equal(/\.mgp-footstack\{[^}]*max-height:min\(100%/.test(client), false, 'no percentage inside the cap')
})
  assert.ok(/min-height:24px/.test(client), 'interactive controls keep a 24px hit area')
  assert.ok(/readability floor/.test(client), 'data text has a 12px floor')
})

test('manifest wires the bundle and client correctly', () => {
  assert.equal(pkg.name, '@local/dsh-magpie-monitor')
  assert.equal(pkg.version, '1.6.11')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
  assert.ok(existsSync(path.join(root, 'cordis.patch.yml')))
  assert.ok(existsSync(path.join(root, 'icon.svg')))
  assert.ok(existsSync(path.join(root, 'locale', 'en.json')))
  assert.ok(existsSync(path.join(root, 'locale', 'zh.json')))
  const patch = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.ok(/id:\s*magpie-monitor/.test(patch))
  assert.ok(/@local\/dsh-magpie-monitor/.test(patch))
})

test('the client stamps the same version the manifest publishes', () => {
  // A stale browser bundle is otherwise invisible; the settings header prints
  // this constant so "did my restart load it?" is answerable at a glance.
  const match = client.match(/const VERSION = '([^']+)'/)
  assert.ok(match, 'client declares VERSION')
  assert.equal(match[1], pkg.version)
  assert.ok(/v' \+ VERSION/.test(client), 'settings header prints the version')
})

test('provider chips and the magpie are the app own marks', () => {
  // The marks are the files magpie ships, baked in as data URIs by
  // tools/embed-icons.mjs: a redrawn silhouette would pass every other test.
  assert.ok(existsSync(path.join(root, 'icons', 'magpie.svg')), 'the bird that ships with the app is kept')
  assert.ok(existsSync(path.join(root, 'tools', 'embed-icons.mjs')), 'the embedder stays with its sources')
  const block = client.slice(client.indexOf('const BRAND_ICONS'), client.indexOf('// </icons>'))
  assert.ok(block.length > 50000, 'the marks are inlined for the panel')
  const uris = block.match(/data:image\/(?:svg\+xml|png);base64,/g) || []
  assert.ok(uris.length >= 15, 'every provider the panel can show has a mark')
  assert.ok(block.includes('"magpie": "data:image/svg+xml;base64,'), 'the bird is one of them')
  assert.ok(/function brandIconOf\(/.test(client) && /function BrandBadge\(/.test(client),
    'one resolver picks a mark per provider')
  assert.ok(/\.mgp-badge-img\{/.test(client), 'an image chip drops the letter badge frame')
  assert.equal(/M14 40c0-12/.test(client), false, 'no redrawn magpie silhouette')
})
