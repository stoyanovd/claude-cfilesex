# Security Policy

## What this script does NOT do

- ❌ No network requests (fetch, XHR, WebSocket, sendBeacon)
- ❌ No data collection or telemetry
- ❌ No external script loading (@require, dynamic script injection)
- ❌ No access to conversation content or message text
- ❌ No access to file contents (only file card metadata: names, sizes, dates)
- ❌ No access to API keys, auth tokens, or account credentials
- ❌ No clipboard access
- ❌ No cookie or sessionStorage access
- ❌ No unsafeWindow (runs in userscript sandbox)
- ❌ No eval or dynamic code execution

## What this script DOES access

- ✅ DOM elements on the project files page (to inject toolbar UI)
- ✅ GM_setValue / GM_getValue (to remember UI preferences per project)
- ✅ localStorage (fallback for preference storage)

## Stored data (complete list)

All keys prefixed `cfilesex_`, suffixed with project ID:

| Key | Type | Purpose |
|-----|------|---------|
| `cfilesex_enabled_<id>` | bool | Toolbar ON/OFF |
| `cfilesex_ever_enabled_<id>` | bool | First-enable flag |
| `cfilesex_sort_<id>` | string | Sort mode (az/za/date/lines) |
| `cfilesex_view_<id>` | string | View mode (list/grid) |
| `cfilesex_versions_<id>` | bool | Version badges ON/OFF |
| `cfilesex_outdated_<id>` | bool | Outdated filter ON/OFF |

Nothing else is stored.

## How to verify

Open the script source and Ctrl+F for each term below — all return zero results in executable code:

| Search for | Proves |
|-----------|--------|
| `fetch(` | No network requests |
| `XMLHttpRequest` | No network requests |
| `GM_xmlhttp` | No network requests |
| `sendBeacon` | No network requests |
| `WebSocket` | No network requests |
| `eval(` | No dynamic code execution |
| `new Function(` | No dynamic code execution |
| `document.cookie` | No cookie access |
| `navigator.clipboard` | No clipboard access |
| `unsafeWindow` | No page context access |
| `@require` | No external scripts (in header) |
| `@connect` | No cross-origin permissions (in header) |

Note: these terms appear in the Verification Guide comment block itself (as search instructions) — that's expected. They should not appear anywhere else.

`innerHTML` is used in two places: clearing our own elements before rebuilding, and rendering a hardcoded tooltip. Neither involves user data or external content.

## Deep audit via LLM

See the [audit prompt in README](README.md#-verify-this-scripts-safety).

## Auto-updates

Your userscript manager may auto-update this script.
You can disable auto-updates per script in Tampermonkey / Violentmonkey settings.
Every update is published with a changelog on GitHub.

## Reporting vulnerabilities

Please open a [GitHub issue](https://github.com/stoyanovd/claude-cfilesex/issues).
