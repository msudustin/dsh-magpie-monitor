# dsh-magpie-monitor

> DeepSeek Harness **sidebar-footer widget** (in the style of `dsh-cost-meter`)
> that shows the local **Magpie gateway** in real time, pinned to the bottom of the
> sidebar above the settings row.
>
> Package name: `@local/dsh-magpie-monitor` · Version: `1.3.0` · License: MIT

- **Live routing** — the newest request as a `req → served` card (requested
  route/group vs the model actually served), with provider, status, latency,
  tokens and time. Expand to see the last few requests.
- **Usage by period** — today / 7-day / 30-day calls, tokens and cost, with a
  per-bucket mini bar chart and a derived-metrics line (errors, avg TTFT,
  tokens/s, cache-hit %).
- **Account quotas** — the most-used subscription windows with used-percentage
  bars, a remaining-% sparkline from quota history, and reset / expiry times;
  expand for more accounts.
- **Model cost ranking** — the top models by cost for the selected period.
- **Collapsed rail** — when the sidebar is collapsed, a single magpie icon with a
  live status dot and a summary tooltip.

The widget auto-refreshes (default every 5 s) and can be paused, masked
(amounts / accounts → `••••`), or refreshed manually from its header. The chosen
period, mask and auto-refresh state survive a reload.

A dedicated **settings page** (like `dsh-cost-meter`) lets you pick the display
style and choose which blocks to show, with a live preview — see
[Settings page](#settings-page).

## Architecture

The Magpie gateway (`http://127.0.0.1:3425` by default) sends no CORS headers,
so the browser cannot call it directly. The host half registers three read-only
routes on the DSH web server:

| Route | Purpose |
| --- | --- |
| `GET /magpie-monitor/api/config` | Effective settings + resolved currency |
| `GET /magpie-monitor/api/data?path=<key>` | Proxy one whitelisted upstream payload (`root`, `usage`, `requests`, `quotas`, `history`, `statusline`, `route`, `trace`, `models`) |
| `GET /magpie-monitor/api/snapshot?period&recent[&fresh=1]` | One merged, trimmed snapshot (health + usage + series + quotas + history + models + requests + problems) so the client makes a single request per cycle |

Only `limit`, `session`, `offset` and `period` query parameters are forwarded;
the routes are not an open proxy. The snapshot endpoint fetches `usage` as the
required core and the rest with `Promise.allSettled`, so a slow or failing
secondary endpoint degrades to a `problems[]` note instead of blanking the
widget. Per-endpoint timeouts (usage/models 8 s, requests 12 s, quotas 16 s) and
a 1.5 s shared cache (`fresh=1` bypasses it) keep it cheap; the request is
aborted if the client disconnects.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `gatewayUrl` | `http://127.0.0.1:3425` | Magpie gateway base URL (http/https origin only) |
| `refreshMs` | `5000` | Widget auto-refresh interval (1000–120000 ms) |
| `requestLimit` | `40` | Rows requested for the routing list (5–200) |
| `period` | `today` | Default usage period (`today` / `7d` / `30d`) |
| `cnyRate` | `0` | USD→CNY rate; `0` keeps USD, `>0` converts every money figure once |
| `tool` | `true` | Register the `magpie_usage` agent tool (read at apply; restart to change) |

All keys are live-updatable (`.volatile()`); the host unwraps `{get()}`
references before use.

## Agent tool

When `tool` is on, the host registers **`magpie_usage`** — a read-only,
concurrency-safe tool that returns the same merged snapshot as a Chinese text
report (calls, cost, tokens, quota windows, model ranking, recent requests).
Parameters: `period` (`today`/`7d`/`30d`, defaults to the panel setting) and
`recent` (1–50, default 5). It shares the snapshot cache with the panel.

## Client behavior

- **One request per cycle** — the client fetches `/api/snapshot` and renders
  health, usage, quotas, models and requests from it; config is re-read each
  cycle so live setting changes are picked up.
- **Persistence** — the last good snapshot plus prefs (period / masked / auto)
  are stored in `localStorage` (`dsh-magpie-monitor:v1`, throttled to 15 s).
  On load the envelope is version-checked and **rebuilt through a whitelist**
  (`sanitizeSnapshot`), so a tampered or stale store cannot inject fields or
  markup. The widget shows the cached snapshot instantly, then refreshes.
- **Stale, not blank** — a failed refresh keeps the last good data and shows a
  "last succeeded at …" banner; only a first-load failure shows the offline
  banner with retry.
- **Density** — the height cap (`min(38dvh, 320px)`) is measured from the
  viewport and mapped to `normal` / `tight` / `short`, which scales spacing,
  chart height and row counts so the session list and settings row stay visible.
- **One status control** — the header carries a single merged control instead of
  a separate dot + auto button + refresh button. Its dot reports the state
  (pulsing green = live, amber = auto refresh paused, red = gateway offline) and
  clicking it always refreshes now (`fresh=1`). The auto-refresh switch itself
  lives on the settings page, so the widget header stays quiet.
- **Output rate on the latest route** — the latest-route line shows the served
  model's throughput (`out / (ms / 1000)` → `N tok/s`) rather than wall-clock
  duration; the tooltip still carries TTFT.
- **Full-width blocks** — every block stretches to the sidebar's usable width
  (`.mgp-footstack > *{width:100%}`, `minmax(0,1fr)` grids), and long model names
  wrap instead of being ellipsised, so nothing is clipped in a narrow rail.
- **Readable floor** — data text never drops below 12px; the three usage values
  keep their larger scale. Interactive controls keep a 24px hit area.
- **Visibility** — refreshes immediately when the tab becomes visible and
  persists when hidden; in-flight fetches use `AbortController` and are cancelled
  on unmount. Manual refresh is serialized (a queued manual refresh wins over
  the auto cycle).

## Settings page

One settings component is exposed through **two entries** (the `dsh-cost-meter`
pattern), so you can reach it from either place:

- **Settings → Magpie** — a `settings.section` entry (id `magpie-monitor`,
  order `35`).
- **Settings → Plugins → `@local/dsh-magpie-monitor` → Configure** — a
  `plugins.bundle.config` entry keyed by the package name (`view: 'page'`).

Both render the same `MagpieSettings` component:

- **Display style** — three radio cards with miniature previews: `standard`
  (full footer), `compact` (forced tight density, denser spacing) and `minimal`
  (a single summary line: period calls · cost · top quota).
- **Content blocks** — eight independent toggles: latest route, usage totals,
  bar chart, derived metrics, quota bars, quota sparklines, model ranking and
  recent requests. Each gates the matching block in the footer.
- **Preferences** — mask amounts/accounts and auto-refresh (shared with the
  footer header buttons), plus a reset that restores style + blocks but keeps
  mask/auto.
- **Live preview** — the right column renders the *same* `MagpieBody` presenter
  the footer uses, fed by a fixed `SAMPLE_SNAPSHOT`, so every style/toggle change
  is reflected immediately without a fetch or iframe.
- **Host configuration** — `gatewayUrl`, `refreshMs`, `requestLimit`, `cnyRate`,
  default `period` and `tool` are edited through the client `configForms`
  service (namespace `magpie-monitor`), persisted host-side via
  `remote.settings.mutate`. Numeric fields commit on blur/Enter and are clamped
  to the host ranges; if the namespace is not served the form degrades to a
  localized "unavailable" note while the display settings keep working.

Display style, block visibility, mask and auto live in a small module-level
store persisted to `localStorage` (`dsh-magpie-monitor:display:v1`, whitelisted
on read). The store is shared by the footer and the settings page, so a change
in either takes effect in the other instantly and survives a reload. The
`configForms` dependency is declared in the client factory `inject`
(`['slots', 'locale', 'configForms']`); the service is provided by the core
`ui-settings` client plugin, which is always present in the web GUI.

## Install

From the package directory, via the Harness plugin manager
(`plugin_manager install_bundle`), which adds the dependency and applies
`cordis.patch.yml` to the profile. The client bundle registers three slots:
`sidebar.footer.action` (id `magpie-monitor`, order `100`, the last footer
action just above the settings row), `settings.section` (id `magpie-monitor`,
order `35`) and `plugins.bundle.config` (key `@local/dsh-magpie-monitor`). The
footer uses scoped `:has()` rules to claim a full-width row without growing any
ancestor. **Restart DSH** to load the client half — the module loader caches the
client bundle until restart, so a page refresh alone is not enough. The host
half (routes + tool) reloads on install.

Install it straight from GitHub (the plugin manager understands the `github:`
shorthand and clones the repository):

```
plugin_manager action=install_bundle target=github:msudustin/dsh-magpie-monitor
```

Or clone it and point the manager at the checkout:

```bash
git clone https://github.com/msudustin/dsh-magpie-monitor.git
# target = <clone>/dsh-magpie-monitor
```

Requirements: Node.js >= 22, a running Magpie gateway (default
`http://127.0.0.1:3425`), and `@deepseek-ai/schemastery` `>=3.18.4 <4` provided
by the DSH profile (it is a peer dependency, not a bundled one).

## Robustness

- **Error boundary** — the footer component is wrapped in a stable, module-level
  React error boundary, so a render error shows a localized, retryable fallback
  instead of taking down the sidebar foot.
- **Gateway identity check** — "online" requires the root payload to report
  `name === 'magpie'`, not merely an open port; the version is surfaced too.
- **No-store + nosniff** — every host response sets `Cache-Control: no-store`
  and `X-Content-Type-Options: nosniff`; routes are GET-only.
- **No secrets** — the host never reads files, spawns processes, or forwards
  credentials; the client only ever calls same-origin routes.

## Tests

```
npm test
```

(equivalently: `node --experimental-vm-modules --test --test-force-exit "test/*.test.js"`)

44 tests: host integration (real `index.js` in a `vm` module with a stubbed
schemastery, fake webServer/tools and mock fetch), client mount (real `client.js`
against a fake React hook scheduler, fake DOM/localStorage/timers — covering the
footer and the settings page: style selection, content toggles, reset, host
config editing via a fake `configForms`, footer/settings shared state, and the
merged status control's live/paused/compact behaviour), and
source-level invariants (negative regexes for eval/innerHTML/external URLs/
secrets, whitelist guards, single refresh affordance, 12px type floor, manifest
shape).

## Borrowed ideas

v1.1 folds in the best of two community Magpie plugins (both MIT):

- **[todayT/dsh-magpie-dashboard](https://github.com/todayT/dsh-magpie-dashboard)** —
  snapshot caching with whitelist re-validation on read, a defensive
  normalization layer, reset/expiry wording on quota bars, a serialized refresh
  guard, and the `node:vm` fake-React mount + negative-regex test approach.
  (Its CLI/spawn/OAuth/checkin half is not portable to our HTTP gateway, and we
  avoid its hardcoded install path and dead code.)
- **[hebangwen/dsh-magpie-usage](https://github.com/hebangwen/dsh-magpie-usage)** —
  the merged host snapshot with per-endpoint timeouts and `allSettled`
  degradation, the `magpie_usage` agent tool sharing that snapshot, derived
  metrics (avg TTFT, tokens/s), density-adaptive layout, the mask toggle,
  stale-banner-with-old-data, and visible-tab catch-up.

We keep our own gateway identity check, hot `.volatile()` config, origin
validation and `nosniff`, and resolve the quota `used` semantics by measurement
(the gateway reports `used` as a percentage). The client persists to
`localStorage` rather than a host disk cache: the HTTP snapshot is cheap and
credential-free, so no private file or ACL handling is needed.