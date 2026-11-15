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
  for (const re of [/child_process/, /\bspawn\s*\(/, /\bexec\s*\(/, /node:fs/, /require\s*\(/, /\.innerHTML\b/, /\beval\s*\(/]) {
    assert.equal(re.test(host), false, `host must not match ${re}`)
  }
  // every upstream path is a fixed literal in the whitelist
  assert.ok(/const UPSTREAM = \{/.test(host))
  assert.ok(/Object\.prototype\.hasOwnProperty\.call\(UPSTREAM, key\)/.test(host), 'whitelist lookup')
  assert.ok(/const PASS_QUERY = new Set\(\['limit', 'session', 'offset', 'period'\]\)/.test(host))
  // routes are GET-only
  assert.equal((host.match(/req\.method !== 'GET'/g) || []).length, 3, 'all three routes guard GET')
  assert.ok(/x-content-type-options', 'nosniff'/.test(host))
  assert.ok(/cache-control', 'no-store'/.test(host))
})

test('host verifies gateway identity and normalizes the base URL', () => {
  assert.ok(/url\.protocol !== 'http:' && url\.protocol !== 'https:'/.test(host))
  assert.ok(/health\.name === 'magpie'/.test(client), 'client checks responder identity')
})

test('widget keeps one refresh affordance, a rate readout and a readable type floor', () => {
  assert.ok(/function StatusButton\(/.test(client), 'merged status/refresh control exists')
  assert.ok(!/'aria-pressed': auto/.test(client), 'no duplicate auto-refresh button in the widget header')
  assert.ok(/rateOf\(latest\)/.test(client), 'latest route reports output rate')
  assert.ok(/\.mgp-footstack > \*\{width:100%/.test(client), 'blocks stretch to the full sidebar width')
  assert.ok(/min-height:24px/.test(client), 'interactive controls keep a 24px hit area')
  assert.ok(/readability floor/.test(client), 'data text has a 12px floor')
})

test('manifest wires the bundle and client correctly', () => {
  assert.equal(pkg.name, '@local/dsh-magpie-monitor')
  assert.equal(pkg.version, '1.3.0')
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
