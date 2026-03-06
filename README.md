# @ggaidelevicius/payload-isr

Payload CMS plugin that revalidates your Next.js cache when documents are published, updated, unpublished, or deleted — by path, by cache tag, or by triggering a full rebuild when route-level invalidation isn't enough.

## Requirements

- Payload `^3.37.0`
- Node `^18.20.2 || >=20.9.0`
- Next.js is the typical target but the plugin works with any revalidation callbacks

## Install

```bash
pnpm add @ggaidelevicius/payload-isr
# or
npm install @ggaidelevicius/payload-isr
```

## How it works

The plugin registers Payload `afterOperation` and `afterChange` hooks on whichever collections and globals you configure. When a hook fires:

1. **Publish check** — `shouldHandle` decides whether the document should trigger revalidation (default: document has no `_status` field, or `_status === 'published'`)
2. **Unpublish check** — if an update sets a document from published to draft, unpublish-specific resolvers fire instead of update resolvers
3. **Probe** — if `probeURL` is configured and `fullRebuild` is enabled, the plugin fetches that URL; a `404` triggers the full rebuild path and skips path/tag revalidation
4. **Revalidate** — resolved paths are passed to your `revalidatePath` callback; resolved tags are passed to your `revalidateTag` callback

Delete revalidation is opt-in via `onDelete` on each collection target. The plugin warns at startup when a collection has update resolvers but no `onDelete` strategy.

## Minimal setup

The smallest valid configuration — no tags, no full rebuild, one collection:

```ts
import { buildConfig } from 'payload'
import { payloadIsr } from '@ggaidelevicius/payload-isr'
import { revalidatePath } from 'next/cache'

export default buildConfig({
  plugins: [
    payloadIsr({
      revalidatePath: (path) => revalidatePath(path),
      collections: [
        {
          slug: 'posts',
          pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],
        },
      ],
    }),
  ],
})
```

## Full example

```ts
import { buildConfig } from 'payload'
import { createPayloadIsrLogger, payloadIsr } from '@ggaidelevicius/payload-isr'
import {
  revalidatePath as nextRevalidatePath,
  revalidateTag as nextRevalidateTag,
} from 'next/cache'

export default buildConfig({
  plugins: [
    payloadIsr({
      // Emit structured debug traces for every hook/guard/branch decision.
      debug: true,
      // Prefix relative paths in debug output with this origin so URLs are clickable.
      debugURLOrigin: process.env.PUBLIC_APP_URL,
      // Logger that filters noisy config-level traces by default.
      logger: createPayloadIsrLogger(),

      // Called once per resolved path.
      // meta.mode is 'site' when a global uses revalidateAllOnChange — use
      // Next.js 'layout' scope in that case to revalidate the full layout tree.
      revalidatePath: (path, meta) => {
        if (meta.mode === 'site') {
          return nextRevalidatePath(path, 'layout')
        }
        return nextRevalidatePath(path)
      },

      // Optional. Called once per resolved tag. Omit if you don't use cache tags.
      revalidateTag: (tag) => nextRevalidateTag(tag),

      collections: [
        {
          slug: 'posts',

          // Paths to revalidate when a post is published or updated.
          pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],

          // URL to probe before deciding whether a full rebuild is needed.
          // If this returns 404, fullRebuild.trigger() is called instead of revalidating paths/tags.
          probeURL: ({ result }) => `${process.env.PUBLIC_APP_URL}/posts/${result.slug}`,

          // Cache tags to invalidate.
          tagResolver: ({ result }) => ['posts', `post:${result.id}`],

          // onDelete is optional, but without it this target won't revalidate on deletes.
          // The plugin emits a startup warning for this misconfiguration.
          onDelete: {
            pathResolver: ({ id }) => [`/posts/${id}`, '/posts'],
            tagResolver: ({ id }) => ['posts', `post:${id}`],
          },
        },
      ],

      globals: [
        {
          slug: 'site-settings',
          // Revalidate the entire site (calls revalidatePath('/', 'layout') via meta.mode === 'site').
          // Cannot be combined with pathResolver on the same target.
          revalidateAllOnChange: true,
          tagResolver: () => ['site-settings', 'global'],
        },
      ],

      fullRebuild: {
        // Disable in development to avoid accidentally triggering deploys.
        enabled: process.env.NODE_ENV === 'production',
        // Fires when a probeURL returns 404 (the default shouldTrigger condition).
        trigger: async () => {
          await fetch(process.env.REBUILD_WEBHOOK_URL!, { method: 'POST' })
        },
      },
    }),
  ],
})
```

## Plugin options

### Top-level (`payloadIsr({ ... })`)

| Option | Type | Required | Description |
|---|---|---|---|
| `revalidatePath` | `(path, meta) => void \| Promise<void>` | No* | Called for each resolved path. See [Revalidation metadata](#revalidation-metadata). |
| `revalidateTag` | `(tag, meta?) => void \| Promise<void>` | No* | Called for each resolved tag. Omit only if you do not use tag-based caching. |
| `collections` | `CollectionISRTarget[]` | No | Collection revalidation targets. |
| `globals` | `GlobalISRTarget[]` | No | Global revalidation targets. |
| `fullRebuild` | `FullRebuildConfig` | No | Full rebuild fallback. See [Full rebuild fallback](#full-rebuild-fallback). |
| `logger` | `{ error, warn, info? }` | No | Custom logger. Defaults to `console`. Use `createPayloadIsrLogger()` for structured output with built-in filtering. |
| `debug` | `boolean` | No | Emit structured trace events via `logger.info` for every hook, guard, and branch decision. |
| `debugURLOrigin` | `string` | No | Base URL prepended to relative paths in debug output, making logged paths absolute and clickable. |
| `disabled` | `boolean` | No | Disable the plugin entirely without removing it from config. |

`*` At least one of `revalidatePath` or `revalidateTag` is required.

**TypeScript note:** callback args in `collections` and `globals` are inferred from each target's `slug` using Payload's generated types. Invalid field access is caught at compile time. Each target requires at least one revalidation strategy at the type level — the compiler will error if a target has no resolver.

### Collection target

| Option | Type | Default | Description |
|---|---|---|---|
| `slug` | `string` | — | Collection slug. Must match your Payload collection. |
| `disabled` | `boolean` | `false` | Skip this target without removing it from config. |
| `pathResolver` | `(args) => string[]` | — | Returns paths to revalidate when a document is published or updated. |
| `tagResolver` | `(args) => string[]` | — | Returns cache tags to invalidate. |
| `referencePathResolver` | `(args) => string[]` | — | Additional paths to revalidate, merged with `pathResolver` results. Use `findReferencingPaths()` here to also bust other pages that embed this document. |
| `referenceTagResolver` | `(args) => string[]` | — | Additional tags to invalidate, merged with `tagResolver` results. |
| `probeURL` | `(args) => string` | — | URL to fetch before triggering full rebuild. Required for full rebuild to ever fire on this target. |
| `operations` | `string[]` | `['create', 'update', 'updateByID']` | Which Payload operations trigger this target. |
| `shouldHandle` | `(args) => boolean` | Checks `_status === 'published'` (or no `_status` field) | Custom gate. Return `false` to skip revalidation for this operation. |
| `unpublish` | `UnpublishConfig` | — | Override unpublish detection and/or unpublish-specific path/tag resolvers. |
| `onDelete` | `OnDeleteConfig` | — | Opt-in delete revalidation. Without this, deletes are skipped for this target and a startup warning is emitted. |

**At least one of** `pathResolver`, `tagResolver`, `referencePathResolver`, `referenceTagResolver`, or `probeURL` is required at the type level.

### Global target

| Option | Type | Default | Description |
|---|---|---|---|
| `slug` | `string` | — | Global slug. Must match your Payload global. |
| `disabled` | `boolean` | `false` | Skip this target without removing it from config. |
| `revalidateAllOnChange` | `boolean` | — | Revalidate the entire site on every change. Passes `meta.mode === 'site'` to `revalidatePath`. Cannot be combined with `pathResolver`. |
| `revalidateAllPath` | `string` | `'/'` | Path passed to `revalidatePath` when `revalidateAllOnChange` is enabled. Must be absolute. |
| `pathResolver` | `(args) => string[]` | — | Returns targeted paths. Use this when `revalidateAllOnChange` is too broad. |
| `tagResolver` | `(args) => string[]` | — | Returns cache tags to invalidate. |
| `shouldHandle` | `(args) => boolean` | Checks `_status === 'published'` (or no `_status` field) | Custom gate. |
| `probeURL` | `(args) => string` | — | URL to probe before full rebuild decision. |

**At least one strategy required:** `revalidateAllOnChange: true`, or at least one of `pathResolver`, `tagResolver`, `probeURL`.

### Full rebuild config

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | — | Whether full rebuild is active. Recommended: `process.env.NODE_ENV === 'production'`. |
| `trigger` | `(context) => void \| Promise<void>` | — | Required. What to call when a rebuild is triggered. |
| `shouldTrigger` | `(context) => boolean` | `context.probeStatus === 404` | Override the condition for triggering. |

`trigger` receives a `FullRebuildContext` with: `probeStatus`, `probeURL`, `reason`, `scope`, `slug`.

## Revalidation metadata

When configured, both `revalidatePath` and `revalidateTag` receive a `meta` argument describing why revalidation is happening.

### `revalidatePath(path, meta)`

```ts
meta: {
  mode: 'path' | 'site'  // 'site' only for globals with revalidateAllOnChange
  reason: RevalidationReason
  scope: 'collection' | 'global'
  slug: string
}
```

The `mode` field is the primary reason to branch on `meta` — Next.js requires a `'layout'` scope argument when you want to invalidate the full layout tree:

```ts
revalidatePath: (path, meta) => {
  if (meta.mode === 'site') {
    return nextRevalidatePath(path, 'layout')
  }
  return nextRevalidatePath(path)
},
```

### `revalidateTag(tag, meta?)`

```ts
meta?: {
  reason: RevalidationReason
  scope: 'collection' | 'global'
  slug: string
}
```

### Revalidation reasons

| Reason | When |
|---|---|
| `'collection-update'` | Collection create or update operation |
| `'collection-unpublish'` | Update that transitions a document from published to draft |
| `'collection-delete'` | Collection delete operation |
| `'global-update'` | Global doc change |

## Default behaviors

These are the defaults to be aware of — getting them wrong is a common source of missed revalidation:

**`shouldHandle`** — defaults to `doc._status === 'published'` or, if the document has no `_status` field at all, `true`. If you don't use Payload drafts, every publish/update will pass the default guard automatically. If you do use drafts, only published docs trigger revalidation by default. Override with a custom `shouldHandle` to change this.

**`operations`** — defaults to `['create', 'update', 'updateByID']`. Custom Payload operations are not included. Override if you need to respond to additional operation types.

**`onDelete`** — not configured by default. Deletes are skipped without it. The plugin warns at startup for collection targets that define update resolvers but no `onDelete`.

**`revalidateAllPath`** — defaults to `'/'` when `revalidateAllOnChange: true`.

**`fullRebuild.shouldTrigger`** — defaults to `context.probeStatus === 404`. Override to trigger on other status codes or custom logic.

**`fullRebuild` without `probeURL`** — if `fullRebuild` is enabled but no target has a `probeURL`, no probe ever runs and the rebuild trigger is never reached. The plugin emits a warning at startup.

**Invalid `probeURL` values** — if a resolver returns an empty, relative, or non-HTTP URL, the plugin warns and skips probing for that operation.

## Unpublish detection

When a collection update is detected as an unpublish (a document transitioning from published to draft), the plugin uses unpublish-specific resolvers if provided, falling back to the main resolvers.

Default unpublish matcher: the operation must be `updateByID` and request data must include `_status: 'draft'`. Extra fields are allowed.

If your app uses a different field to control publish state (e.g. `isPublished: boolean`), provide a custom `unpublish.matcher`:

```ts
{
  slug: 'posts',
  pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],
  unpublish: {
    // Detect your custom unpublish pattern
    matcher: ({ args, operation }) => {
      const data = args.req.data as Record<string, unknown>
      return operation === 'updateByID' && data.isPublished === false && Object.keys(data).length === 1
    },
    // Optional: different paths/tags on unpublish (falls back to main resolvers if omitted)
    pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],
    tagResolver: ({ result }) => ['posts', `post:${result.id}`],
  },
}
```

## Delete revalidation

Deletes do not trigger revalidation unless `onDelete` is configured on the target. The plugin warns at startup when `onDelete` is missing. The delete hook receives the deleted document and its ID:

```ts
{
  slug: 'posts',
  pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],
  onDelete: {
    pathResolver: ({ doc, id }) => [
      // doc is the deleted document — use its fields if available
      typeof doc.slug === 'string' ? `/posts/${doc.slug}` : `/posts/${id}`,
      '/posts',
    ],
    tagResolver: ({ id }) => ['posts', `post:${id}`],
  },
}
```

## Finding referencing pages

When a document changes, other pages that *embed or reference that document* may also need their cache busted — for example, a `pages` entry that includes a post inside its block layout.

`findReferencingPaths()` handles this automatically. You give it the changed document's ID and the collections/globals to search, and it returns the paths of any documents that contain a reference to it. Use it inside `referencePathResolver`:

```ts
import { findReferencingPaths, payloadIsr } from '@ggaidelevicius/payload-isr'

{
  slug: 'posts',
  pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],
  referencePathResolver: ({ req, result }) =>
    findReferencingPaths({
      payload: req.payload,
      referencedValues: result.id,
      targets: {
        collections: ['pages', 'news'],
        globals: ['homepage'],
      },
      fieldPaths: ['layout'],
    }),
}
```

This fetches candidate documents from `pages`, `news`, and `homepage`, then applies the default published filter before matching references and returning paths.

### How matching works

The helper recursively walks the values at each `fieldPath` (or the roots returned by `getSearchRoots`) and checks whether any string or number matches one of the `referencedValues`. You don't need to account for nesting — the search is depth-unlimited within the extracted roots.

By default, only published documents are candidates (`_status === 'published'`, or docs without `_status`). Override this with `shouldInclude`.

By default, queries run with `depth: 0` and `overrideAccess: true`. This keeps relationship values as IDs (better for stable matching) and avoids access-scoped misses in system-level revalidation. Override with `queryDepth` / `overrideAccess` if your project needs different behavior.

### How paths are resolved

For each matching document, the path is determined by the first of these that applies:
1. The last URL in its `breadcrumbs` array (if present and starts with `/`)
2. `/${doc.slug}` (if the document has a non-empty `slug` field)
3. `/${doc.id}`
4. `/` — only for globals that have none of the above

Override with `resolvePaths` when your routing doesn't follow this convention. Paths returned by `resolvePaths` must be absolute (start with `/`).

### Telling the helper where to look

The helper doesn't know which fields store your block or relation data — you need to point it there.

**`fieldPaths`** accepts dot-separated paths to the fields that contain block or relation data:

```ts
fieldPaths: ['layout', 'hero.blocks', 'sidebar.content']
```

**`getSearchRoots`** is an escape hatch for when references don't live in predictable fields — it receives the full document and returns the values to search:

```ts
getSearchRoots: (doc, meta) => {
  // Search the entire document for pages, only the hero section for others
  if (meta.slug === 'pages') return [doc]
  return [doc.hero]
}
```

When both `fieldPaths` and `getSearchRoots` are provided, their results are combined. At least one is required.

### Custom path resolution

Override `resolvePaths` when the default path convention doesn't match your routing:

```ts
referencePathResolver: ({ req, result }) =>
  findReferencingPaths({
    payload: req.payload,
    referencedValues: result.id,
    targets: {
      collections: ['pages', 'news'],
    },
    fieldPaths: ['hero.blocks', 'layout'],
    resolvePaths: (doc, meta) => {
      if (meta.slug === 'news' && typeof doc.slug === 'string') {
        return [`/news/${doc.slug}`]
      }
      return typeof doc.slug === 'string' ? [`/${doc.slug}`] : []
    },
  })
```

### Options reference

| Option | Required | Description |
|---|---|---|
| `payload` | Yes | Payload instance. Available as `args.req.payload` in hook resolvers. |
| `referencedValues` | Yes | The ID(s) to search for — typically `result.id`. Accepts a single value or an array; `null`/`undefined` entries are ignored. |
| `targets` | Yes | `{ collections?, globals? }` — which slugs to scan for references. |
| `fieldPaths` | One of `fieldPaths`/`getSearchRoots` | Dot-separated field paths to inspect on each candidate document (e.g. `['layout', 'hero.blocks']`). Fields that don't exist on a document are silently skipped. |
| `getSearchRoots` | One of `fieldPaths`/`getSearchRoots` | Function returning the values to search for a given document. Combined with `fieldPaths` results when both are provided. |
| `resolvePaths` | No | Custom route mapper for matching documents. Must return absolute paths (starting with `/`). Defaults to: breadcrumb URL → `/${slug}` → `/${id}` → `/` (globals only). |
| `shouldInclude` | No | Custom filter applied to each candidate document before the reference search runs. Defaults to published docs or docs without `_status`. |
| `queryDepth` | No | Depth passed to Payload queries. Defaults to `0`. Increase if you intentionally want populated relationship objects in the search roots. |
| `overrideAccess` | No | Whether to bypass access control when scanning candidates. Defaults to `true` to avoid missed revalidation due to user-scoped access. |
| `logger` | No | Logger for warnings from the helper (failed queries, non-absolute paths). Defaults to `console`. Pass the same logger you configured on the plugin to keep output consistent. |

### Database adapter notes

**MongoDB** — MongoDB stores relationship IDs embedded within each document's structure. There is no join table or foreign-key index to reverse-query, so finding "all pages that reference post X" requires a full collection scan regardless. `findReferencingPaths` is the practical solution here.

**PostgreSQL / SQLite** — Payload's SQL adapters store relationships in dedicated join tables (e.g. `pages_rels`). In principle you could query those tables directly to find referencing documents without fetching full documents. `findReferencingPaths` doesn't do this — it uses `payload.find()` and scans the returned documents in memory, which is database-agnostic but less targeted than a raw SQL query. For large collections on a SQL adapter, a direct Drizzle query against the `_rels` table would be more efficient, though it requires knowing Payload's internal table naming conventions (which vary by collection and field structure).

### Performance note

`findReferencingPaths` fetches every document in each target collection on every publish event. Keep `targets` narrow — only include collections that actually store references to the changed document type.

## Full rebuild fallback

`fullRebuild` is a fallback for situations where path/tag invalidation misses newly valid routes — for example, when a slug changes and the new URL has never been cached, or when catch-all routes return `404` until a new build is deployed.

When to enable it:
- Slug or route shape changes that create a URL not yet present in the current deployment
- Catch-all or nested routing where newly published content returns `404` until a rebuild
- CDN or edge cache scenarios where route/tag revalidation alone is insufficient

How it works:
1. `fullRebuild.enabled` must be `true`
2. The target must have a `probeURL` resolver — without it, no probe runs
3. Plugin fetches `probeURL` after a publish/update
4. If `fullRebuild.shouldTrigger(context)` returns `true` (default: `probeStatus === 404`), `trigger()` is called
5. Path/tag revalidation is skipped when a rebuild triggers

```ts
fullRebuild: {
  enabled: process.env.NODE_ENV === 'production',
  trigger: async (context) => {
    // context: { probeStatus, probeURL, reason, scope, slug }
    await fetch(process.env.REBUILD_WEBHOOK_URL!, { method: 'POST' })
  },
}
```

Common `trigger` implementations:
- Generic HTTP deploy webhook
- CI/CD provider API (GitHub Actions, GitLab CI, CircleCI)
- Hosted platform rebuild endpoint (Vercel, Netlify, Cloudflare)
- Internal queue or job dispatcher

## Route contract alignment

All ISR inputs for a content type should map to the same routing contract your app actually serves. Misalignment means revalidating paths that aren't cached, or probing URLs that don't match what's live.

Rules of thumb:
- `pathResolver` should return the paths your app actually caches and serves
- `probeURL` should be the user-facing URL you expect to exist after a successful deploy
- If your app serves both `/posts/[id]` and `/posts/[slug]`, revalidate both
- If a slug can change, `referencePathResolver` can revalidate the previous URL if your resolver can derive it (e.g. from stored history)

Example — helper functions that stay consistent across resolvers:

```ts
const getPostPaths = (doc: { id: string | number; slug?: null | string }) => {
  const idPath = `/posts/${String(doc.id)}`
  const slugPath = typeof doc.slug === 'string' && doc.slug.trim() ? `/posts/${doc.slug.trim()}` : null
  return [slugPath, idPath, '/posts'].filter(Boolean) as string[]
}

const getPostProbeURL = (doc: { id: string | number; slug?: null | string }) =>
  new URL(
    typeof doc.slug === 'string' && doc.slug.trim()
      ? `/posts/${doc.slug.trim()}`
      : `/posts/${String(doc.id)}`,
    process.env.PUBLIC_APP_URL,
  ).toString()

// Use in config:
{
  slug: 'posts',
  pathResolver: ({ result }) => getPostPaths(result),
  probeURL: ({ result }) => getPostProbeURL(result),
  onDelete: {
    pathResolver: ({ doc, id }) => getPostPaths({ id, slug: doc.slug }),
  },
}
```

## Debug and logging

**Enable debug traces:**

```ts
payloadIsr({
  debug: true,
  logger: createPayloadIsrLogger(),
  // ...
})
```

`createPayloadIsrLogger()` prefixes output with `[payload-isr]` and filters out noisy `config.*` setup traces by default. To include config-level events:

```ts
logger: createPayloadIsrLogger({ includeConfigDebugEvents: true })
```

Bring your own logger by passing any object with `error`, `warn`, and optionally `info` methods:

```ts
logger: {
  error: (...args) => myLogger.error(...args),
  warn: (...args) => myLogger.warn(...args),
  info: (...args) => myLogger.info(...args),
}
```

**Startup preflight warnings** — the plugin validates configuration at init and warns about:
- Duplicate target slugs (hooks may fire multiple times)
- Targets with no revalidation strategy
- Collection targets missing delete strategy (`onDelete`)
- Collection targets with `onDelete` configured but no resolvers inside it
- Path resolvers configured without a `revalidatePath` callback
- `tagResolver` without a `revalidateTag` callback
- `fullRebuild` enabled with no `probeURL` resolvers
- `revalidateAllOnChange` and `pathResolver` on the same global target
- Non-absolute `revalidateAllPath`

## Local development

```bash
pnpm hooks:install   # install commit-msg and other git hooks
pnpm dev             # start the bundled dev app
pnpm test:int        # run integration tests
pnpm build           # build the plugin
```

Environment variables for the bundled `dev/` app:

| Variable | Default | Description |
|---|---|---|
| `PAYLOAD_ISR_DEBUG` | `1` | Emit branch-level debug traces |
| `PAYLOAD_ISR_DEBUG_CONFIG` | off | Include noisy `config.*` trace events |
| `PAYLOAD_ISR_FULL_REBUILD` | off | Enable full-rebuild fallback simulation |
| `PAYLOAD_ISR_PROBE_ORIGIN` | `http://127.0.0.1:3000` | Base URL for probe requests |

Dev API endpoints:
- `GET /api/isr-debug` — inspect recorded revalidation telemetry
- `DELETE /api/isr-debug` — clear recorded telemetry

**Release commit marker guard:** commit messages containing `(release...)` must use exactly one of `(release:patch)`, `(release:minor)`, or `(release:major)`. Invalid values (e.g. `(release:path)`) are rejected by the `commit-msg` hook.
