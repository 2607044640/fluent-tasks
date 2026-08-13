# Iconify Icon Library Integration — Approved Plan

## Spec

**Goal**: Replace the crude raw-SVG-injection approach with a professional on-demand Iconify icon system. Three-tier icon priority:

1. **Tier 1 — Lucide** (`lucide-xxx`): Obsidian native `setIcon()` — zero network, perfect theme matching
2. **Tier 2 — Iconify** (`iconify:prefix:name`): On-demand fetch from `api.iconify.design`, with local memory cache
3. **Tier 3 — Emoji/Text fallback**: Anything else renders as `textContent`

**Acceptance Criteria**:
- AC1: A task with `"frames":[["iconify:logos:python"]]` renders the Python logo SVG inside the image frame
- AC2: Fetched Iconify icons are cached in memory so repeated renders don't re-fetch
- AC3: Failed fetches (offline/invalid name) show a fallback placeholder icon (`lucide-help-circle`)
- AC4: No new npm runtime dependencies are added to the bundle — we use raw `fetch()` + manual SVG construction
- AC5: Existing Lucide and Emoji rendering continues to work unchanged
- AC6: Test tasks are written to `TodoData/test.md` demonstrating all three tiers

## Architecture

### Core Decision: No npm dependency — Pure fetch() + manual SVG construction

Iconify public API:
```
GET https://api.iconify.design/{prefix}.json?icons={name}
→ Response: { "icons": { "{name}": { "body": "<path .../>", "width": 24, "height": 24 } } }
```

### New `IconifyService.ts` module
- `Map<string, string>` cache (icon key → SVG HTML)
- `Map<string, Promise<string>>` inflight dedup
- `resolveIconifyIcon(iconStr)` → async, returns SVG HTML
- Fallback SVG (help-circle) on error

### Rendering flow
Current `renderIcon` in TaskMainView.svelte (L138-147) is synchronous. New version adds `iconify:` branch with async fetch + loading spinner placeholder.

### Constitution Gate: ✅ All clear
- Static CSS only, Pure Markdown storage, DRY extraction, Optimistic UI pattern
