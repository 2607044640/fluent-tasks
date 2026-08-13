# Iconify Integration — Tasks Blueprint

## Task 1: Create `IconifyService.ts`
- [ ] **Target File**: `C:\ObsidianDev\plugins\fluent-tasks\src\IconifyService.ts` — [NEW]
- **Target Symbol**: New file
- **Line Reference**: N/A
- **Action**: Create new TypeScript module with Iconify API fetch, memory cache, inflight dedup, and fallback SVG
- **Done When**: File exists, `npm run build` compiles without errors
- **Executor Tier**: `subagent:low-tier`

## Task 2: Update `renderIcon` in `TaskMainView.svelte`
- [ ] **Target File**: `C:\ObsidianDev\plugins\fluent-tasks\src\TaskMainView.svelte`
- **Target Symbol**: `renderIcon` function (L138-147) + imports
- **Line Reference**: L138–147, imports around L5
- **Action**: Add `import { resolveIconifyIcon }` and add `iconify:` branch with async fetch + loading spinner
- **Done When**: Build passes. Existing Lucide icons still render. New `iconify:` prefix triggers the async path.
- **Executor Tier**: `subagent:low-tier`

## Task 3: Add loading animation CSS
- [ ] **Target File**: `C:\ObsidianDev\plugins\fluent-tasks\src\styles.css`
- **Target Symbol**: After `.imagination-icon svg` block
- **Line Reference**: After L749
- **Action**: Append `.icon-loading svg` spin animation and `@keyframes icon-spin`
- **Done When**: Build passes, `styles.css` matches `main.css`
- **Executor Tier**: `subagent:low-tier`

## Task 4: Write test data to `TodoData/test.md`
- [ ] **Target File**: `C:\ObsidianNote\TodoData\test.md`
- **Target Symbol**: End of file
- **Line Reference**: After last line
- **Action**: Remove old test tasks (IDs: t-lucide-*, t-svg-*, t-emoji-*), append 6 new demo tasks (2 Lucide, 2 Iconify, 2 Emoji)
- **Done When**: File saved with 6 new demo tasks
- **Executor Tier**: `subagent:low-tier`

## Task 5: Build, verify, and clean up
- [ ] **Target File**: `C:\ObsidianDev\plugins\fluent-tasks`
- **Target Symbol**: N/A (build verification)
- **Action**: `npm run build`, `npx svelte-check`, verify styles.css matches main.css, no stray console.log
- **Done When**: Build passes, svelte-check passes, styles.css matches main.css
- **Executor Tier**: `main-thread`
