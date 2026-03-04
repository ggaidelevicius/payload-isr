import type {
  CollectionAfterDeleteHook,
  CollectionAfterOperationHook,
  CollectionSlug,
  DataFromCollectionSlug,
  DataFromGlobalSlug,
  GlobalAfterChangeHook,
  GlobalSlug,
} from 'payload'

export type MaybePromise<T> = Promise<T> | T

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Keys extends keyof T
  ? Omit<T, Keys> & Required<Pick<T, Keys>>
  : never

type RawCollectionAfterOperationArgs<TSlug extends CollectionSlug> = Parameters<
  CollectionAfterOperationHook<TSlug>
>[0]

type RawCollectionAfterDeleteArgs<TSlug extends CollectionSlug> = Parameters<
  CollectionAfterDeleteHook<DataFromCollectionSlug<TSlug>>
>[0]

type RawGlobalAfterChangeArgs = Parameters<GlobalAfterChangeHook>[0]

export type CollectionContentOperation = 'create' | 'update' | 'updateByID'

/**
 * Typed args passed to collection update/create resolvers and guards.
 * Includes only content operations (`create`, `update`, `updateByID`).
 */
export type CollectionAfterOperationArgs<TSlug extends CollectionSlug = CollectionSlug> = {
  /** Updated document result for the operation. */
  result: DataFromCollectionSlug<TSlug>
} & Omit<
  Extract<
    RawCollectionAfterOperationArgs<TSlug>,
    {
      operation: CollectionContentOperation
    }
  >,
  'result'
>

/**
 * Typed args passed to collection delete resolvers.
 */
export type CollectionAfterDeleteArgs<TSlug extends CollectionSlug = CollectionSlug> = {
  /** Deleted document snapshot supplied by Payload's `afterDelete` hook. */
  doc: DataFromCollectionSlug<TSlug>
} & Omit<
  RawCollectionAfterDeleteArgs<TSlug>,
  'doc'
>

/**
 * Typed args passed to global change resolvers and guards.
 */
export type GlobalAfterChangeArgs<TSlug extends GlobalSlug = GlobalSlug> = {
  /** The global document in its new state after the save. Use this to derive cache keys, paths, or tags that reflect the latest content. */
  doc: DataFromGlobalSlug<TSlug>
  /** The global document as it was before this change. Useful for detecting field-level changes — for example, to also invalidate paths that were valid under the old value but will no longer be reached. */
  previousDoc: DataFromGlobalSlug<TSlug>
} & Omit<
  RawGlobalAfterChangeArgs,
  'doc' | 'previousDoc'
>

export type RevalidationReason =
  | 'collection-delete'
  | 'collection-unpublish'
  | 'collection-update'
  | 'global-update'

export type RevalidationMode = 'path' | 'site'

/**
 * Callback used to dispatch path-based revalidation to your platform.
 */
export type RevalidatePathFn = (
  /** The cache path to bust — mirrors what you would pass directly to Next.js `revalidatePath`. */
  path: string,
  meta: {
    /**
     * `'path'` for normal per-document invalidation; `'site'` when a global uses `revalidateAllOnChange`.
     * Branch on this to pass the `'layout'` scope to Next.js `revalidatePath` for full layout-tree invalidation.
     */
    mode: RevalidationMode
    /** The event that initiated this revalidation. Useful for logging or applying different logic per event type (e.g. skipping certain downstream calls on delete). */
    reason: RevalidationReason
    /** Whether the change came from a collection or a global. Lets you apply different revalidation strategies without hardcoding slugs. */
    scope: 'collection' | 'global'
    /** The collection or global slug that triggered this call. */
    slug: string
  },
) => MaybePromise<void>

/**
 * Callback used to dispatch tag-based revalidation to your platform.
 */
export type RevalidateTagFn = (
  /** The cache tag to bust — mirrors what you would pass directly to Next.js `revalidateTag`. */
  tag: string,
  meta?: {
    /** The event that initiated this revalidation. Useful for logging or applying different logic per event type. */
    reason: RevalidationReason
    /** Whether the change came from a collection or a global. */
    scope: 'collection' | 'global'
    /** The collection or global slug that triggered this call. */
    slug: string
  },
) => MaybePromise<void>

export interface FullRebuildContext {
  /**
   * HTTP status returned by `probeURL`, or `null` if probe was unavailable or skipped.
   */
  probeStatus: null | number
  /** Resolved probe URL for this operation, or `null` if not provided. */
  probeURL: null | string
  /** The content event that led to this rebuild evaluation. Useful for logging or for varying rebuild behavior (e.g. only hitting a deploy webhook on delete). */
  reason: RevalidationReason
  /** Whether the triggering change came from a collection or a global. */
  scope: 'collection' | 'global'
  /** The collection or global slug that triggered this evaluation. */
  slug: string
}

export interface FullRebuildConfig {
  /**
   * Master switch for the full rebuild fallback. Typically set to `process.env.NODE_ENV === 'production'`
   * so that deploys are never accidentally triggered during local development.
   */
  enabled?: boolean
  /**
   * Override the condition under which a rebuild fires. Defaults to `context.probeStatus === 404`.
   * Use this when you need to trigger on additional status codes, or when you want to apply custom
   * logic beyond a simple HTTP check — for example, inspecting the slug or reason before deciding.
   */
  shouldTrigger?: (context: FullRebuildContext) => MaybePromise<boolean>
  /**
   * What to call when a rebuild is warranted. Typically a deploy webhook, a CI/CD pipeline trigger,
   * or a hosted platform rebuild endpoint (Vercel, Netlify, Cloudflare). The `context` argument
   * includes `probeStatus`, `probeURL`, `reason`, `scope`, and `slug` for logging or conditional logic.
   */
  trigger: (context: FullRebuildContext) => MaybePromise<void>
}

/**
 * Optional unpublish-specific behavior for collection targets.
 */
export interface CollectionUnpublishConfig<TSlug extends CollectionSlug = CollectionSlug> {
  /**
   * Set to `false` to ignore unpublish transitions entirely for this target.
   * Useful if your workflow doesn't distinguish draft/publish states, or if you handle
   * the published→draft case via a custom `shouldHandle` instead.
   */
  enabled?: boolean
  /**
   * Custom unpublish detector. Override when your publish model does not use Payload's `_status` field —
   * for example, if you control publish state with a boolean like `isPublished`.
   * The default matcher looks for `operation === 'updateByID'` with `_status: 'draft'` in the request data.
   */
  matcher?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<boolean>
  /**
   * Paths to revalidate when an unpublish is detected. Falls back to the top-level `pathResolver` if omitted.
   * Override when an unpublish should clear different paths than a regular update — for example, removing the
   * document's canonical URL but keeping listing/index pages cached.
   */
  pathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Additional paths resolved alongside `pathResolver`, not instead of it.
   * Useful for invalidating parent or index routes on unpublish.
   */
  referencePathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Additional tags resolved alongside `tagResolver`, not instead of it.
   */
  referenceTagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Cache tags to bust when an unpublish is detected. Falls back to the top-level `tagResolver` if omitted.
   */
  tagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
}

/**
 * Delete-time behavior for collection targets.
 * Deletes are skipped unless `onDelete` is configured.
 */
export interface CollectionDeleteConfig<TSlug extends CollectionSlug = CollectionSlug> {
  /**
   * Paths to revalidate when a document is deleted. The deleted document snapshot is available
   * via `doc` in the args — use its fields where possible, but `id` is always reliable as a fallback.
   */
  pathResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Additional paths resolved alongside `pathResolver`, not instead of it.
   * Useful for index or parent routes that listed the now-deleted document.
   */
  referencePathResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Additional tags resolved alongside `tagResolver`, not instead of it.
   */
  referenceTagResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Cache tags to bust when a document is deleted. Tag-based invalidation pairs well with deletes
   * because you can target `post:<id>` precisely without needing to reconstruct the document's path.
   */
  tagResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
}

type CollectionUpdateResolvers<TSlug extends CollectionSlug> = {
  /**
   * Returns the paths to revalidate when a document in this collection is published or updated.
   * Typically the document's own URL(s) — e.g. `['/posts/${result.slug}']`.
   */
  pathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Returns the absolute URL the plugin should fetch to check whether the route already exists in the cache.
   * Required for the `fullRebuild` fallback to ever fire on this target — without it, no probe runs
   * and a rebuild is never triggered, even if `fullRebuild.enabled` is `true`.
   */
  probeURL?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<null | string | undefined>
  /**
   * Additional paths resolved alongside `pathResolver`, not instead of it.
   * Use this for related routes that depend on this document — parent pages, index/listing pages, etc.
   */
  referencePathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Additional tags resolved alongside `tagResolver`, not instead of it.
   */
  referenceTagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Returns the cache tags to invalidate when a document in this collection is published or updated.
   * Tags let you group related cached responses (e.g. `['posts', 'post:${result.id}']`) and bust them together.
   */
  tagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
}

type CollectionUpdateStrategy<TSlug extends CollectionSlug> = RequireAtLeastOne<
  CollectionUpdateResolvers<TSlug>,
  keyof CollectionUpdateResolvers<TSlug>
>

export type CollectionISRTarget<TSlug extends CollectionSlug = CollectionSlug> =
{
  /**
   * Temporarily skip this target without removing it from config.
   * Handy when debugging unexpected cache invalidations or rolling out targets incrementally.
   */
  disabled?: boolean
  /**
   * Opt-in revalidation strategy for delete operations on this collection.
   * If omitted, deletes are silently skipped and the plugin emits a startup warning — configure this
   * whenever your collection target also has update resolvers.
   */
  onDelete?: CollectionDeleteConfig<TSlug>
  /**
   * Which Payload operations should trigger this target.
   * Defaults to `['create', 'update', 'updateByID']`. Override if you use custom Payload operations
   * or want to narrow the target to specific operation types.
   */
  operations?: ReadonlyArray<CollectionAfterOperationArgs<TSlug>['operation']>
  /**
   * Custom gate that decides whether a given operation should trigger revalidation.
   * Defaults to documents with `_status === 'published'`, or any document that has no `_status` field.
   * Return `false` to skip revalidation for an operation without affecting other targets.
   */
  shouldHandle?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<boolean>
  /**
   * The Payload collection slug this target applies to. Must exactly match a collection registered
   * in your Payload config. TypeScript uses this to infer the document shape across all resolver callbacks.
   */
  slug: TSlug
  /**
   * Override unpublish detection or provide separate resolvers for when a document transitions from
   * published to draft. If omitted, the top-level path/tag resolvers are used on unpublish.
   * Configure this when removing a document from the published state should clear different paths
   * than a regular update — or when your app doesn't use Payload's `_status` field.
   */
  unpublish?: CollectionUnpublishConfig<TSlug>
} & CollectionUpdateStrategy<TSlug>

type GlobalUpdateResolvers<TSlug extends GlobalSlug> = {
  /**
   * Returns the specific paths to revalidate when this global changes.
   * Use this instead of `revalidateAllOnChange` when only a subset of pages depend on the global.
   */
  pathResolver?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<string[]>
  /**
   * Returns the absolute URL the plugin should fetch to check whether the route already exists in the cache.
   * Required for the `fullRebuild` fallback to ever fire on this target — without it, no probe runs
   * and a rebuild is never triggered, even if `fullRebuild.enabled` is `true`.
   */
  probeURL?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<null | string | undefined>
  /**
   * Returns the cache tags to bust when this global changes.
   * Useful for invalidating all pages that fetch from this global without enumerating their paths explicitly.
   */
  tagResolver?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<string[]>
}

type GlobalTargetPathStrategy<TSlug extends GlobalSlug> = {
  /**
   * Keep as `false`/omitted to use targeted path/tag/probe strategies.
   * Set to `true` to revalidate the full site path instead.
   */
  revalidateAllOnChange?: false | undefined
  /**
   * Path sent to `revalidatePath` when `revalidateAllOnChange` is enabled.
   * Defaults to `'/'` and must be absolute.
   */
  revalidateAllPath?: string
} & RequireAtLeastOne<GlobalUpdateResolvers<TSlug>, keyof GlobalUpdateResolvers<TSlug>>

type GlobalTargetSiteStrategy<TSlug extends GlobalSlug> = {
  /**
   * Revalidate the entire site path on each global change.
   * When enabled, `revalidatePath` receives `meta.mode === 'site'`.
   */
  revalidateAllOnChange: true
  /**
   * Path sent to `revalidatePath` for site-wide global revalidation.
   * Defaults to `'/'` and must be absolute.
   */
  revalidateAllPath?: string
} & GlobalUpdateResolvers<TSlug>

type GlobalUpdateStrategy<TSlug extends GlobalSlug> =
  | GlobalTargetPathStrategy<TSlug>
  | GlobalTargetSiteStrategy<TSlug>

export type GlobalISRTarget<TSlug extends GlobalSlug = GlobalSlug> = {
  /**
   * Temporarily skip this target without removing it from config.
   * Handy when debugging unexpected cache invalidations or rolling out targets incrementally.
   */
  disabled?: boolean
  /**
   * Custom gate that decides whether a given global save should trigger revalidation.
   * Defaults to documents with `_status === 'published'`, or any document that has no `_status` field.
   * Return `false` to skip revalidation for a save without affecting other targets.
   */
  shouldHandle?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<boolean>
  /**
   * The Payload global slug this target applies to. Must exactly match a global registered
   * in your Payload config. TypeScript uses this to infer the document shape across all resolver callbacks.
   */
  slug: TSlug
} & GlobalUpdateStrategy<TSlug>

export type AnyCollectionISRTarget = {
  [TSlug in CollectionSlug]: CollectionISRTarget<TSlug>
}[CollectionSlug]

export type AnyGlobalISRTarget = {
  [TSlug in GlobalSlug]: GlobalISRTarget<TSlug>
}[GlobalSlug]

export interface LoggerLike {
  /** Receives plugin errors. Defaults to `console.error` when no logger is supplied. */
  error: (...args: unknown[]) => void
  /**
   * Receives structured debug traces when `debug: true` is set on the plugin — safe to omit
   * if you don't need trace output. Defaults to `console.info` when no logger is supplied.
   */
  info?: (...args: unknown[]) => void
  /** Receives plugin warnings (e.g. startup preflight issues). Defaults to `console.warn` when no logger is supplied. */
  warn: (...args: unknown[]) => void
}

/**
 * Top-level plugin options passed to `payloadIsr({ ... })`.
 */
export type PayloadIsrConfig = {
  /**
   * Collection targets to watch for publish, update, unpublish, and delete events.
   * Each entry declares which Payload collection to watch and how to resolve the cache paths or tags
   * that should be invalidated when that collection changes.
   */
  collections?: AnyCollectionISRTarget[]
  /**
   * Emit structured trace events via `logger.info` for every hook execution, guard decision, and
   * revalidation branch. Useful for understanding why a revalidation did or didn't fire.
   */
  debug?: boolean
  /**
   * Base URL prepended to relative paths in debug output, making logged paths absolute and
   * directly clickable in terminals that support hyperlinks.
   */
  debugURLOrigin?: string
  /** Disable the plugin entirely without removing it from config. Useful during incidents or gradual deployments. */
  disabled?: boolean
  /**
   * Fallback strategy for situations where path or tag invalidation alone isn't enough — for example,
   * when a slug changes and the new URL has never been cached, or catch-all routes that return `404`
   * until a new build is deployed. Requires at least one target to have a `probeURL` resolver.
   */
  fullRebuild?: FullRebuildConfig
  /**
   * Global targets to watch for changes. Each entry declares which Payload global to watch and how to
   * resolve the cache paths or tags that should be invalidated when that global is saved.
   */
  globals?: AnyGlobalISRTarget[]
  /**
   * Custom logger for plugin warnings and debug output. Defaults to `console`.
   * Pass `createPayloadIsrLogger()` for structured `[payload-isr]`-prefixed output with optional
   * filtering of noisy config-level traces.
   */
  logger?: LoggerLike
  /**
   * Called once for each resolved path after a content change. Typically wraps Next.js `revalidatePath`.
   * Check `meta.mode` to detect site-wide global revalidation and pass the `'layout'` scope accordingly.
   */
  revalidatePath: RevalidatePathFn
  /**
   * Called once for each resolved cache tag after a content change. Typically wraps Next.js `revalidateTag`.
   * Omit if you don't use cache tags — the plugin skips tag resolution entirely when this is absent.
   */
  revalidateTag?: RevalidateTagFn
}
