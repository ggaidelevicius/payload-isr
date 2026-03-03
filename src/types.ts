import type {
  CollectionAfterDeleteHook,
  CollectionAfterOperationHook,
  GlobalAfterChangeHook,
} from 'payload'

export type MaybePromise<T> = Promise<T> | T

export interface ISRDocument {
  [key: string]: unknown
  _status?: string
  slug?: string
}

type RawCollectionAfterOperationArgs = Parameters<CollectionAfterOperationHook<string>>[0]

export type CollectionContentOperation = 'create' | 'update' | 'updateByID'

export type CollectionAfterOperationArgs<TDoc extends ISRDocument = ISRDocument> = {
  result: TDoc
} & Omit<
  Extract<
    RawCollectionAfterOperationArgs,
    {
      operation: CollectionContentOperation
    }
  >,
  'result'
>

export type CollectionAfterDeleteArgs<TDoc extends ISRDocument = ISRDocument> = {
  doc: TDoc
} & Omit<
  Parameters<CollectionAfterDeleteHook>[0],
  'doc'
>

export type GlobalAfterChangeArgs<TDoc extends ISRDocument = ISRDocument> = {
  doc: TDoc
} & Omit<
  Parameters<GlobalAfterChangeHook>[0],
  'doc'
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

export interface CollectionUnpublishConfig {
  enabled?: boolean
  matcher?: (args: CollectionAfterOperationArgs) => MaybePromise<boolean>
  pathResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
  referencePathResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
  referenceTagResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
  tagResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
}

export interface CollectionDeleteConfig {
  pathResolver?: (args: CollectionAfterDeleteArgs) => MaybePromise<string[]>
  referencePathResolver?: (args: CollectionAfterDeleteArgs) => MaybePromise<string[]>
  referenceTagResolver?: (args: CollectionAfterDeleteArgs) => MaybePromise<string[]>
  tagResolver?: (args: CollectionAfterDeleteArgs) => MaybePromise<string[]>
}

export interface CollectionISRTarget {
  onDelete?: CollectionDeleteConfig
  operations?: ReadonlyArray<CollectionAfterOperationArgs['operation']>
  pathResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
  probeURL?: (args: CollectionAfterOperationArgs) => MaybePromise<null | string | undefined>
  referencePathResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
  referenceTagResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
  shouldHandle?: (args: CollectionAfterOperationArgs) => MaybePromise<boolean>
  slug: string
  tagResolver?: (args: CollectionAfterOperationArgs) => MaybePromise<string[]>
  unpublish?: CollectionUnpublishConfig
}

export interface GlobalISRTarget {
  pathResolver?: (args: GlobalAfterChangeArgs) => MaybePromise<string[]>
  probeURL?: (args: GlobalAfterChangeArgs) => MaybePromise<null | string | undefined>
  revalidateAllOnChange?: boolean
  revalidateAllPath?: string
  shouldHandle?: (args: GlobalAfterChangeArgs) => MaybePromise<boolean>
  slug: string
  tagResolver?: (args: GlobalAfterChangeArgs) => MaybePromise<string[]>
}

export interface LoggerLike {
  error: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export type PayloadIsrConfig = {
  collections?: CollectionISRTarget[]
  disabled?: boolean
  fullRebuild?: FullRebuildConfig
  globals?: GlobalISRTarget[]
  logger?: LoggerLike
  revalidatePath: RevalidatePathFn
  revalidateTag?: RevalidateTagFn
}
