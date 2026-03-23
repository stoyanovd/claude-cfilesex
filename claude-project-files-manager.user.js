// ==UserScript==
// @name         Claude Project Files — Sort, Filter & List View
// @namespace    https://github.com/stoyanovd/claude-cfilesex
// @version      6.4.1
// @description  Sort, filter, compact list view, version tracking and Select All for Claude project files. A→Z / Z→A / date / lines sorting, text search, Grid↔List toggle, outdated version badges.
// @description:ru  Сортировка, фильтрация, компактный список, отслеживание версий и Select All для файлов проектов Claude.
// @author       Dmitry S
// @license      MIT
// @homepageURL  https://github.com/stoyanovd/claude-cfilesex
// @supportURL   https://github.com/stoyanovd/claude-cfilesex/issues
// @source       https://github.com/stoyanovd/claude-cfilesex/tree/v6.4.1
// @match        https://claude.ai/project/*
// @match        https://claude.ai/projects*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @compatible   brave Primary development & testing (Violentmonkey)
// @compatible   chrome
// @compatible   firefox
// @compatible   edge
// @compatible   opera
// @compatible   safari
// ==/UserScript==
//
// ┌─────────────────────────────────────────────────────────────┐
// │  PRIVACY & SECURITY                                        │
// │                                                             │
// │  • ZERO network requests — no fetch, no XHR, no WebSocket. │
// │  • Minimal permissions — only GM_setValue / GM_getValue     │
// │    for storing UI preferences (sort, view mode).            │
// │  • No external scripts — fully self-contained.              │
// │  • No code execution from strings — no eval, no new        │
// │    Function, no setTimeout with strings.                    │
// │  • Stores only UI preferences — per-project, local only.   │
// │    See STORAGE INVENTORY below for the complete list.       │
// │  • No access to file contents or messages — only reads      │
// │    file card metadata (names, sizes, dates).                │
// │  • No clipboard, cookie, or sessionStorage access.          │
// │  • No unsafeWindow — runs entirely in userscript sandbox.  │
// │  • No innerHTML with user data — safe DOM manipulation.     │
// │  • Open source — MIT license, full code on GitHub.         │
// │                                                             │
// │  VERIFY: Search this file for any of the above terms.      │
// │  Each claim is designed to be verifiable in seconds.        │
// │  See VERIFICATION GUIDE below.                              │
// └─────────────────────────────────────────────────────────────┘
//
// VERIFICATION GUIDE — Ctrl+F each term, expect zero results:
//
//   fetch(               — no network requests
//   XMLHttpRequest       — no network requests
//   GM_xmlhttp           — no network requests
//   sendBeacon           — no network requests
//   WebSocket            — no network requests
//   new Image(           — no image-based exfiltration
//   eval(                — no dynamic code execution
//   new Function(        — no dynamic code execution
//   document.cookie      — no cookie access
//   navigator.clipboard  — no clipboard access
//   unsafeWindow         — no page context access
//   @require             — no external scripts (check header)
//   @connect             — no cross-origin permissions (check header)
//   innerHTML            — only on our own elements with hardcoded content
//
// SCOPE: This script interacts ONLY with:
//   1. File cards grid/list (div containers with file metadata)
//   2. Our injected toolbar UI (prefixed cfilesex-*)
//   3. Native checkboxes (Select All functionality)
// It does NOT touch: file contents, chat messages, navigation,
// settings, API endpoints, or authentication elements.
//

(function () {
  'use strict';

  console.log('[cfilesex] Project Files Manager v6.4.1 loaded');

  // ════════════════════════════════════════════════════════════════════════════
  // ARCHITECTURE — block map
  // ════════════════════════════════════════════════════════════════════════════
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ LAYER 1 — INFRASTRUCTURE (pure, no DOM)                                │
  // │                                                                        │
  // │  Constants ............ WRAP_ID, TOOLBAR_ID, regexes, delays           │
  // │  Storage .............. load(key,def), save(key,val), projectId()      │
  // │  Sorting .............. safeCompare(a,b)                               │
  // │  Versioning ........... parseVersion, versionGt, analyzeVersions       │
  // │                        VERSION_RE (2-4 parts) + VERSION_1_RE (1-part)  │
  // │                                                                        │
  // │  Zero side effects. Safe to call anytime.                              │
  // ├─────────────────────────────────────────────────────────────────────────┤
  // │ LAYER 2 — STATE                                                        │
  // │                                                                        │
  // │  freshState() ......... creates clean state object S                   │
  // │  resetState() ......... full teardown: timers, observers, DOM cleanup  │
  // │                                                                        │
  // │  Single object S holds all mutable state. All timers in S.* for reset. │
  // ├─────────────────────────────────────────────────────────────────────────┤
  // │ LAYER 3 — DOM READING (read-only queries, fragile to DOM changes)      │
  // │                                                                        │
  // │  findFilesGrid() ..... heuristic grid detection + drill-down           │
  // │  getLiveCards(grid) ... direct children, filters our elements           │
  // │  countRealFiles(grid)  querySelectorAll file-thumbnail (any depth)     │
  // │  getFileName(card) ... TreeWalker + isNativeTextNode filter            │
  // │  getCardMeta(card) ... lines + extension from card text nodes          │
  // │  findNativeCheckbox .. 3 fallback selectors, :not(.cfilesex-list-cb)   │
  // │  isNativeChecked ..... reads checkbox state                            │
  // │                                                                        │
  // │  No DOM writes. But fragile: depends on Claude's DOM structure.        │
  // ├─────────────────────────────────────────────────────────────────────────┤
  // │ LAYER 4 — DOM WRITING (modifies DOM, interacts with React)             │
  // │                                                                        │
  // │  applySortAndFilter()  ORCHESTRATOR — calls phases in sequence:        │
  // │    Phase 1: computeSortOrder(cards, mode, order) → {sorted, nameCache} │
  // │    Phase 2: updateVersionBadges()                                      │
  // │    Phase 3: computeFilterGroups(sorted, q, outFilter, cache) → groups  │
  // │    Phase 4: highlightMatch per card                                    │
  // │    Phase 5: applyDomOrder(grid, matched, unmatched, filter, sep)       │
  // │    Phase 6: applyCardStyles(matched, unmatched, filter, sep)           │
  // │    Phase 7: scroll restore + view recovery + syncCounterRow            │
  // │                                                                        │
  // │  Phases 1,3 — no DOM writes, but 3 depends on S.versionMap (→ phase 2).│
  // │  Phases 5,6 are isolated DOM writes — each testable alone.             │
  // │                                                                        │
  // │  injectListElements(card) — orchestrator: create + attach              │
  // │    createCardElements(card) — DOM: creates 5 elements, appends         │
  // │    attachCardBehavior(card, cb, nameEl) — events + MutationObserver    │
  // │  applyView(grid, view) — toggles LIST_CLASS on grid                    │
  // │  highlightEl(el, query) — filter match highlighting                    │
  // │  updateVersionBadges() — D/OLD badges on cards                         │
  // │  applyMasterState() — ON/OFF toggle (parameterless, reads S.grid+DOM)  │
  // │  clickNativeCheckbox — triggers native CB (with mouseover fallback)    │
  // │  ensureSep() — get or create separator element                         │
  // ├─────────────────────────────────────────────────────────────────────────┤
  // │ LAYER 5 — CHECKBOX SUBSYSTEM                                           │
  // │                                                                        │
  // │  Two-way sync: our checkbox ↔ native checkbox                          │
  // │  S.matchedSet ......... cached in applySortAndFilter Phase 3½            │
  // │                         (no longer read — kept for potential future use) │
  // │  getMatchedCards ...... recomputes from live DOM (filter + badge text)   │
  // │  buildCounterRow ...... Select All row with 3-state checkbox           │
  // │  syncCounterRow ....... debounced 50ms, counts matched selections      │
  // │  toggle() ............. Select All / Deselect All                      │
  // │  Per-card MutationObserver (in attachCardBehavior) syncs our CB ← native │
  // │  Our CB change handler syncs our CB → native via clickNativeCheckbox   │
  // ├─────────────────────────────────────────────────────────────────────────┤
  // │ LAYER 6 — LIFECYCLE + UI                                               │
  // │                                                                        │
  // │  toolbarActions ....... state logic extracted from button handlers      │
  // │    setSort, setView, toggleVersions, toggleOutdated, toggleEnabled     │
  // │    setFilter, clearFilter — all read S.grid, never closure grid        │
  // │  tryInit() ........... retry cascade: RETRY_DELAYS then 5s × 6        │
  // │  buildToolbar(grid) .. creates DOM + wires thin handlers → actions     │
  // │  watchGrid(grid) ..... MutationObserver on grid + parent              │
  // │  SPA observer ........ MutationObserver on body, path change detect   │
  // │  Heartbeat ........... setInterval 8s, safety net for missed events   │
  // │  CSS ................. ~250 lines of styles                            │
  // │  setToolbarVisible ... show/hide when <2 files                        │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // LIFECYCLE
  //   document-idle → setTimeout 1800ms → tryInit
  //   tryInit → findFilesGrid → buildToolbar(grid) → watchGrid(grid)
  //   SPA navigation → resetState → tryInit (800ms delay)
  //   Heartbeat (8s) → checks grid.isConnected, recovers if needed
  //
  // KEY FEEDBACK LOOPS (source of most bugs)
  //   1. watchGrid → applySortAndFilter → appendChild → watchGrid fires again
  //      Protected by: S.ownMutation guard (200ms window) + needsReorder check
  //   2. our CB change → clickNativeCheckbox → cardObserver → syncCounterRow
  //      Protected by: 50ms debounce on syncCounterRow
  //   3. watchGrid subtree:true catches intra-card mutations (hover, checkbox)
  //      Protected by: m.target depth check (grid or grid.parentNode only)
  //
  // DOM STRATEGY
  //   Inject our elements (badge, ext, name, meta) INTO native cards.
  //   Hide native content via sr-only (not display:none — avoids React flicker).
  //   React doesn't re-render our elements — coexistence, not override.
  //
  // STORAGE: GM_setValue + localStorage fallback, per-project keys. See STORAGE INVENTORY below.
  // STATE:   single object S, reset via freshState(). All timers in S for cleanup.
  // PREFIX:  cfilesex- (CSS classes, IDs, storage keys)

  // cfilesex prefix — unique enough to avoid conflicts with anything on the page
  const WRAP_ID      = 'cfilesex-wrap';
  const TOOLBAR_ID   = 'cfilesex-toolbar';
  const COUNTER_ID   = 'cfilesex-counter-row';
  const SEP_ID       = 'cfilesex-filter-sep';
  const STATUS_ID    = 'cfilesex-status';
  const LIST_CLASS   = 'cfilesex-list-mode';
  const UNMATCHED_CL = 'cfilesex-unmatched';
  const RETRY_DELAYS = [1200, 2000, 3500, 6000];
  const FILE_EXT_RE  = /\.(md|txt|pdf|docx?|csv|json|ts|tsx|js|jsx|py|html|xml|png|jpg|jpeg|yaml|yml|toml|sh|rb|go|rs|swift|kt)\b/i;
  // Must cover ALL extensions from FILE_EXT_RE — otherwise getFileName may return
  // an extension label ("GO", "SH") as the filename if Claude's DOM puts ext before name.
  const SKIP_TEXT_RE = /^([\d,]+\s*(lines?|bytes?|kb|mb|строк|байт)|md|txt|pdf|docx?|csv|json|ts|tsx|js|jsx|py|html|xml|png|jpg|jpeg|yaml|yml|toml|sh|rb|go|rs|swift|kt)$/i;

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE — GM_setValue + localStorage fallback, per-project
  //
  // Stored keys (all prefixed cfilesex_, suffixed _<projectId>):
  //
  //   cfilesex_enabled_<id>      — bool, toolbar ON/OFF state
  //   cfilesex_ever_enabled_<id> — bool, true after first enable
  //   cfilesex_sort_<id>         — string: 'az' | 'za' | 'date' | 'lines'
  //   cfilesex_view_<id>         — string: 'list' | 'grid'
  //   cfilesex_versions_<id>     — bool, version badges ON/OFF
  //   cfilesex_outdated_<id>     — bool, outdated filter ON/OFF
  //
  // Nothing else is stored. No telemetry. No user identifiers.
  // GM storage = priority (cross-device sync in VM/TM).
  // localStorage = fallback (GM4 with broken API, or no GM at all).
  // ═══════════════════════════════════════════════════════════════════════════

  // Cache projectId — computed once, reset in resetState
  let _projectId = null;
  function projectId() {
    if (_projectId) return _projectId;
    const m = location.pathname.match(/^\/project\/([^/]+)/);
    _projectId = m ? m[1] : 'unknown';
    return _projectId;
  }

  function load(key, def) {
    // Priority 1: GM storage (supports cross-device sync in VM/TM)
    // Compare with undefined, not def — otherwise explicitly saved false/0/'' won't return
    try {
      const val = GM_getValue(`cfilesex_${key}_${projectId()}`, undefined);
      if (val !== undefined) return val;
    } catch {}
    // Priority 2: localStorage (works everywhere, including GM4 with broken API)
    try {
      const raw = localStorage.getItem(`cfilesex_${key}_${projectId()}`);
      if (raw !== null) return JSON.parse(raw);
    } catch {}
    return def;
  }

  function save(key, val) {
    try { GM_setValue(`cfilesex_${key}_${projectId()}`, val); } catch {}
    try { localStorage.setItem(`cfilesex_${key}_${projectId()}`, JSON.stringify(val)); } catch {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SORTING — user locale, numeric-aware, case-insensitive
  // undefined instead of 'ru' → browser uses system locale
  // numeric: true → v1_9 sorts before v1_10
  // sensitivity: 'base' → File_V1 = file_v1
  // ═══════════════════════════════════════════════════════════════════════════

  function safeCompare(a, b) {
    try {
      return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    } catch {
      return a < b ? -1 : a > b ? 1 : 0;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSIONING
  // ═══════════════════════════════════════════════════════════════════════════

  // Version regex: separator before v (one of _ . -), 2-4 numeric parts separated by _ . -
  // Requires separator before 'v' to avoid false positives like 'div1.2'
  // Examples: _v1_2, .v1.2.3, -v2-0-1-4, _v5.10
  const VERSION_RE = /[_.\-]v(\d+)[_.\-](\d+)(?:[_.\-](\d+))?(?:[_.\-](\d+))?/i;

  // Fallback: single-part version ONLY at end of basename (before extension).
  // Matches: report_v3.md, inventory_v4.md. Does NOT match: servo_v2_adapter.md (v2 not at end).
  // This avoids false positives where _vN is just part of the name, not a version tag.
  const VERSION_1_RE = /[_.\-]v(\d+)$/i;

  function parseVersion(filename) {
    const base = filename.replace(/\.[^.]+$/, '');
    let m = base.match(VERSION_RE);
    if (m) {
      const parts = [parseInt(m[1], 10), parseInt(m[2], 10)];
      if (m[3] !== undefined) parts.push(parseInt(m[3], 10));
      if (m[4] !== undefined) parts.push(parseInt(m[4], 10));
      return { parts, baseName: base.slice(0, m.index).toLowerCase() };
    }
    // Fallback: single-part version at end of basename only
    m = base.match(VERSION_1_RE);
    if (m) {
      return { parts: [parseInt(m[1], 10)], baseName: base.slice(0, m.index).toLowerCase() };
    }
    return null;
  }

  function versionGt(a, b) {
    const len = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < len; i++) {
      const pa = a.parts[i] || 0;
      const pb = b.parts[i] || 0;
      if (pa !== pb) return pa > pb;
    }
    return false;
  }

  function analyzeVersions(cards, originalOrder) {
    const result     = new Map();
    const nameCounts = new Map();
    const nameNewest = new Map();

    // Cache names — getFileName does a DOM walk, avoid calling it three times
    const nameCache = new Map(cards.map(c => [c, getFileName(c)]));

    // Cache positions — indexOf O(N) → Map lookup O(1)
    const orderIndex = new Map(originalOrder.map((c, i) => [c, i]));

    cards.forEach(card => {
      const name = nameCache.get(card);
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
      // Track the newest card for each filename (lowest orderIndex = first in DOM = newest).
      // The newest copy stays clean; older duplicates get the D badge.
      const idx = orderIndex.get(card) ?? Infinity;
      if (!nameNewest.has(name) || idx < nameNewest.get(name).idx)
        nameNewest.set(name, { idx, card });
    });

    const newestDupCards = new Set();
    nameCounts.forEach((count, name) => {
      if (count > 1) newestDupCards.add(nameNewest.get(name).card);
    });

    const versionGroups = new Map();
    cards.forEach(card => {
      const parsed = parseVersion(nameCache.get(card));
      if (!parsed) return;
      if (!versionGroups.has(parsed.baseName)) versionGroups.set(parsed.baseName, []);
      versionGroups.get(parsed.baseName).push({ ver: parsed, card });
    });

    const latestVerFixed = new Map();
    versionGroups.forEach((entries, base) => {
      let latest = entries[0].ver;
      entries.forEach(e => { if (versionGt(e.ver, latest)) latest = e.ver; });
      latestVerFixed.set(base, latest);
    });

    cards.forEach(card => {
      const name   = nameCache.get(card);
      const count  = nameCounts.get(name) || 1;
      const parsed = parseVersion(name);
      const isDuplicate = count > 1 && !newestDupCards.has(card);
      let isOld = false;
      if (parsed && latestVerFixed.has(parsed.baseName))
        isOld = versionGt(latestVerFixed.get(parsed.baseName), parsed);
      result.set(card, { isDuplicate, isOld });
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  let S = freshState();

  function freshState() {
    return {
      originalOrder   : null,
      enabled         : false,
      currentSort     : 'az',
      currentView     : 'list',
      versionsActive  : false,
      showOutdated    : false,
      filterText      : '',
      retryCount      : 0,
      retryTimer      : null,
      gridObserver    : null,
      grid            : null,
      versionMap      : null,
      matchedSet      : null,   // Set<card> — cached in applySortAndFilter, no longer read (v6.3.4)
      tooltipEl       : null,
      searchEl        : null,
      watchPending    : null,   // pending setTimeout in gridObserver — so we can cancel on disconnect
      ownMutation     : false,  // guard: applySortAndFilter moves cards → ignore mutations
      ownMutationTimer: null,   // timer to reset ownMutation — cancellable for back-to-back calls
    };
  }

  function resetState() {
    clearTimeout(S.retryTimer);
    clearTimeout(S.watchPending);
    clearTimeout(S.ownMutationTimer);
    clearTimeout(_syncDebounce);
    clearTimeout(_filterDebounce);
    _syncDebounce   = null;
    _filterDebounce = null;
    S.gridObserver?.disconnect();
    // Disconnect all per-card observers — otherwise they hold detached card nodes in memory
    cardObservers.forEach(obs => obs.disconnect());
    cardObservers.clear();
    S.grid?.classList.remove(LIST_CLASS);
    if (S.grid) getLiveCards(S.grid).forEach(c => {
      c.classList.remove(UNMATCHED_CL);
      c.style.opacity = '';
      c.style.display = '';
    });
    S.tooltipEl?.remove();
    document.getElementById(WRAP_ID)?.remove();
    document.getElementById(COUNTER_ID)?.remove();
    document.getElementById(SEP_ID)?.remove();
    document.getElementById(STATUS_ID)?.remove();
    _projectId = null;   // reset cache — next project gets its own ID
    S = freshState();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HIDE TOOLBAR WHEN FEW FILES (0-1)
  // ═══════════════════════════════════════════════════════════════════════════

  function setToolbarVisible(visible) {
    const wrap    = document.getElementById(WRAP_ID);
    const toolbar = document.getElementById(TOOLBAR_ID);
    const header  = document.getElementById('cfilesex-header');
    const counter = document.getElementById(COUNTER_ID);
    if (wrap)    wrap.style.display    = visible ? '' : 'none';
    if (toolbar) toolbar.style.display = visible ? '' : 'none';
    if (header)  header.style.display  = visible ? '' : 'none';
    if (counter) counter.style.display = visible && S.enabled ? '' : 'none';
    // When hiding (< 2 files): clean up list mode, card styling, and sep
    // so remaining 0-1 cards don't keep stale classes/opacity.
    if (!visible && S.grid) {
      S.grid.classList.remove(LIST_CLASS);
      const sep = document.getElementById(SEP_ID);
      if (sep) sep.style.display = 'none';
      getLiveCards(S.grid).forEach(c => {
        c.classList.remove(UNMATCHED_CL);
        c.style.opacity = '';
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRID SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  function findFilesGrid() {
    // TODO: restore data-testid fast path if Claude adds testid to file grid
    //       (knowledge-base / project-knowledge / project-files / knowledge-files)

    // Heuristic: find the element with the most file-like children.
    // May return a wrapper INSIDE a CSS-grid container — buildToolbar handles this
    // by walking up past grid ancestors before inserting.
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll('div, ul, section, ol')) {
      if (el.closest('#' + WRAP_ID)) continue;
      if (el.parentNode === document.body) continue;
      if (!el.isConnected) continue;
      const children = Array.from(el.children);
      if (children.length < 1 || children.length > 300) continue;
      const hits = children.filter(c => FILE_EXT_RE.test(c.textContent));
      if (hits.length < 1) continue;
      const ratio = hits.length / children.length;
      if (ratio < 0.7) continue;
      const score = hits.length * 2 + ratio * 5;
      if (score > bestScore) { bestScore = score; best = el; }
    }

    // Drill-down ONE level: if best has ≤2 text children, and one of them contains
    // significantly more file-thumbnails → use inner as grid.
    // Typical pattern: <ul>(1 child: wrapper <div>) → we need wrapper as S.grid,
    // so after flatten getLiveCards sees cards as direct children.
    // buildToolbar uses safe walk-up for insertion → layout not broken.
    // Do NOT drill deeper than one level — otherwise we'd go into restContainers in linked-list.
    if (best) {
      const ch = Array.from(best.children).filter(c => c.textContent && c.textContent.trim());
      if (ch.length <= 2) {
        for (const c of ch) {
          const t = c.querySelectorAll('[data-testid="file-thumbnail"]').length;
          if (t >= 2 && t > countRealFiles(best) * 0.5) { best = c; break; }
        }
      }
    }

    return best;
  }

  function getLiveCards(grid) {
    return Array.from(grid.children).filter(c => {
      if (c.id === SEP_ID) return false;
      // Our injected elements — not cards.
      // Card-level markers (cfilesex-is-outdated, cfilesex-unmatched, cfilesex-row-selected)
      // also start with 'cfilesex-' but are on NATIVE card wrappers, not injected elements.
      // Distinguish via file-thumbnail: real cards contain it, our elements never do.
      if (c.className && typeof c.className === 'string' && c.className.startsWith('cfilesex-')
          && !c.querySelector('[data-testid="file-thumbnail"]')) return false;
      // Empty spacer divs (React inserts <div></div> between cards) — not cards
      if (!c.textContent || !c.textContent.trim()) return false;
      return true;
    });
  }

  // Count real files INSIDE grid regardless of nesting depth.
  // Claude sometimes renders linked-list DOM: each card nested inside the previous one,
  // grid.children = [card1, restContainer], getLiveCards returns 2 for 40 files.
  // querySelectorAll searches at any depth → correct count.
  function countRealFiles(grid) {
    const thumbs = grid.querySelectorAll('[data-testid="file-thumbnail"]');
    if (thumbs.length > 0) return thumbs.length;
    // Fallback if Claude removes data-testid
    return getLiveCards(grid).length;
  }

  function getMatchedCards(grid) {
    // Recompute from live DOM every call — no cached state.
    //
    // Previously read S.matchedSet (Set of card refs from applySortAndFilter Phase 3½).
    // Problem: getMatchedCards is called ASYNCHRONOUSLY (debounced syncCounterRow 50ms,
    // user click on Select All). Between write and read, React reconciliation can replace
    // card DOM elements → Set.has() fails on identity → 0 matches → "Select all visible (0)".
    //
    // Fix: check filter criteria directly on live cards.
    //   - Text filter: getFileName + S.filterText — DOM walk, always fresh
    //   - Outdated filter: badge text content (D / OLD) — what user sees = what code checks.
    //     querySelector('.cfilesex-ver-badge') is cheap (single element per card).
    //     Immune to class staleness, identity staleness, and React reconciliation.
    const all = getLiveCards(grid);
    const q = S.enabled ? S.filterText.toLowerCase().trim() : '';
    const hasOutFilter = S.enabled && S.showOutdated && S.versionsActive;
    if (!q && !hasOutFilter) return all;
    return all.filter(c => {
      if (q && !getFileName(c).toLowerCase().includes(q)) return false;
      if (hasOutFilter) {
        const badge = c.querySelector('.cfilesex-ver-badge');
        if (!badge || !badge.textContent) return false;
      }
      return true;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NAME AND META
  // ═══════════════════════════════════════════════════════════════════════════

  // Checks that a text node is inside native card content,
  // not inside our injected elements (badge, ext, name, meta, cb-wrap).
  // Uses closest() with explicit injected element selectors — if the text node
  // is inside any of our 5 element types, it's not native.
  // Card-level markers (cfilesex-is-outdated, cfilesex-unmatched, cfilesex-row-selected)
  // are on native card wrappers and are NOT in this list → correctly pass through.
  // Denylist of injected classes (we control all 5) is safer than allowlist of card-level
  // markers (which can grow and break silently if one is missed).
  const INJECTED_SEL = '.cfilesex-ver-badge, .cfilesex-list-name, .cfilesex-list-ext, .cfilesex-list-meta, .cfilesex-list-cb-wrap';
  function isNativeTextNode(node) {
    return !node.parentElement?.closest(INJECTED_SEL);
  }

  function getFileName(card) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (!t || t.length < 2) continue;
      if (SKIP_TEXT_RE.test(t)) continue;
      if (!isNativeTextNode(node)) continue;
      if (t.length < 150) return t;
    }
    return card.textContent.trim().split('\n')[0].trim();
  }

  function getCardMeta(card) {
    const texts = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t && t.length > 1 && isNativeTextNode(node)) texts.push(t);
    }
    const lines = texts.find(t => /^[\d,]+\s*(lines?|строк)$/i.test(t)) || '';
    // Must cover ALL extensions from FILE_EXT_RE — otherwise ext falls through to filename-parsing fallback
    const ext   = texts.find(t => /^(md|txt|pdf|docx?|csv|json|ts|tsx|js|jsx|py|html|xml|png|jpg|jpeg|yaml|yml|toml|sh|rb|go|rs|swift|kt)$/i.test(t)) || '';
    return { lines, ext };
  }

  // Extracts line count from card meta (e.g. "42 lines" → 42).
  // Files without line data — "Large" (Claude doesn't show lines for large files),
  // returns Infinity so they sort first in line-count sorting.
  function getLineCount(card) {
    const meta = getCardMeta(card);
    // "1,187 lines" → strip commas → "1187" → 1187
    const m = meta.lines.match(/^([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : Infinity;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NATIVE CHECKBOX
  // ═══════════════════════════════════════════════════════════════════════════

  function findNativeCheckbox(card) {
    // :not(.cfilesex-list-cb) — exclude OUR checkbox.
    // Native on Claude — button[role="checkbox"] (Radix UI) or input inside native content.
    // Without :not our input[type="checkbox"] matches first → isNativeChecked reads our state,
    // clickNativeCheckbox clicks us → native checkbox never toggles → phantom selections.
    return card.querySelector('input[type="checkbox"]:not(.cfilesex-list-cb)')
        || card.querySelector('[role="checkbox"]')
        || card.querySelector('[aria-checked]');
  }
  function isNativeChecked(card) {
    const cb = findNativeCheckbox(card);
    if (!cb) return false;
    if (cb.type === 'checkbox') return cb.checked;
    return cb.getAttribute('aria-checked') === 'true' || cb.dataset.state === 'checked';
  }
  function clickNativeCheckbox(card) {
    const cb = findNativeCheckbox(card);
    // No stopPropagation here: React 17+ uses event delegation on root.
    // stopPropagation blocked bubbling → React never received the event →
    // native checkbox NEVER toggled.
    // Native checkbox on Claude is <input type="checkbox" class="sr-only peer"> inside <label>,
    // not Radix <button role="checkbox">. The mouseover fallback handles lazy-rendered checkboxes.
    if (cb) { cb.click(); return; }
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    setTimeout(() => { const cb2 = findNativeCheckbox(card); if (cb2) cb2.click(); }, 80);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION BADGES
  // ═══════════════════════════════════════════════════════════════════════════

  function updateVersionBadges() {
    const grid = S.grid;
    if (!grid) return;
    const cards = getLiveCards(grid);
    S.versionMap = analyzeVersions(cards, S.originalOrder || cards);
    cards.forEach(card => {
      const badge = card.querySelector('.cfilesex-ver-badge');
      if (!badge) return;
      badge.className = 'cfilesex-ver-badge';
      card.classList.remove('cfilesex-is-outdated');
      badge.textContent = '';
      if (!S.versionsActive || !S.enabled) return;
      const info = S.versionMap.get(card) || {};
      // OLD takes priority over D in badge text — but both get the same card-level class.
      // Unified cfilesex-is-outdated ensures D and OLD behave identically for:
      // Select All, name dimming, Outdated filter, and any future per-card logic.
      if (info.isOld) {
        badge.textContent = 'OLD'; badge.classList.add('cfilesex-badge-old');
        card.classList.add('cfilesex-is-outdated');
      } else if (info.isDuplicate) {
        badge.textContent = 'D'; badge.classList.add('cfilesex-badge-d');
        card.classList.add('cfilesex-is-outdated');
      }
    });
  }

  function isOutdated(card) {
    if (!S.versionMap) return false;
    const info = S.versionMap.get(card);
    return info ? (info.isDuplicate || info.isOld) : false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW SWITCHING
  // ═══════════════════════════════════════════════════════════════════════════

  function applyView(grid, view) {
    if (view === 'list' && S.enabled) {
      // Guard: don't inject into linked-list DOM (getLiveCards would return restContainer instead of cards)
      const cards = getLiveCards(grid);
      const realCount = countRealFiles(grid);
      if (realCount >= 2 && cards.length < realCount * 0.5) return;
      injectAll(grid);
      grid.classList.add(LIST_CLASS);
    } else {
      grid.classList.remove(LIST_CLASS);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SORT + FILTER — decomposed into phases
  //
  //   computeSortOrder    — DOM read → sorted array + nameCache
  //   computeFilterGroups — no DOM write, but reads S.versionMap (needs updateVersionBadges first)
  //   ensureSep           — DOM: get or create separator element
  //   applyDomOrder       — DOM write: reorder grid children (appendChild + guard)
  //   applyCardStyles     — DOM write: matched/unmatched classes + opacity
  //   applySortAndFilter  — ORCHESTRATOR: calls phases in sequence
  //
  // Each phase can be debugged independently. Sort bug? → computeSortOrder.
  // Filter bug? → computeFilterGroups. Flicker? → applyDomOrder. Styling? → applyCardStyles.
  // ═══════════════════════════════════════════════════════════════════════════

  // Phase: Sort cards.
  // Reads DOM (getFileName, getLineCount) to build caches, then sorts.
  // Returns sorted array + nameCache (reused by filter phase).
  //
  // Sort modes:
  //   orig  : Claude's native order (newest first)
  //   az    : name A→Z, tie-break: newest first
  //   za    : name Z→A, tie-break: newest first
  //   lines : lines desc (Large on top), tie-break: name A→Z, then newest first
  //
  // "newest first" = lower originalOrder index = added to DOM earlier by Claude
  function computeSortOrder(cards, sortMode, originalOrder) {
    // Cache names once — getFileName does a DOM walk, calling it N*logN times is expensive
    const nameCache = new Map(cards.map(c => [c, getFileName(c).toLowerCase()]));

    // Cache positions in originalOrder — so tie-breaking is O(1), not O(N)
    const orderIndex = new Map(originalOrder.map((c, i) => [c, i]));

    // Cache line counts — getLineCount does a DOM walk, same as nameCache
    const linesCache = sortMode === 'lines'
      ? new Map(cards.map(c => [c, getLineCount(c)]))
      : null;

    let sorted;
    if (sortMode === 'orig') {
      // Filter to cards present in current getLiveCards — S.originalOrder may contain
      // cards that moved from direct children to nested descendants (grid.contains=true
      // but not in getLiveCards). Without filter, nameCache.get(card) returns undefined → crash.
      const cardSet = new Set(cards);
      sorted = originalOrder.filter(c => cardSet.has(c));
    } else if (sortMode === 'lines') {
      sorted = [...cards].sort((a, b) => {
        const la = linesCache.get(a);  // Infinity for Large files
        const lb = linesCache.get(b);
        if (la !== lb) return lb - la;
        const cmp = safeCompare(nameCache.get(a), nameCache.get(b));
        if (cmp !== 0) return cmp;
        return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
      });
    } else {
      sorted = [...cards].sort((a, b) => {
        const na = nameCache.get(a);
        const nb = nameCache.get(b);
        const cmp = sortMode === 'az' ? safeCompare(na, nb) : safeCompare(nb, na);
        if (cmp !== 0) return cmp;
        return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
      });
    }
    return { sorted, nameCache };
  }

  // Phase: Split sorted cards into matched/unmatched groups.
  // No DOM writes. But NOT pure — isOutdated() reads S.versionMap,
  // so updateVersionBadges() MUST run before this function.
  function computeFilterGroups(sorted, query, hasOutFilter, nameCache) {
    const matched   = [];
    const unmatched = [];
    sorted.forEach(card => {
      let matches = true;
      if (query && !nameCache.get(card).includes(query)) matches = false;
      if (hasOutFilter && !isOutdated(card)) matches = false;
      if (matches) matched.push(card); else unmatched.push(card);
    });
    return { matched, unmatched };
  }

  // Helper: get or create the separator element between matched/unmatched groups.
  function ensureSep() {
    let sep = document.getElementById(SEP_ID);
    if (!sep) {
      sep = document.createElement('div');
      sep.id = SEP_ID;
      sep.style.display = 'none';
      const l1 = document.createElement('div'); l1.className = 'cfilesex-sep-line';
      const sl = document.createElement('span'); sl.className = 'cfilesex-sep-label';
      const l2 = document.createElement('div'); l2.className = 'cfilesex-sep-line';
      sep.appendChild(l1); sep.appendChild(sl); sep.appendChild(l2);
    }
    return sep;
  }

  // Phase: Reorder grid's DOM children to match desired order.
  // Only does appendChild when physical order differs from desired.
  // sep is ALWAYS included (at end if unused) — otherwise if sep is in DOM but not in
  // desiredOrder, length comparison always mismatches → needsReorder = true → infinite mutations.
  //
  // This breaks the React↔watchGrid feedback loop via two mechanisms:
  //   1. S.ownMutation = true for 200ms — watchGrid ignores all mutations during this window
  //   2. needsReorder check — if order is already correct, skip appendChild entirely
  function applyDomOrder(grid, matched, unmatched, hasFilter, sep) {
    const desiredOrder = [...matched];
    if (hasFilter && unmatched.length > 0) {
      desiredOrder.push(sep);
      desiredOrder.push(...unmatched);
    } else {
      desiredOrder.push(...unmatched);
      desiredOrder.push(sep);  // at end, hidden (display:none set by applyCardStyles)
    }

    // Compare only managed elements (cards + sep), not React's spacer divs (<div></div>).
    const desiredSet = new Set(desiredOrder);
    const managedChildren = Array.from(grid.children).filter(c => desiredSet.has(c));
    const needsReorder = desiredOrder.length !== managedChildren.length ||
      desiredOrder.some((el, i) => el !== managedChildren[i]);

    if (needsReorder) {
      // Guard: suppress watchGrid observer while we reorder cards.
      // 200ms covers our synchronous appendChild + React reconciliation (typically 1-2 frames).
      // setTimeout(0) was too short — React's async reconciliation would fire MO events after
      // ownMutation was already false, causing watchGrid → applySortAndFilter feedback loop.
      // clearTimeout ensures back-to-back calls don't leave stale timers.
      clearTimeout(S.ownMutationTimer);
      S.ownMutation = true;
      desiredOrder.forEach(el => grid.appendChild(el));
      S.ownMutationTimer = setTimeout(() => { S.ownMutation = false; }, 200);
    }
  }

  // Phase: Apply matched/unmatched visual styles to cards and separator.
  // Only sets CSS classes and opacity — does not generate childList mutations.
  function applyCardStyles(matched, unmatched, hasFilter, sep) {
    matched.forEach(card => {
      card.classList.remove(UNMATCHED_CL);
      card.style.opacity = '';
    });

    if (hasFilter && unmatched.length > 0) {
      const sl = sep.querySelector('.cfilesex-sep-label');
      if (sl) sl.textContent = `— ${unmatched.length} not matching —`;
      sep.style.display = '';
      unmatched.forEach(card => {
        card.classList.add(UNMATCHED_CL);
        card.style.opacity = '0.3';
      });
    } else {
      sep.style.display = 'none';
      unmatched.forEach(card => {
        card.classList.remove(UNMATCHED_CL);
        card.style.opacity = '';
      });
    }
  }

  // ── ORCHESTRATOR ─────────────────────────────────────────────────────────
  // Calls phases in sequence. Handles guards, state maintenance, and post-update.
  function applySortAndFilter() {
    const grid = S.grid;
    if (!grid) return null;
    const cards = getLiveCards(grid);

    // Guard: linked-list DOM. Claude sometimes renders cards recursively (card2 nested inside card1).
    // getLiveCards sees 1-3 elements (card1 + restContainer), but there are 40 files.
    // Sorting/injecting in this state would show garbage (restContainer is not a card).
    // Skip — watchGrid will call us again when React flattens the DOM.
    //
    // NO CLEANUP here: this guard also fires during transient React reconciliation after our
    // applyDomOrder appendChild calls — React briefly nests direct children, making
    // cards.length drop below threshold. Cleaning up filter state (UNMATCHED_CL, opacity,
    // LIST_CLASS, sep) in this transient would UNDO the correct filter result that was just
    // applied. On genuine initial linked-list load, no filter state exists yet (S.originalOrder
    // is null), so cleanup is unnecessary. On SPA navigation, resetState() already handles it.
    const realCount = countRealFiles(grid);
    if (realCount >= 2 && cards.length < realCount * 0.5) {
      return null;
    }

    // Maintain originalOrder — track card insertion order for "By date" sort
    if (!S.originalOrder) {
      S.originalOrder = [...cards];
    } else {
      S.originalOrder = S.originalOrder.filter(c => grid.contains(c));
      // Set for O(1) lookup — includes() would be O(N) per card
      const orderSet = new Set(S.originalOrder);
      // New cards are newest — prepend so they get lowest indices (= newest first).
      // push() would give them highest indices = appear last in orig sort and tie-breaks.
      const newCards = [];
      for (const c of cards) {
        if (!orderSet.has(c)) { newCards.push(c); if (S.enabled) injectListElements(c); }
      }
      if (newCards.length > 0) {
        S.originalOrder = [...newCards, ...S.originalOrder];
      }
    }

    // Phase 1: Sort
    const { sorted, nameCache } = computeSortOrder(cards, S.currentSort, S.originalOrder);

    // Phase 2: Version badges (must run before filter — isOutdated reads S.versionMap)
    updateVersionBadges();

    // Phase 3: Filter
    const q            = S.enabled ? S.filterText.toLowerCase().trim() : '';
    const hasOutFilter = S.enabled && S.showOutdated && S.versionsActive;
    const hasFilter    = q || hasOutFilter;
    const { matched, unmatched } = computeFilterGroups(sorted, q, hasOutFilter, nameCache);

    // Phase 3½: Cache matched set in state.
    // NOTE: getMatchedCards no longer reads S.matchedSet (v6.3.4) — it recomputes from live DOM
    // (badge text for outdated, getFileName for text filter) to avoid stale identity/class issues
    // after React reconciliation. S.matchedSet is retained for potential future sync consumers.
    S.matchedSet = hasFilter ? new Set(matched) : null;

    // Phase 4: Highlight matches in name elements
    sorted.forEach(card => highlightMatch(card, q));

    // Phase 5: DOM reorder
    const sep = ensureSep();
    const scrollY = window.scrollY;
    applyDomOrder(grid, matched, unmatched, hasFilter, sep);

    // Phase 6: Card styles
    applyCardStyles(matched, unmatched, hasFilter, sep);

    // Phase 7: Post-update
    // Restore scroll after reordering cards
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    // Enforce view mode — regardless of what happened to LIST_CLASS in guards or previous cycles.
    // Covers two edge cases:
    //   1. applyView skipped during linked-list phase (guard bailed) → re-apply now that DOM is flat
    //   2. LIST_CLASS left stale after switching to grid → remove it
    if (S.enabled) {
      if (S.currentView === 'list' && !grid.classList.contains(LIST_CLASS)) {
        applyView(grid, S.currentView);
      } else if (S.currentView !== 'list') {
        grid.classList.remove(LIST_CLASS);
      }
    }
    syncCounterRow(grid);
    return { total: sorted.length, matched: matched.length, unmatched: unmatched.length };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST ELEMENT INJECTION — decomposed into create + behavior
  //
  //   createCardElements(card)           — DOM: creates 5 elements, appends to card
  //   attachCardBehavior(card, cb, nameEl) — events: CB sync, click-forwarding, MutationObserver
  //   injectListElements(card)           — orchestrator: calls both
  //
  // Why separated: each function can be debugged independently.
  // DOM creation bug? → createCardElements. Event wiring bug? → attachCardBehavior.
  // WARNING: attachCardBehavior is NOT idempotent — calling it twice on the same card
  // adds duplicate listeners and leaks the old MutationObserver. Always call via
  // injectListElements (which has the createCardElements null-guard).
  // ═══════════════════════════════════════════════════════════════════════════

  // Map of per-card observers — so we can properly disconnect them in resetState
  const cardObservers = new Map();

  // Create and append the 5 list-mode elements to a card.
  // Returns { cb, nameEl } for use by attachCardBehavior, or null if already injected.
  function createCardElements(card) {
    if (card.querySelector('.cfilesex-list-name')) return null;
    const name = getFileName(card);
    const meta = getCardMeta(card);
    const dotIdx = name.lastIndexOf('.');
    const ext = meta.ext || (dotIdx > 0 ? name.slice(dotIdx + 1, dotIdx + 6).toUpperCase() : '?');

    const cbWrap = document.createElement('span');
    cbWrap.className = 'cfilesex-list-cb-wrap';
    // Block all pointer/mouse/click event propagation from checkbox to card.
    // Without this, React's card handler catches the click → opens file preview
    // and/or toggles native checkbox again → phantom selections.
    for (const evt of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      cbWrap.addEventListener(evt, (e) => e.stopPropagation());
    }
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'cfilesex-list-cb';
    cbWrap.appendChild(cb);

    const badge  = document.createElement('span'); badge.className  = 'cfilesex-ver-badge';
    const extEl  = document.createElement('span'); extEl.className  = 'cfilesex-list-ext';  extEl.textContent = ext;
    const nameEl = document.createElement('span'); nameEl.className = 'cfilesex-list-name'; nameEl.textContent = name; nameEl.title = name;
    const metaEl = document.createElement('span'); metaEl.className = 'cfilesex-list-meta';
    // Claude doesn't show line count for large files — mark as Large
    if (meta.lines) {
      metaEl.textContent = meta.lines;
    } else {
      metaEl.textContent = 'Large';
      metaEl.classList.add('cfilesex-meta-large');
    }

    card.appendChild(cbWrap); card.appendChild(badge); card.appendChild(extEl);
    card.appendChild(nameEl); card.appendChild(metaEl);

    return { cb, nameEl };
  }

  // Wire up event handlers and MutationObserver on a card's injected elements.
  // Handles three interactions:
  //   1. Our checkbox change → sync to native checkbox
  //   2. File name click → forward to native clickable element (preview)
  //   3. Native checkbox change → sync to our checkbox (MutationObserver)
  function attachCardBehavior(card, cb, nameEl) {
    // 1. Our CB → native CB
    cb.addEventListener('change', () => {
      if (cb.checked !== isNativeChecked(card)) clickNativeCheckbox(card);
      card.classList.toggle('cfilesex-row-selected', cb.checked);
      syncCounterRow(S.grid);
    });

    // 2. Click on file name → open preview.
    // React attaches handler to a native child element inside the card,
    // our elements are not React-managed, clicks on them don't reach React.
    // Forward programmatically, only from nameEl — checkbox, badge, ext are not affected.
    let _clickForwarding = false;
    nameEl.addEventListener('click', (e) => {
      if (_clickForwarding) return;
      if (!card.closest('.' + LIST_CLASS)) return;
      _clickForwarding = true;
      try {
        // Find element for preview — exclude checkboxes (native + ours).
        // Without exclusion: button:not(.cfilesex-list-cb) matches native <button role="checkbox">
        // → clicking file name toggles checkbox instead of opening preview.
        const target = card.querySelector(
          'a[href], button:not(.cfilesex-list-cb):not([role="checkbox"]):not([aria-checked]), [role="button"]'
        );
        if (target) { target.click(); }
      } finally {
        _clickForwarding = false;
      }
    });

    // 3. Native CB → our CB (MutationObserver on card attributes)
    const obs = new MutationObserver(() => {
      const checked = isNativeChecked(card);
      if (cb.checked !== checked) {
        cb.checked = checked;
        card.classList.toggle('cfilesex-row-selected', checked);
        syncCounterRow(S.grid);
      }
    });
    obs.observe(card, { subtree: true, attributes: true, attributeFilter: ['checked', 'aria-checked', 'data-state'] });
    cardObservers.set(card, obs);
  }

  function injectListElements(card) {
    const els = createCardElements(card);
    if (!els) return;  // already injected
    attachCardBehavior(card, els.cb, els.nameEl);
  }

  function injectAll(grid) { getLiveCards(grid).forEach(c => injectListElements(c)); }

  // ═══════════════════════════════════════════════════════════════════════════
  // COUNTER ROW + SELECT ALL
  // ═══════════════════════════════════════════════════════════════════════════

  function buildCounterRow(insertParent, insertBefore) {
    let row = document.getElementById(COUNTER_ID);
    if (row) return row;

    row = document.createElement('div');
    row.id = COUNTER_ID;

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = 'cfilesex-selall-cb';

    const lbl = document.createElement('span');
    lbl.id = 'cfilesex-selall-lbl';
    lbl.className = 'cfilesex-selall-lbl';

    const toggle = () => {
      const targets = getMatchedCards(S.grid);
      // Nothing to select — possible when outdated filter shows 0 matches.
      // Without this guard, [].every() returns true → allChecked is true → no-op → confusing.
      if (targets.length === 0) {
        syncCounterRow(S.grid);
        return;
      }
      const allChecked = targets.every(c => isNativeChecked(c));
      targets.forEach(card => {
        const ourCb = card.querySelector('.cfilesex-list-cb');
        if (allChecked) {
          if (isNativeChecked(card)) clickNativeCheckbox(card);
          if (ourCb) ourCb.checked = false;
          card.classList.remove('cfilesex-row-selected');
        } else {
          if (!isNativeChecked(card)) clickNativeCheckbox(card);
          if (ourCb) ourCb.checked = true;
          card.classList.add('cfilesex-row-selected');
        }
      });
      // 120ms: catch synchronous checkbox toggles.
      // Per-card MutationObservers handle late toggles from mouseover fallback.
      setTimeout(() => syncCounterRow(S.grid), 120);
    };

    cb.addEventListener('change', e => { e.stopPropagation(); toggle(); });
    row.addEventListener('click', e => { if (e.target !== cb) toggle(); });
    row.appendChild(cb);
    row.appendChild(lbl);

    insertParent.insertBefore(row, insertBefore);
    return row;
  }

  // Module-level filter debounce — otherwise when toolbar is rebuilt,
  // old pending timeout would linger and double applySortAndFilter could fire
  let _filterDebounce = null;
  let _syncDebounce   = null;
  function syncCounterRow(grid) {
    // 50ms debounce — during Select All this is called N times in a row (per card observer)
    clearTimeout(_syncDebounce);
    _syncDebounce = setTimeout(() => _doSyncCounterRow(grid), 50);
  }

  function _doSyncCounterRow(grid) {
    if (!grid) return;
    const cb  = document.getElementById('cfilesex-selall-cb');
    const lbl = document.getElementById('cfilesex-selall-lbl');
    if (!cb || !lbl) return;

    const matched      = getMatchedCards(grid);
    const all          = getLiveCards(grid);
    // Count only matched — UNMATCHED files don't participate in Select All operations
    const checkedCount = matched.filter(c => isNativeChecked(c)).length;
    const totalChecked = all.filter(c => isNativeChecked(c)).length;
    const matchedCount = matched.length;

    if (checkedCount === 0)                 { cb.checked = false; cb.indeterminate = false; }
    else if (checkedCount >= matchedCount)  { cb.checked = true;  cb.indeterminate = false; }
    else                                    { cb.checked = false; cb.indeterminate = true;  }

    // Show honest picture: how many checked out of all, but operations are matched-only
    if (totalChecked > 0) lbl.textContent = `${totalChecked} of ${all.length} selected`;
    else                  lbl.textContent = `Select all visible (${matchedCount})`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MASTER ON/OFF
  // ═══════════════════════════════════════════════════════════════════════════

  // Reads S.grid (always current), queries wrap/onBtn from DOM by ID.
  // No closure parameters — safe to call from any handler at any time.
  function applyMasterState() {
    const grid       = S.grid;
    const wrap       = document.getElementById(WRAP_ID);
    const onBtn      = document.getElementById('cfilesex-on-btn');
    const toolbar    = document.getElementById(TOOLBAR_ID);
    const counterRow = document.getElementById(COUNTER_ID);
    if (!grid || !wrap || !onBtn) return;

    if (S.enabled) {
      onBtn.classList.add('cfilesex-on-active');
      onBtn.title = 'Turn off file manager extensions';
      if (toolbar)    toolbar.style.opacity      = '';
      if (toolbar)    toolbar.style.pointerEvents = '';
      if (counterRow) counterRow.style.display   = '';
      applyView(grid, S.currentView);
      applySortAndFilter();
    } else {
      onBtn.classList.remove('cfilesex-on-active');
      onBtn.title = 'Turn on file manager extensions';
      if (toolbar)    { toolbar.style.opacity = '0.35'; toolbar.style.pointerEvents = 'none'; }
      if (counterRow) counterRow.style.display = 'none';
      S.matchedSet = null;
      grid.classList.remove(LIST_CLASS);
      getLiveCards(grid).forEach(c => {
        // Uncheck native checkboxes — so phantom selections don't persist after OFF
        if (isNativeChecked(c)) clickNativeCheckbox(c);
        const ourCb = c.querySelector('.cfilesex-list-cb');
        if (ourCb) ourCb.checked = false;
        c.classList.remove('cfilesex-row-selected');
        c.classList.remove(UNMATCHED_CL);
        c.style.opacity = '';
        c.style.display = '';
        const badge = c.querySelector('.cfilesex-ver-badge');
        if (badge) { badge.textContent = ''; badge.className = 'cfilesex-ver-badge'; }
        c.classList.remove('cfilesex-is-outdated');
      });
      const sep = document.getElementById(SEP_ID);
      if (sep) sep.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HIGHLIGHT
  // ═══════════════════════════════════════════════════════════════════════════

  const originalTexts = new WeakMap();

  function highlightMatch(card, query) {
    const nameEl = card.querySelector('.cfilesex-list-name');
    // In Grid mode our nameEl is absent — don't touch React-managed nodes,
    // innerHTML = '' on them breaks event listeners and can disrupt reconciliation
    if (!nameEl) return;
    highlightEl(nameEl, query, nameEl.textContent);
  }

  function highlightEl(el, query, orig) {
    if (!originalTexts.has(el)) originalTexts.set(el, orig ?? el.textContent);
    const original = originalTexts.get(el);
    el.innerHTML = '';
    if (!query) { el.appendChild(document.createTextNode(original)); return; }
    const idx = original.toLowerCase().indexOf(query);
    if (idx === -1) { el.appendChild(document.createTextNode(original)); return; }
    if (idx > 0) el.appendChild(document.createTextNode(original.slice(0, idx)));
    const mark = document.createElement('mark');
    mark.style.cssText = 'background:rgba(215,154,72,0.4);color:inherit;border-radius:2px;padding:0 1px;';
    mark.textContent = original.slice(idx, idx + query.length);
    el.appendChild(mark);
    if (idx + query.length < original.length)
      el.appendChild(document.createTextNode(original.slice(idx + query.length)));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRID OBSERVER
  // ═══════════════════════════════════════════════════════════════════════════

  function watchGrid(grid) {
    S.gridObserver?.disconnect();
    // Reset pending timer from previous observer — it could linger
    // after disconnect() and fire with stale state
    clearTimeout(S.watchPending);
    S.watchPending = null;

    S.gridObserver = new MutationObserver((mutations) => {
      // Our own DOM operations (applySortAndFilter moves cards) —
      // don't react, otherwise feedback loop: sort → mutation → sort → mutation → flicker
      if (S.ownMutation) return;

      if (!document.getElementById(WRAP_ID)) {
        cardObservers.forEach(obs => obs.disconnect());
        cardObservers.clear();
        S.originalOrder = null;
        // Use S.watchPending so this timeout gets cancelled in resetState
        clearTimeout(S.watchPending);
        S.watchPending = setTimeout(() => {
          S.watchPending = null;
          if (!document.getElementById(WRAP_ID)) tryInit();
        }, 300);
        return;
      }

      let changed = false;
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        // Only react to grid-level mutations (cards added/removed from grid or its parent).
        // Mutations inside existing cards (checkbox toggle, hover effects, React re-renders)
        // must NOT trigger applySortAndFilter — otherwise checkbox click causes reorder.
        if (m.target !== grid && m.target !== grid.parentNode) continue;
        if ([...m.addedNodes, ...m.removedNodes].some(n =>
          n.nodeType === 1 && n.id !== SEP_ID && n.id !== COUNTER_ID
          && !n.closest?.('#' + WRAP_ID)
          && !(n.className && typeof n.className === 'string' && n.className.startsWith('cfilesex-'))
        )) { changed = true; break; }
      }

      if (changed && !S.watchPending) {
        S.watchPending = setTimeout(() => {
          S.watchPending = null;
          if (!grid.isConnected) {
            resetState();
            tryInit();
            return;
          }
          const count = countRealFiles(grid);
          if (count < 2) {
            setToolbarVisible(false);
          } else {
            setToolbarVisible(true);
            if (S.enabled) applySortAndFilter();
          }
        }, 150);
      }
    });
    if (grid.parentNode) {
      S.gridObserver.observe(grid.parentNode, { childList: true, subtree: false });
    }
    // subtree: true — needed to receive React flatten events (linked-list → flat children).
    // The m.target depth check in the callback filters out intra-card mutations
    // (checkbox toggles, hover effects) — only grid-level changes trigger applySortAndFilter.
    S.gridObserver.observe(grid, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CSS — all classes prefixed with cfilesex
  // ═══════════════════════════════════════════════════════════════════════════

  const CSS = `
    #cfilesex-wrap {
      position: relative;
      border: none;
      border-radius: 10px;
      padding: 10px 12px 22px 12px;
      margin-bottom: 8px;
      box-sizing: border-box;
      /* box-shadow instead of border — Tailwind preflight on claude.ai resets border-width:0
         on all elements (*). box-shadow is a separate CSS property, unaffected.
         Hardcoded gray: --border-200 may resolve to a (nearly) transparent color. */
      box-shadow: 0 0 0 1.5px rgba(128,128,128,0.25);
    }
    #cfilesex-wrap::after {
      content: 'files ex 6.3.6';
      position: absolute;
      bottom: 5px;
      right: 11px;
      font-size: 9.5px;
      font-family: inherit;
      color: var(--text-300, rgba(0,0,0,0.2));
      letter-spacing: 0.08em;
      text-transform: lowercase;
      pointer-events: none;
      user-select: none;
    }
    #cfilesex-header {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 8px;
    }
    #cfilesex-on-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px 3px 7px;
      border-radius: 20px;
      border: 1.5px solid rgba(0,0,0,0.18);
      background: var(--bg-100, rgba(255,255,255,0.7));
      cursor: pointer;
      font-size: 11.5px;
      font-family: inherit;
      color: var(--text-300, #aaa);
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      user-select: none;
      white-space: nowrap;
    }
    #cfilesex-on-btn:hover {
      border-color: rgba(0,0,0,0.35);
      color: var(--text-200, #555);
    }
    #cfilesex-on-btn.cfilesex-on-active {
      border-color: rgba(50,160,80,0.7);
      background: rgba(50,160,80,0.1);
      color: rgba(30,130,55,1);
      font-weight: 600;
    }
    #cfilesex-on-btn .cfilesex-on-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
      opacity: 0.6;
    }
    #cfilesex-on-btn.cfilesex-on-active .cfilesex-on-dot { opacity: 1; }

    #cfilesex-toolbar {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      font-family: inherit;
      color: inherit;
      box-sizing: border-box;
      transition: opacity 0.2s;
    }
    #cfilesex-toolbar .cfilesex-row {
      display: flex; align-items: center; gap: 5px; flex-wrap: wrap; width: 100%;
    }
    #cfilesex-toolbar .cfilesex-label {
      color: var(--text-300, #999); font-size: 11px; flex-shrink: 0;
    }

    #cfilesex-toolbar .cfilesex-btn {
      padding: 3px 8px; border-radius: 6px;
      border: 1px solid var(--border-200, #d8d8d8);
      background: var(--bg-100, rgba(255,255,255,0.7));
      cursor: pointer; font-size: 11.5px; font-family: inherit;
      color: var(--text-200, #555);
      transition: background 0.12s, border-color 0.12s;
      white-space: nowrap; line-height: 1.4; flex-shrink: 0; user-select: none;
    }
    #cfilesex-toolbar .cfilesex-btn:hover { background: var(--bg-200, rgba(0,0,0,0.06)); color: var(--text-100, #222); border-color: #bbb; }
    #cfilesex-toolbar .cfilesex-btn.cfilesex-active {
      background: rgba(215,154,72,0.16); border-color: rgba(215,154,72,0.65);
      color: var(--text-100, #222); font-weight: 600;
    }

    #cfilesex-view-toggle {
      display: inline-flex; border: 1px solid var(--border-200, #ccc);
      border-radius: 7px; overflow: hidden; flex-shrink: 0;
    }
    #cfilesex-view-toggle button {
      padding: 3px 9px; border: none; border-right: 1px solid var(--border-200, #ccc);
      background: var(--bg-100, rgba(255,255,255,0.7)); cursor: pointer;
      font-size: 11.5px; font-family: inherit; color: var(--text-200, #666);
      transition: background 0.12s, color 0.12s; white-space: nowrap;
      line-height: 1.4; user-select: none;
    }
    #cfilesex-view-toggle button:last-child { border-right: none; }
    #cfilesex-view-toggle button:hover { background: var(--bg-200, rgba(0,0,0,0.06)); color: var(--text-100, #222); }
    #cfilesex-view-toggle button.cfilesex-view-active {
      background: rgba(0,0,0,0.09); color: var(--text-100, #111); font-weight: 600;
    }

    #cfilesex-toolbar .cfilesex-btn-ver { border-color: rgba(100,140,255,0.4); }
    #cfilesex-toolbar .cfilesex-btn-ver:hover { background: rgba(100,140,255,0.08); border-color: rgba(100,140,255,0.6); }
    #cfilesex-toolbar .cfilesex-btn-ver.cfilesex-active { background: rgba(100,140,255,0.14); border-color: rgba(100,140,255,0.7); color: rgba(45,85,210,1); font-weight: 600; }

    #cfilesex-toolbar .cfilesex-btn-out { border-color: rgba(210,80,80,0.35); }
    #cfilesex-toolbar .cfilesex-btn-out:hover { background: rgba(210,80,80,0.07); border-color: rgba(210,80,80,0.55); }
    #cfilesex-toolbar .cfilesex-btn-out.cfilesex-active { background: rgba(210,80,80,0.11); border-color: rgba(210,80,80,0.65); color: rgba(165,30,30,1); font-weight: 600; }

    #cfilesex-toolbar .cfilesex-help {
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 50%;
      border: 1.5px solid var(--border-200, #ccc);
      background: var(--bg-100, rgba(255,255,255,0.8));
      font-size: 11px; font-weight: 700; color: var(--text-200, #777);
      cursor: help; flex-shrink: 0; user-select: none;
      box-shadow: 0 1px 3px rgba(0,0,0,0.07);
      transition: border-color 0.12s, background 0.12s;
    }
    #cfilesex-toolbar .cfilesex-help:hover { border-color: rgba(100,140,255,0.55); background: rgba(100,140,255,0.07); }

    .cfilesex-tooltip-global {
      position: fixed; width: 268px;
      background: var(--bg-100, #ffffff); border: 1px solid var(--border-200, rgba(0,0,0,0.16));
      border-radius: 10px; padding: 12px 14px;
      font-size: 11.5px; color: var(--text-100, #222); line-height: 1.6;
      box-shadow: 0 8px 28px rgba(0,0,0,0.18); z-index: 999999;
      white-space: normal; display: none;
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      isolation: isolate;
      overflow-y: auto; box-sizing: border-box;
    }

    #cfilesex-toolbar .cfilesex-search {
      flex: 1; min-width: 80px; max-width: 140px; padding: 3px 7px; border-radius: 6px;
      border: 1px solid var(--border-200, #d8d8d8);
      background: var(--bg-100, rgba(255,255,255,0.7));
      font-size: 11.5px; font-family: inherit; color: inherit;
      outline: none; transition: border-color 0.15s; line-height: 1.4;
    }
    #cfilesex-toolbar .cfilesex-search:focus { border-color: rgba(215,154,72,0.65); }
    #cfilesex-toolbar .cfilesex-search::placeholder { color: var(--text-300, #aaa); }
    #cfilesex-toolbar .cfilesex-hint-text { font-size: 10px; color: var(--text-300, #bbb); flex-shrink: 0; }
    #cfilesex-toolbar .cfilesex-divider { width: 1px; height: 14px; background: var(--border-200, #e0e0e0); flex-shrink: 0; }

    #cfilesex-counter-row {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 8px; margin: 4px 0 0 0;
      border-top: 1.5px dashed var(--border-200, #e0e0e0);
      font-size: 11.5px; font-family: inherit; color: var(--text-200, #666);
      box-sizing: border-box; cursor: pointer; user-select: none;
      border-radius: 0 0 6px 6px; transition: background 0.1s;
    }
    #cfilesex-counter-row:hover { background: var(--bg-200, rgba(0,0,0,0.03)); }
    #cfilesex-counter-row input[type=checkbox] { width: 14px; height: 14px; cursor: pointer; accent-color: rgba(215,154,72,0.9); flex-shrink: 0; }
    .cfilesex-selall-lbl { font-size: 11px; color: var(--text-300, #aaa); }

    #cfilesex-filter-sep {
      width: 100%; display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; box-sizing: border-box; pointer-events: none;
    }
    .cfilesex-sep-line { flex: 1; height: 1px; background: var(--border-200, #e0e0e0); }
    .cfilesex-sep-label { font-size: 10px; color: var(--text-300, #bbb); white-space: nowrap; font-family: inherit; }

    /* Our elements hidden in grid mode */
    .cfilesex-list-name, .cfilesex-list-meta, .cfilesex-list-ext,
    .cfilesex-list-cb-wrap, .cfilesex-ver-badge { display: none !important; }

    /* ══ LIST MODE ══ */
    .${LIST_CLASS} { display: flex !important; flex-direction: column !important; gap: 0 !important; grid-template-columns: none !important; }
    .${LIST_CLASS} > *:not(#cfilesex-filter-sep) {
      display: flex !important; flex-direction: row !important; align-items: center !important;
      gap: 7px !important; padding: 5px 8px !important; margin: 0 !important;
      border-radius: 6px !important; border: none !important;
      border-bottom: 1px solid var(--border-100, rgba(0,0,0,0.05)) !important;
      min-height: 0 !important; box-shadow: none !important; width: 100% !important;
      box-sizing: border-box !important; transition: background 0.1s, opacity 0.15s;
      position: relative !important;
    }
    .${LIST_CLASS} > *:not(#cfilesex-filter-sep):last-child { border-bottom: none !important; }
    .${LIST_CLASS} > *:not(#cfilesex-filter-sep):not(.${UNMATCHED_CL}):hover { background: var(--bg-200, rgba(0,0,0,0.04)) !important; }
    .${LIST_CLASS} > *.cfilesex-row-selected { background: rgba(215,154,72,0.08) !important; }
    .${LIST_CLASS} > * .cfilesex-list-cb-wrap { display: flex !important; align-items: center; flex-shrink: 0; }
    .${LIST_CLASS} > * .cfilesex-list-cb { width: 14px; height: 14px; cursor: pointer; accent-color: rgba(215,154,72,0.9); flex-shrink: 0; }
    .${LIST_CLASS} > * .cfilesex-ver-badge {
      display: inline-block !important; flex-shrink: 0 !important; font-size: 9px !important;
      font-weight: 700 !important; padding: 1px 0 !important; border-radius: 3px !important;
      letter-spacing: 0.04em !important; text-transform: uppercase !important; line-height: 1.4 !important;
      width: 30px !important; text-align: center !important; box-sizing: border-box !important;
    }
    /* Empty badge — invisible spacer, takes the same width */
    .${LIST_CLASS} > * .cfilesex-ver-badge:empty { border: 1px solid transparent !important; }
    .cfilesex-badge-d { background: rgba(100,140,255,0.12) !important; color: rgba(50,88,210,0.9) !important; border: 1px solid rgba(100,140,255,0.28) !important; }
    .cfilesex-badge-old { background: rgba(180,180,180,0.1) !important; color: rgba(120,120,120,0.85) !important; border: 1px solid rgba(180,180,180,0.28) !important; }
    .${LIST_CLASS} > * .cfilesex-list-ext {
      display: inline-block !important; flex-shrink: 0 !important; font-size: 9.5px !important;
      font-weight: 600 !important; padding: 1px 0 !important; border-radius: 4px !important;
      background: var(--bg-300, rgba(0,0,0,0.08)) !important; color: var(--text-200, #666) !important;
      letter-spacing: 0.03em !important; text-transform: uppercase !important;
      width: 36px !important; text-align: center !important; box-sizing: border-box !important;
    }
    .${LIST_CLASS} > * .cfilesex-list-name {
      display: block !important; flex: 1 !important; min-width: 0 !important;
      overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;
      font-size: 12.5px !important; color: var(--text-100, #333) !important;
      cursor: pointer !important; border-radius: 3px !important; padding: 1px 4px !important;
    }
    .${LIST_CLASS} > *:not(.${UNMATCHED_CL}) .cfilesex-list-name:hover {
      text-decoration: underline !important; text-underline-offset: 2px !important;
    }
    .${LIST_CLASS} > *.cfilesex-is-outdated .cfilesex-list-name { color: var(--text-300, #aaa) !important; }
    .${LIST_CLASS} > * .cfilesex-list-meta {
      display: inline-block !important; flex-shrink: 0 !important; font-size: 11px !important;
      color: var(--text-300, #aaa) !important; white-space: nowrap !important;
      width: 64px !important; text-align: right !important;
    }
    .${LIST_CLASS} > * .cfilesex-meta-large {
      font-style: italic !important; color: var(--text-300, #bbb) !important;
    }
    /* Native card content — hidden via sr-only pattern instead of display:none.
       display:none caused flicker: React on hover tries to show checkbox etc.,
       our !important fights back → style war → flicker. clip-path + opacity leaves
       elements in DOM for React, but invisible and unclickable for the user. */
    .${LIST_CLASS} > * > *:not(.cfilesex-list-cb-wrap):not(.cfilesex-ver-badge):not(.cfilesex-list-ext):not(.cfilesex-list-name):not(.cfilesex-list-meta) {
      position: absolute !important;
      width: 1px !important; height: 1px !important;
      padding: 0 !important; margin: -1px !important;
      overflow: hidden !important;
      clip-path: inset(50%) !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    #${STATUS_ID} { font-size: 11px; color: var(--text-300, #aaa); padding: 4px 0 8px; font-style: italic; font-family: inherit; }
  `;

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOLBAR ACTIONS — state logic extracted from button handlers
  //
  // Each method: updates S.*, saves to storage, calls applySortAndFilter.
  // Reads S.grid (always current) — never closes over buildToolbar's grid param.
  // Returns flags for the caller to update button visuals.
  // ═══════════════════════════════════════════════════════════════════════════

  // Safety net for toggle-off actions: if applySortAndFilter bailed (linked-list
  // guard, null grid), cards keep stale opacity/classes from the previous filter
  // cycle. This clears ONLY visual residue — no sort, no reorder, no injection.
  // The caller schedules a retry for the full pipeline once DOM stabilises.
  function _clearStaleFilterVisuals() {
    getLiveCards(S.grid).forEach(c => {
      c.classList.remove(UNMATCHED_CL);
      c.style.opacity = '';
    });
    const sep = document.getElementById(SEP_ID);
    if (sep) sep.style.display = 'none';
    syncCounterRow(S.grid);
  }

  const toolbarActions = {
    setSort(k) {
      if (!S.enabled) return;
      S.currentSort = k;
      save('sort', k);
      applySortAndFilter();
    },

    setView(v) {
      if (!S.enabled) return;
      S.currentView = v;
      save('view', v);
      applyView(S.grid, S.currentView);
      applySortAndFilter();
    },

    toggleVersions() {
      if (!S.enabled) return null;
      S.versionsActive = !S.versionsActive;
      save('versions', S.versionsActive);
      let outdatedChanged = false;
      if (!S.versionsActive && S.showOutdated) {
        S.showOutdated = false;
        save('outdated', false);
        outdatedChanged = true;
      }
      const result = applySortAndFilter();
      // Safety net: if pipeline bailed (linked-list guard, transient DOM) while
      // a filter was just turned OFF, cards keep stale opacity/classes from the
      // previous filter run. Clear visuals immediately; schedule retry for full
      // pipeline (sort + text filter re-apply) once DOM stabilises.
      if (!result && outdatedChanged && S.grid) {
        _clearStaleFilterVisuals();
        clearTimeout(S.watchPending);
        S.watchPending = setTimeout(() => { S.watchPending = null; applySortAndFilter(); }, 250);
      }
      return { outdatedChanged };
    },

    toggleOutdated() {
      if (!S.enabled) return null;
      S.showOutdated = !S.showOutdated;
      save('outdated', S.showOutdated);
      let versionsChanged = false;
      if (S.showOutdated && !S.versionsActive) {
        S.versionsActive = true;
        save('versions', true);
        versionsChanged = true;
      }
      const result = applySortAndFilter();
      // Safety net: pipeline may bail (linked-list guard, null grid) while the
      // outdated filter was just turned OFF. Cards keep stale opacity 0.3 and
      // UNMATCHED_CL from the previous filter-ON run. Clear immediately, then
      // retry full pipeline (restores sort + text filter) once DOM is stable.
      if (!result && !S.showOutdated && S.grid) {
        _clearStaleFilterVisuals();
        clearTimeout(S.watchPending);
        S.watchPending = setTimeout(() => { S.watchPending = null; applySortAndFilter(); }, 250);
      }
      return { versionsChanged };
    },

    toggleEnabled() {
      const firstTime = !load('ever_enabled', false);
      S.enabled = !S.enabled;
      save('enabled', S.enabled);
      if (S.enabled && firstTime) {
        save('ever_enabled', true);
        S.currentView    = 'list';  save('view', 'list');
        S.versionsActive = true;    save('versions', true);
      }
      applyMasterState();
      return { firstTime };
    },

    setFilter(text) {
      if (!S.enabled) return;
      S.filterText = text;
      clearTimeout(_filterDebounce);
      // Cancel pending watchGrid timer — it would call applySortAndFilter redundantly
      // and may hit transient React DOM state (linked-list guard → bail → wrong display).
      // Only the debounce should trigger applySortAndFilter during active typing.
      clearTimeout(S.watchPending);
      S.watchPending = null;
      _filterDebounce = setTimeout(() => applySortAndFilter(), 120);
    },

    clearFilter() {
      clearTimeout(_filterDebounce);
      clearTimeout(S.watchPending);
      S.watchPending = null;
      S.filterText = '';
      applySortAndFilter();
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOLBAR
  // ═══════════════════════════════════════════════════════════════════════════

  function buildToolbar(grid) {
    if (document.getElementById(WRAP_ID)) return;

    // Sanity check: grid must be nested in a normal page container,
    // not directly in body or detached. If not — defer and search again.
    if (!grid.parentNode || grid.parentNode === document.body || !grid.isConnected) {
      S.retryTimer = setTimeout(tryInit, 1500);
      return;
    }

    // DOM depth check: Claude's sidebar is nested ≥ 5 levels from body.
    // If grid is only 2-3 levels deep — React hasn't finished rendering,
    // element is in a transient container (manifests on hard refresh ctrl+shift+r).
    let depth = 0;
    for (let p = grid; p && p !== document.body; p = p.parentNode) depth++;
    if (depth < 4) {
      S.retryTimer = setTimeout(tryInit, 1500);
      return;
    }

    S.grid = grid;
    S.currentSort    = load('sort', 'az');
    S.currentView    = load('view', 'list');
    S.versionsActive = load('versions', false);
    S.showOutdated   = load('outdated', false);
    S.enabled        = load('enabled', false);
    if (S.showOutdated) S.versionsActive = true;

    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    wrap.appendChild(styleEl);

    // ── Header: ON button ────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.id = 'cfilesex-header';

    const onBtn = document.createElement('button');
    onBtn.id = 'cfilesex-on-btn';
    if (S.enabled) onBtn.classList.add('cfilesex-on-active');

    const dot = document.createElement('span');
    dot.className = 'cfilesex-on-dot';
    const onLabel = document.createElement('span');
    onLabel.id = 'cfilesex-on-label';
    onLabel.textContent = S.enabled ? 'ON' : 'OFF';
    onBtn.appendChild(dot);
    onBtn.appendChild(onLabel);

    onBtn.addEventListener('click', () => {
      const { firstTime } = toolbarActions.toggleEnabled();
      if (S.enabled && firstTime) {
        verBtn.classList.add('cfilesex-active');
        setViewActive('list');
      }
      onBtn.classList.toggle('cfilesex-on-active', S.enabled);
      onLabel.textContent = S.enabled ? 'ON' : 'OFF';
    });

    header.appendChild(onBtn);
    wrap.appendChild(header);

    // ── Toolbar ──────────────────────────────────────────────────────────────
    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    if (!S.enabled) { bar.style.opacity = '0.35'; bar.style.pointerEvents = 'none'; }

    // ROW 1
    const row1 = document.createElement('div');
    row1.className = 'cfilesex-row';

    const lbl = document.createElement('span');
    lbl.className = 'cfilesex-label'; lbl.textContent = 'Sort:';
    row1.appendChild(lbl);

    [{ k: 'az', t: 'A→Z' }, { k: 'za', t: 'Z→A' }, { k: 'orig', t: '↺ By date' }, { k: 'lines', t: '↕ Lines' }]
      .forEach(({ k, t }) => {
        const btn = document.createElement('button');
        btn.className = 'cfilesex-btn' + (S.currentSort === k ? ' cfilesex-active' : '');
        btn.textContent = t; btn.dataset.sort = k;
        btn.addEventListener('click', () => {
          if (!S.enabled) return;
          toolbarActions.setSort(k);
          row1.querySelectorAll('.cfilesex-btn[data-sort]').forEach(b => b.classList.toggle('cfilesex-active', b.dataset.sort === k));
        });
        row1.appendChild(btn);
      });

    row1.appendChild(mkDiv());

    const search = document.createElement('input');
    search.type = 'text'; search.className = 'cfilesex-search'; search.placeholder = '🔍 Filter...';
    // Restore value if toolbar is rebuilt after React rebuild
    if (S.filterText) search.value = S.filterText;
    S.searchEl = search;

    search.addEventListener('input', () => {
      toolbarActions.setFilter(search.value);
    });
    search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && S.filterText) {
        search.value = '';
        toolbarActions.clearFilter();
        e.stopPropagation();
      }
    });
    row1.appendChild(search);

    row1.appendChild(mkDiv());

    const viewToggle = document.createElement('div');
    viewToggle.id = 'cfilesex-view-toggle';
    const listBtn2 = document.createElement('button'); listBtn2.textContent = '☰ List'; listBtn2.dataset.view = 'list';
    const gridBtn2 = document.createElement('button'); gridBtn2.textContent = '⊞ Grid'; gridBtn2.dataset.view = 'grid';

    const setViewActive = (v) => {
      listBtn2.classList.toggle('cfilesex-view-active', v === 'list');
      gridBtn2.classList.toggle('cfilesex-view-active', v === 'grid');
    };
    setViewActive(S.currentView);

    [listBtn2, gridBtn2].forEach(btn => {
      btn.addEventListener('click', () => {
        toolbarActions.setView(btn.dataset.view);
        setViewActive(S.currentView);
      });
    });
    viewToggle.appendChild(listBtn2); viewToggle.appendChild(gridBtn2);
    row1.appendChild(viewToggle);
    bar.appendChild(row1);

    // ROW 2
    const row2 = document.createElement('div');
    row2.className = 'cfilesex-row';

    const verBtn = document.createElement('button');
    verBtn.className = 'cfilesex-btn cfilesex-btn-ver' + (S.versionsActive ? ' cfilesex-active' : '');
    verBtn.textContent = '⚑ Versions';
    verBtn.addEventListener('click', () => {
      const result = toolbarActions.toggleVersions();
      if (!result) return;  // was disabled
      verBtn.classList.toggle('cfilesex-active', S.versionsActive);
      if (result.outdatedChanged) outBtn.classList.remove('cfilesex-active');
    });
    row2.appendChild(verBtn);

    const outBtn = document.createElement('button');
    outBtn.className = 'cfilesex-btn cfilesex-btn-out' + (S.showOutdated ? ' cfilesex-active' : '');
    outBtn.textContent = '⌛ Outdated';
    outBtn.addEventListener('click', () => {
      const result = toolbarActions.toggleOutdated();
      if (!result) return;  // was disabled
      outBtn.classList.toggle('cfilesex-active', S.showOutdated);
      if (result.versionsChanged) verBtn.classList.add('cfilesex-active');
    });
    row2.appendChild(outBtn);

    // ?
    const helpEl = document.createElement('span');
    helpEl.className = 'cfilesex-help'; helpEl.textContent = '?';

    const tooltip = document.createElement('div');
    tooltip.className = 'cfilesex-tooltip-global';
    tooltip.innerHTML = `
      <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;color:var(--text-100,#111);">File Manager — quick reference</div>
      <div style="font-weight:600;margin-bottom:2px;color:var(--text-100,#111);">ON / OFF</div>
      <div style="margin-bottom:8px;color:var(--text-200,#333);">Master switch. OFF by default. First enable: sets List view + Versions automatically.</div>
      <div style="font-weight:600;margin-bottom:2px;color:var(--text-100,#111);">Sorting</div>
      <div style="margin-bottom:8px;color:var(--text-200,#333);">
        <b>A→Z / Z→A</b> — by name, then newest first.<br>
        <b>↺ By date</b> — newest first.<br>
        <b>↕ Lines</b> — largest first (Large → top), then A→Z, then newest.<br>
        Numeric-aware: v1_9 before v1_10.
      </div>
      <div style="font-weight:600;margin-bottom:2px;color:var(--text-100,#111);">Filtering</div>
      <div style="margin-bottom:8px;color:var(--text-200,#333);">Matching files shown at top. Non-matching pushed below a divider, dimmed (still visible).</div>
      <div style="font-weight:600;margin-bottom:2px;color:var(--text-100,#111);">⚑ Versions</div>
      <div style="margin-bottom:8px;color:var(--text-200,#333);">
        Detects version tags in filenames (e.g. <code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">_v1_2</code>, <code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">.v1.2.3</code>, <code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">-v2-0</code>, <code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">_v3</code>).<br>
        Separators: <code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">_</code> <code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">.</code> <code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">-</code> · Parts: 1 to 4 · Numbers only<br>
        Single-part (<code style="background:var(--bg-200,rgba(0,0,0,0.07));padding:0 3px;border-radius:2px;font-size:10px;color:var(--text-100,#111);">_v3</code>) only at end of filename.<br>
        <b style="color:#3a5fd6;">D</b> — older duplicate (same name, newest copy is clean).<br>
        <b style="color:#888;">OLD</b> — newer version exists (takes priority over D).<br>
        No version tag → unaffected.
      </div>
      <div style="font-weight:600;margin-bottom:2px;color:var(--text-100,#111);">⌛ Outdated</div>
      <div style="margin-bottom:8px;color:var(--text-200,#333);">Shows D/OLD files at top. Auto-enables Versions.</div>
      <div style="font-weight:600;margin-bottom:2px;color:var(--text-100,#111);">Select all visible</div>
      <div style="margin-bottom:8px;color:var(--text-200,#333);">Selects only matched (non-dimmed) files — respects active filters.</div>
      <div style="font-weight:600;margin-bottom:2px;color:var(--text-100,#111);">Deleting</div>
      <div style="color:var(--text-200,#333);">Check files → use native trash button.</div>
    `;
    document.body.appendChild(tooltip);
    S.tooltipEl = tooltip;

    helpEl.addEventListener('mouseenter', () => {
      const rect = helpEl.getBoundingClientRect();
      const maxH = window.innerHeight - 24;
      tooltip.style.maxHeight = maxH + 'px';
      tooltip.style.display = 'block';
      const th = tooltip.offsetHeight || 380;
      const rawTop = rect.top > th + 10 ? rect.top - th - 6 : rect.bottom + 6;
      tooltip.style.top  = Math.max(8, Math.min(rawTop, window.innerHeight - th - 8)) + 'px';
      tooltip.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
    });
    helpEl.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    row2.appendChild(helpEl);

    const hint = document.createElement('span');
    hint.className = 'cfilesex-hint-text';
    hint.textContent = 'D = duplicate · OLD = newer version exists';
    row2.appendChild(hint);

    bar.appendChild(row2);
    wrap.appendChild(bar);

    // Insertion point: toolbar and counter must be BEFORE the visual grid,
    // but NOT INSIDE a CSS-grid container (otherwise they become grid-items → layout breaks).
    // Heuristic may pick a wrapper <div> inside <ul class="grid">.
    // Walk up while parent contains 'grid' in className (Tailwind).
    let insertBefore = grid;
    let insertParent = grid.parentNode;
    while (insertParent && insertParent !== document.body) {
      const cls = insertParent.className;
      if (typeof cls === 'string' && /\bgrid\b/.test(cls)) {
        insertBefore = insertParent;
        insertParent = insertParent.parentNode;
      } else {
        break;
      }
    }

    insertParent.insertBefore(wrap, insertBefore);

    // Post-insertion sanity: on hard refresh React may not have positioned elements yet.
    // If toolbar ended up in the top-left corner (rect.left < 100 and rect.top < 100) —
    // it's not the right sidebar location. Remove and retry.
    const wrapRect = wrap.getBoundingClientRect();
    if (wrapRect.width > 0 && wrapRect.left < 100 && wrapRect.top < 100) {
      wrap.remove();
      tooltip.remove();
      S.tooltipEl = null;
      S.retryTimer = setTimeout(tryInit, 1500);
      return;
    }

    // Counter row
    const counterRow = buildCounterRow(insertParent, insertBefore);

    // Hide toolbar if too few files — watchGrid will show it when files appear
    const count = countRealFiles(grid);
    if (count < 2) {
      setToolbarVisible(false);
    } else {
      if (!S.enabled) counterRow.style.display = 'none';
      applyMasterState();
    }

    watchGrid(grid);
  }

  function mkDiv() { const d = document.createElement('span'); d.className = 'cfilesex-divider'; return d; }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS / INITIALIZATION / SPA
  // ═══════════════════════════════════════════════════════════════════════════

  function showStatus(msg, parentEl) {
    removeStatus();
    if (!parentEl) return;
    const el = document.createElement('div');
    el.id = STATUS_ID; el.textContent = msg;
    el.style.cssText = 'font-size:11px;color:var(--text-300,#aaa);padding:4px 0 8px;font-style:italic;font-family:inherit;';
    parentEl.prepend(el);
  }
  function removeStatus() { document.getElementById(STATUS_ID)?.remove(); }

  function findFilesSectionParent() {
    for (const el of document.querySelectorAll('h1,h2,h3,h4,span,p,div,button')) {
      if (el.children.length > 0) continue;
      const t = el.textContent.trim();
      if (t === 'Files' || t === 'Knowledge') return el.parentElement;
    }
    return null;
  }

  function tryInit() {
    if (document.getElementById(WRAP_ID)) return;
    // Stale state: S.grid points to old grid, but our wrap is gone from DOM
    // (React rebuilt subtree). Without resetState: tooltip in document.body duplicates,
    // cardObservers on detached cards leak, timers linger.
    if (S.grid) {
      resetState();
    }
    const grid = findFilesGrid();
    if (grid) {
      removeStatus();
      // Grid found — build toolbar regardless of file count (toolbar hides itself if < 2)
      S.retryCount = 0;
      buildToolbar(grid);
      return;
    }
    // Grid not found — wait. First fast retries (RETRY_DELAYS),
    // then slow (5s) for ~30s more, then give up.
    if (S.retryCount < RETRY_DELAYS.length) {
      // Show status only after 2+ attempts — on hard refresh first attempts
      // hit unrendered DOM, findFilesSectionParent finds "Files" in a transient location.
      if (S.retryCount >= 2) { const p = findFilesSectionParent(); if (p) showStatus('⏳ Loading files...', p); }
      S.retryTimer = setTimeout(tryInit, RETRY_DELAYS[S.retryCount++]);
    } else if (S.retryCount < RETRY_DELAYS.length + 6) {
      S.retryTimer = setTimeout(tryInit, 5000);
      S.retryCount++;
    } else {
      // All retries exhausted — clean up
      S.retryTimer = null;
      removeStatus();
    }
  }

  let lastPath = location.pathname;
  let _spaDebounce = null;
  new MutationObserver(() => {
    if (location.pathname === lastPath) return;
    // 50ms debounce — pathname is checked after a batch of mutations, not on each one
    clearTimeout(_spaDebounce);
    _spaDebounce = setTimeout(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      resetState();
      if (location.pathname.startsWith('/project/')) S.retryTimer = setTimeout(tryInit, 800);
    }, 50);
  }).observe(document.body, { childList: true, subtree: true });

  // First call with increased delay — React SPA needs 1-2s for full render,
  // especially on hard refresh (ctrl+shift+r). 900ms was not enough.
  setTimeout(tryInit, 1800);

  // ═══════════════════════════════════════════════════════════════════════════
  // HEARTBEAT — safety net for edge-cases when observer missed an event
  // Every 8s: grid disconnected → reinit, toolbar hidden but files appeared → recover,
  // toolbar missing → tryInit
  // ═══════════════════════════════════════════════════════════════════════════
  setInterval(() => {
    if (!location.pathname.startsWith('/project/')) return;
    const wrap = document.getElementById(WRAP_ID);
    if (wrap) {
      if (S.grid && !S.grid.isConnected) { resetState(); tryInit(); return; }
      // Toolbar hidden (< 2 files) — check if situation changed
      if (wrap.style.display === 'none' && S.grid) {
        // Same grid now has enough files? (watchGrid may have missed the mutation)
        if (countRealFiles(S.grid) >= 2) {
          setToolbarVisible(true);
          if (S.enabled) applySortAndFilter();
          return;
        }
        // Different/better grid appeared? (React may have rebuilt DOM)
        const fresh = findFilesGrid();
        if (fresh && fresh !== S.grid && countRealFiles(fresh) >= 2) {
          resetState();
          tryInit();
        }
      }
    } else {
      tryInit();
    }
  }, 8000);

})();
