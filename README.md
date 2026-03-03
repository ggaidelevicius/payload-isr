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
import { payloadIsr } from '@ggaidelevicius/payload-isr'
import {
  revalidatePath as nextRevalidatePath,
  revalidateTag as nextRevalidateTag,
} from 'next/cache'

export default buildConfig({
  plugins: [
    payloadIsr({
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
          shouldHandle: ({ result }) => result._status === 'published',
          pathResolver: ({ result }) => [`/posts/${result.slug}`, '/posts'],
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

- `disabled?: boolean`
- `revalidatePath(path, meta)` (required)
- `revalidateTag?(tag, meta)` (optional)
- `collections?: CollectionISRTarget[]`
- `globals?: GlobalISRTarget[]`
- `fullRebuild?: { enabled?, shouldTrigger?, trigger }`
- `logger?: { warn, error, info? }`

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
pnpm dev
pnpm test:int
pnpm build
```
