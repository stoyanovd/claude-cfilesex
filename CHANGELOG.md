# Changelog

All notable changes to Claude Project Files Manager.

## [6.4.0] — 2026-03-23

Initial public release.

### Features
- **Sort** — A→Z, Z→A, by date (newest first), by line count (largest first)
- **Filter** — instant text search, matching files at top, non-matching dimmed below divider
- **List view** — compact single-line rows with file name, extension, line count, version badge
- **Version tracking** — auto-detects version patterns (`_v1_2`, `.v1.2.3`, `-v2-0`, `_v3`), marks outdated files with D (duplicate) and OLD (superseded) badges
- **Outdated filter** — shows only D/OLD files at top for easy cleanup
- **Select All** — bulk selection respecting active filters, 3-state checkbox
- **Quick preview** — click file name in list view to open Claude's preview panel
- **ON/OFF toggle** — disable without uninstalling, remembers state per project
- **Per-project settings** — sort order, view mode, version badges, outdated filter stored independently for each project

### Technical
- Publication-ready metadata: @namespace, @author, @license, @homepageURL, @supportURL
- Privacy & Security block with Verification Guide in source code
- Storage Inventory documenting all stored keys
- ~2000 lines of commented, non-minified JavaScript
- Zero network requests, zero external dependencies

### Internal history

This script was developed privately since v5.10. Key milestones before public release:

- **v6.0** — Fixed by-date sort order (was inverted) and checkbox-triggered reorder bug
- **v6.1** — Major code cleanup: removed ~150 lines of dead code, extended version parser (1–4 parts, `_` `.` `-` separators), tooltip with backdrop blur, all comments translated to English
- **v6.2** — Structural refactoring: decomposed `applySortAndFilter` into 7 phases, extracted `toolbarActions`, fixed 2 stale closure bugs
- **v6.3–v6.3.6** — Series of targeted fixes: Select All with outdated files, filter feedback loop, single-part version support, outdated filter edge cases
