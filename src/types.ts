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

export type CollectionAfterOperationArgs<TSlug extends CollectionSlug = CollectionSlug> = {
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

export type CollectionAfterDeleteArgs<TSlug extends CollectionSlug = CollectionSlug> = {
  doc: DataFromCollectionSlug<TSlug>
} & Omit<
  RawCollectionAfterDeleteArgs<TSlug>,
  'doc'
>

export type GlobalAfterChangeArgs<TSlug extends GlobalSlug = GlobalSlug> = {
  doc: DataFromGlobalSlug<TSlug>
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

export type RevalidatePathFn = (
  path: string,
  meta: {
    mode: RevalidationMode
    reason: RevalidationReason
    scope: 'collection' | 'global'
    slug: string
  },
) => MaybePromise<void>

export type RevalidateTagFn = (
  tag: string,
  meta?: {
    reason: RevalidationReason
    scope: 'collection' | 'global'
    slug: string
  },
) => MaybePromise<void>

export interface FullRebuildContext {
  probeStatus: null | number
  probeURL: null | string
  reason: RevalidationReason
  scope: 'collection' | 'global'
  slug: string
}

export interface FullRebuildConfig {
  enabled?: boolean
  shouldTrigger?: (context: FullRebuildContext) => MaybePromise<boolean>
  trigger: (context: FullRebuildContext) => MaybePromise<void>
}

export interface CollectionUnpublishConfig<TSlug extends CollectionSlug = CollectionSlug> {
  enabled?: boolean
  matcher?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<boolean>
  pathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  referencePathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  referenceTagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  tagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
}

export interface CollectionDeleteConfig<TSlug extends CollectionSlug = CollectionSlug> {
  pathResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
  referencePathResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
  referenceTagResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
  tagResolver?: (args: CollectionAfterDeleteArgs<TSlug>) => MaybePromise<string[]>
}

type CollectionUpdateResolvers<TSlug extends CollectionSlug> = {
  pathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  probeURL?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<null | string | undefined>
  referencePathResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  referenceTagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
  tagResolver?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<string[]>
}

type CollectionUpdateStrategy<TSlug extends CollectionSlug> = RequireAtLeastOne<
  CollectionUpdateResolvers<TSlug>,
  keyof CollectionUpdateResolvers<TSlug>
>

export type CollectionISRTarget<TSlug extends CollectionSlug = CollectionSlug> =
  {
  onDelete?: CollectionDeleteConfig<TSlug>
  operations?: ReadonlyArray<CollectionAfterOperationArgs<TSlug>['operation']>
  shouldHandle?: (args: CollectionAfterOperationArgs<TSlug>) => MaybePromise<boolean>
  slug: TSlug
  unpublish?: CollectionUnpublishConfig<TSlug>
} & CollectionUpdateStrategy<TSlug>

type GlobalUpdateResolvers<TSlug extends GlobalSlug> = {
  pathResolver?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<string[]>
  probeURL?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<null | string | undefined>
  tagResolver?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<string[]>
}

type GlobalTargetPathStrategy<TSlug extends GlobalSlug> = {
  revalidateAllOnChange?: false | undefined
  revalidateAllPath?: string
} & RequireAtLeastOne<GlobalUpdateResolvers<TSlug>, keyof GlobalUpdateResolvers<TSlug>>

type GlobalTargetSiteStrategy<TSlug extends GlobalSlug> = {
  revalidateAllOnChange: true
  revalidateAllPath?: string
} & GlobalUpdateResolvers<TSlug>

type GlobalUpdateStrategy<TSlug extends GlobalSlug> =
  | GlobalTargetPathStrategy<TSlug>
  | GlobalTargetSiteStrategy<TSlug>

export type GlobalISRTarget<TSlug extends GlobalSlug = GlobalSlug> = {
  shouldHandle?: (args: GlobalAfterChangeArgs<TSlug>) => MaybePromise<boolean>
  slug: TSlug
} & GlobalUpdateStrategy<TSlug>

export type AnyCollectionISRTarget = {
  [TSlug in CollectionSlug]: CollectionISRTarget<TSlug>
}[CollectionSlug]

export type AnyGlobalISRTarget = {
  [TSlug in GlobalSlug]: GlobalISRTarget<TSlug>
}[GlobalSlug]

export interface LoggerLike {
  error: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export type PayloadIsrConfig = {
  collections?: AnyCollectionISRTarget[]
  disabled?: boolean
  fullRebuild?: FullRebuildConfig
  globals?: AnyGlobalISRTarget[]
  logger?: LoggerLike
  revalidatePath: RevalidatePathFn
  revalidateTag?: RevalidateTagFn
}
