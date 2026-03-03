# @ggaidelevicius/payload-isr

Payload CMS plugin for ISR-style path and tag revalidation, with optional full rebuild fallback.

Built from the official Payload plugin template (`create-payload-app --template plugin`) and adapted for publish/unpublish/delete revalidation workflows.

## Install

```bash
pnpm add @ggaidelevicius/payload-isr
```

## Usage

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
      debug: true,
      logger: createPayloadIsrLogger(),
      revalidatePath: (path, meta) => {
        if (meta.mode === 'site') {
          return nextRevalidatePath(path, 'layout')
        }

        return nextRevalidatePath(path)
      },
      revalidateTag: (tag) => nextRevalidateTag(tag),
      collections: [
        {
          slug: 'posts',
          pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],
          probeURL: ({ result }) => `https://www.example.com/posts/${result.slug}`,
          tagResolver: ({ result }) => ['posts', `post:${result.id}`],
          onDelete: {
            pathResolver: ({ id }) => [`/posts/${id}`, '/posts'],
            tagResolver: ({ id }) => ['posts', `post:${id}`],
          },
        },
      ],
      globals: [
        {
          slug: 'site-settings',
          revalidateAllOnChange: true,
          tagResolver: () => ['site-settings', 'global'],
        },
      ],
      fullRebuild: {
        enabled: process.env.NODE_ENV === 'production',
        trigger: async () => {
          await fetch(process.env.REBUILD_WEBHOOK_URL!, { method: 'POST' })
        },
      },
    }),
  ],
})
```

## Plugin options

`payloadIsr({ ... })`

- `collections` / `globals` callback args are inferred from each target `slug` (using Payload generated types), so invalid field access is caught at compile time.
- collection/global targets require at least one update strategy at type level:
  - collection: one of `pathResolver`, `tagResolver`, `referencePathResolver`, `referenceTagResolver`, `probeURL`
  - global: `revalidateAllOnChange: true` or one of `pathResolver`, `tagResolver`, `probeURL`
- `disabled?: boolean`
- `debug?: boolean` emits structured `logger.info` trace events for hook/guard/branch decisions
- `revalidatePath(path, meta)` (required)
- `revalidateTag?(tag, meta)` (optional)
- `collections?: CollectionISRTarget[]`
- `globals?: GlobalISRTarget[]`
- `fullRebuild?: { enabled?, shouldTrigger?, trigger }`
- `logger?: { warn, error, info? }`

For quick setup:
- use `debug: true`
- use `logger: createPayloadIsrLogger()`

### Collection target

- `slug` (required)
- `pathResolver?` revalidate route paths
- `tagResolver?` revalidate cache tags
- `operations?` default: `['create', 'update', 'updateByID']`
- `shouldHandle?` custom gate for publish logic
- `referencePathResolver?` for extra related paths
- `referenceTagResolver?` for extra related tags
- `probeURL?` URL to check before deciding full rebuild fallback
- `unpublish?` override unpublish matcher/path/tag behavior
- `onDelete?` add delete path/tag revalidation behavior

Note:
- If you do not use Payload drafts, avoid `_status` checks in `shouldHandle`; there may be no status field to inspect.

### Global target

- `slug` (required)
- `revalidateAllOnChange?: boolean` use site-wide invalidation mode, no per-page path mapping required
- `revalidateAllPath?: string` defaults to `'/'` when `revalidateAllOnChange` is enabled
- `pathResolver?` targeted path strategy when `revalidateAllOnChange` is not enabled
- `tagResolver?` revalidate cache tags for global changes
- `shouldHandle?` custom gate for publish logic
- `probeURL?` URL to check before deciding full rebuild fallback

## About fullRebuild

`fullRebuild` is a fallback for cases where path/tag-level invalidation can miss newly valid routes.

Common cases where enabling it helps:
- slug or route shape changes that create a new URL not yet present in the current deployment
- catch-all or nested routing where probing reveals the target route returns `404`
- CDN or edge cache scenarios where route/tag revalidation is not sufficient

How it works:
- plugin probes `probeURL` when configured on a target
- by default, if probe status is `404`, plugin calls `fullRebuild.trigger(...)`
- you can override this behavior with `fullRebuild.shouldTrigger(...)`
- if `fullRebuild` is enabled but no targets provide `probeURL`, no probe runs and rebuild fallback is never reached
- startup preflight warnings flag duplicate target slugs, missing strategies from dynamic config, tag resolvers without `revalidateTag`, and global `revalidateAllOnChange` conflicts.

Typical production setup:
- set `enabled: process.env.NODE_ENV === 'production'`
- set `trigger` to call your deployment mechanism

Common `trigger` implementations:
- generic HTTP deploy webhook
- CI/CD provider API call (GitHub Actions, GitLab CI, CircleCI, etc.)
- hosted platform rebuild endpoint (Vercel, Netlify, Cloudflare, etc.)
- internal queue/job dispatcher in your own infrastructure

## Local development

```bash
pnpm hooks:install
pnpm dev
pnpm test:int
pnpm build
```

Debug helpers in the bundled `dev/` app:
- set `PAYLOAD_ISR_DEBUG=1` to emit branch-level traces (enabled by default in `dev/payload.config.ts`)
- set `PAYLOAD_ISR_DEBUG_CONFIG=1` to include noisy `config.*` trace events (disabled by default)
- set `PAYLOAD_ISR_FULL_REBUILD=1` to enable full-rebuild fallback simulation in local dev
- optional `PAYLOAD_ISR_PROBE_ORIGIN` (default: `http://127.0.0.1:3000`) controls probe URL base
- inspect current telemetry via `GET /api/isr-debug`
- clear telemetry via `DELETE /api/isr-debug`

Release commit marker guard:
- commit messages with `(release...)` must use exactly one enum: `(release:patch)`, `(release:minor)`, or `(release:major)`
- invalid values like `(release:path)` are rejected by the `commit-msg` hook
