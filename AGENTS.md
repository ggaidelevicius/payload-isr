# AGENTS.md

## Purpose
This repository publishes `@ggaidelevicius/payload-isr`, a Payload CMS plugin for ISR-style revalidation with optional full rebuild fallback.

## Stack
- Language: TypeScript
- Package manager: pnpm
- Build output: `dist/` (types via `tsc`, JS via `swc`)
- Tests: Vitest (`test:int`) + Playwright (`test:e2e`)

## Source of Truth
- Runtime + type entrypoints must resolve to `dist` in `package.json`:
  - `exports["."].import -> ./dist/index.js`
  - `exports["."].types -> ./dist/index.d.ts`
  - `main -> ./dist/index.js`
  - `types -> ./dist/index.d.ts`
- Do not point published metadata at `src`.

## Developer Commands
- Build: `pnpm build`
- Unit/integration: `pnpm test:int`
- End-to-end: `pnpm test:e2e`
- Full suite: `pnpm test`
- Publish readiness check: `pnpm publish:check`

## Typing Rules
- Avoid explicit `any` in exported/public types.
- `CollectionAfterOperationArgs` is intended for content operations (`create`, `update`, `updateByID`).
- Keep consumer ergonomics for common fields (`_status`, `slug`) via `ISRDocument`.
- If Payload typing changes between versions, prefer narrowing in plugin internals over widening public API to `any`.

## Plugin Behavior Constraints
- Keep provider/platform naming generic (no hard Vercel coupling in API names).
- Support both path-based and tag-based revalidation.
- Global `revalidateAllOnChange` should remain concise and not require enumerating every route.
- Full rebuild should be optional and clearly documented as a fallback path.

## Change Hygiene
- Keep the plugin lean: avoid app/demo-only artifacts unless needed for tests.
- Update README when public API or behavior changes.
- For release-affecting changes, run `pnpm pack --dry-run` and verify tarball contents.
