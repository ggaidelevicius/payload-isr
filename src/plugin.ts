import type { CollectionConfig, Config, GlobalConfig } from 'payload'

import type {
  CollectionAfterOperationArgs,
  CollectionISRTarget,
  FullRebuildContext,
  GlobalISRTarget,
  PayloadIsrConfig,
  RevalidationMode,
  RevalidationReason,
} from './types.js'

import {
  defaultPublishedDocGuard,
  defaultUnpublishMatcher,
  normalizePaths,
  normalizeTags,
} from './utils.js'

type CollectionAfterOperationHookFn = NonNullable<
  NonNullable<CollectionConfig['hooks']>['afterOperation']
>[number]

type CollectionAfterOperationHookArgs = Parameters<CollectionAfterOperationHookFn>[0]

type CollectionAfterDeleteHookFn = NonNullable<
  NonNullable<CollectionConfig['hooks']>['afterDelete']
>[number]

type GlobalAfterChangeHookFn = NonNullable<
  NonNullable<GlobalConfig['hooks']>['afterChange']
>[number]

const DEFAULT_COLLECTION_OPERATIONS: ReadonlyArray<CollectionAfterOperationArgs['operation']> = [
  'create',
  'update',
  'updateByID',
]

const isSupportedCollectionOperation = (
  operation: CollectionAfterOperationHookArgs['operation'],
): operation is CollectionAfterOperationArgs['operation'] =>
  DEFAULT_COLLECTION_OPERATIONS.includes(operation as CollectionAfterOperationArgs['operation'])

const resolveProbeStatus = async (
  probeURL: string,
  options: PayloadIsrConfig,
): Promise<null | number> => {
  try {
    const response = await fetch(probeURL)
    return response.status
  } catch (error) {
    options.logger?.warn(
      `[payload-isr] Failed to probe URL "${probeURL}". Continuing with cache revalidation.`,
      error,
    )
    return null
  }
}

const maybeTriggerFullRebuild = async (
  options: PayloadIsrConfig,
  args: {
    probeURL: null | string | undefined
    reason: RevalidationReason
    scope: 'collection' | 'global'
    slug: string
  },
): Promise<boolean> => {
  if (!options.fullRebuild) {
    return false
  }
  if (options.fullRebuild.enabled === false) {
    return false
  }
  if (!args.probeURL) {
    return false
  }

  const probeStatus = await resolveProbeStatus(args.probeURL, options)

  const context: FullRebuildContext = {
    slug: args.slug,
    probeStatus,
    probeURL: args.probeURL,
    reason: args.reason,
    scope: args.scope,
  }

  const shouldTrigger = options.fullRebuild.shouldTrigger
    ? await options.fullRebuild.shouldTrigger(context)
    : probeStatus === 404

  if (!shouldTrigger) {
    return false
  }

  await options.fullRebuild.trigger(context)
  return true
}

const revalidatePaths = async (
  options: PayloadIsrConfig,
  args: {
    mode: RevalidationMode
    paths: string[]
    reason: RevalidationReason
    scope: 'collection' | 'global'
    slug: string
  },
): Promise<void> => {
  for (const path of normalizePaths(args.paths)) {
    await options.revalidatePath(path, {
      slug: args.slug,
      mode: args.mode,
      reason: args.reason,
      scope: args.scope,
    })
  }
}

const revalidateTags = async (
  options: PayloadIsrConfig,
  args: {
    reason: RevalidationReason
    scope: 'collection' | 'global'
    slug: string
    tags: string[]
  },
): Promise<void> => {
  const tags = normalizeTags(args.tags)
  if (tags.length === 0) {
    return
  }

  if (!options.revalidateTag) {
    options.logger?.warn(
      `[payload-isr] Tags were resolved for "${args.slug}", but revalidateTag is not configured. Skipping tag revalidation.`,
    )
    return
  }

  for (const tag of tags) {
    await options.revalidateTag(tag, {
      slug: args.slug,
      reason: args.reason,
      scope: args.scope,
    })
  }
}

const resolveCollectionPaths = async (
  target: CollectionISRTarget,
  args: CollectionAfterOperationArgs,
): Promise<string[]> => {
  const basePaths = target.pathResolver ? await target.pathResolver(args) : []
  const referencePaths = target.referencePathResolver
    ? await target.referencePathResolver(args)
    : []

  return [...basePaths, ...referencePaths]
}

const resolveCollectionTags = async (
  target: CollectionISRTarget,
  args: CollectionAfterOperationArgs,
): Promise<string[]> => {
  const baseTags = target.tagResolver ? await target.tagResolver(args) : []
  const referenceTags = target.referenceTagResolver ? await target.referenceTagResolver(args) : []

  return [...baseTags, ...referenceTags]
}

const buildCollectionAfterOperationHook = (
  target: CollectionISRTarget,
  options: PayloadIsrConfig,
): CollectionAfterOperationHookFn => {
  return async (args) => {
    if (!isSupportedCollectionOperation(args.operation)) {
      return args.result
    }
    const operationArgs = args as unknown as CollectionAfterOperationArgs
    const supportsUnpublish = target.unpublish?.enabled !== false

    if (
      supportsUnpublish &&
      (operationArgs.operation === 'update' || operationArgs.operation === 'updateByID')
    ) {
      const matcher = target.unpublish?.matcher ?? defaultUnpublishMatcher
      const isUnpublish = await matcher(operationArgs)

      if (isUnpublish) {
        const paths = [
          ...(target.unpublish?.pathResolver
            ? await target.unpublish.pathResolver(operationArgs)
            : target.pathResolver
              ? await target.pathResolver(operationArgs)
              : []),
          ...(target.unpublish?.referencePathResolver
            ? await target.unpublish.referencePathResolver(operationArgs)
            : target.referencePathResolver
              ? await target.referencePathResolver(operationArgs)
              : []),
        ]

        const tags = [
          ...(target.unpublish?.tagResolver
            ? await target.unpublish.tagResolver(operationArgs)
            : target.tagResolver
              ? await target.tagResolver(operationArgs)
              : []),
          ...(target.unpublish?.referenceTagResolver
            ? await target.unpublish.referenceTagResolver(operationArgs)
            : target.referenceTagResolver
              ? await target.referenceTagResolver(operationArgs)
              : []),
        ]

        await revalidatePaths(options, {
          slug: target.slug,
          mode: 'path',
          paths,
          reason: 'collection-unpublish',
          scope: 'collection',
        })
        await revalidateTags(options, {
          slug: target.slug,
          reason: 'collection-unpublish',
          scope: 'collection',
          tags,
        })

        return args.result
      }
    }

    const operations = target.operations ?? DEFAULT_COLLECTION_OPERATIONS
    if (!operations.includes(operationArgs.operation)) {
      return args.result
    }

    const shouldHandle = target.shouldHandle
      ? await target.shouldHandle(operationArgs)
      : defaultPublishedDocGuard(operationArgs.result)

    if (!shouldHandle) {
      return args.result
    }

    const fullRebuildTriggered = await maybeTriggerFullRebuild(options, {
      slug: target.slug,
      probeURL: target.probeURL ? await target.probeURL(operationArgs) : null,
      reason: 'collection-update',
      scope: 'collection',
    })

    if (fullRebuildTriggered) {
      return args.result
    }

    await revalidatePaths(options, {
      slug: target.slug,
      mode: 'path',
      paths: await resolveCollectionPaths(target, operationArgs),
      reason: 'collection-update',
      scope: 'collection',
    })
    await revalidateTags(options, {
      slug: target.slug,
      reason: 'collection-update',
      scope: 'collection',
      tags: await resolveCollectionTags(target, operationArgs),
    })

    return args.result
  }
}

const buildCollectionAfterDeleteHook = (
  target: CollectionISRTarget,
  options: PayloadIsrConfig,
): CollectionAfterDeleteHookFn => {
  return async (args) => {
    if (!target.onDelete) {
      return args.doc
    }

    const paths = [
      ...(target.onDelete.pathResolver ? await target.onDelete.pathResolver(args) : []),
      ...(target.onDelete.referencePathResolver
        ? await target.onDelete.referencePathResolver(args)
        : []),
    ]

    const tags = [
      ...(target.onDelete.tagResolver ? await target.onDelete.tagResolver(args) : []),
      ...(target.onDelete.referenceTagResolver
        ? await target.onDelete.referenceTagResolver(args)
        : []),
    ]

    await revalidatePaths(options, {
      slug: target.slug,
      mode: 'path',
      paths,
      reason: 'collection-delete',
      scope: 'collection',
    })
    await revalidateTags(options, {
      slug: target.slug,
      reason: 'collection-delete',
      scope: 'collection',
      tags,
    })

    return args.doc
  }
}

const buildGlobalAfterChangeHook = (
  target: GlobalISRTarget,
  options: PayloadIsrConfig,
): GlobalAfterChangeHookFn => {
  return async (args) => {
    const shouldHandle = target.shouldHandle
      ? await target.shouldHandle(args)
      : defaultPublishedDocGuard(args.doc)

    if (!shouldHandle) {
      return args.doc
    }

    const fullRebuildTriggered = await maybeTriggerFullRebuild(options, {
      slug: target.slug,
      probeURL: target.probeURL ? await target.probeURL(args) : null,
      reason: 'global-update',
      scope: 'global',
    })

    if (fullRebuildTriggered) {
      return args.doc
    }

    if (target.revalidateAllOnChange) {
      await revalidatePaths(options, {
        slug: target.slug,
        mode: 'site',
        paths: [target.revalidateAllPath ?? '/'],
        reason: 'global-update',
        scope: 'global',
      })
    } else {
      await revalidatePaths(options, {
        slug: target.slug,
        mode: 'path',
        paths: target.pathResolver ? await target.pathResolver(args) : [],
        reason: 'global-update',
        scope: 'global',
      })
    }

    await revalidateTags(options, {
      slug: target.slug,
      reason: 'global-update',
      scope: 'global',
      tags: target.tagResolver ? await target.tagResolver(args) : [],
    })

    return args.doc
  }
}

const applyCollectionTarget = (
  config: Config,
  options: PayloadIsrConfig,
  target: CollectionISRTarget,
): void => {
  if (!config.collections) {
    config.collections = []
  }

  const index = config.collections.findIndex((collection) => collection.slug === target.slug)

  if (index < 0) {
    options.logger?.warn(`[payload-isr] Collection "${target.slug}" not found. Skipping target.`)
    return
  }

  const existingCollection = config.collections[index]
  const hooks = {
    ...(existingCollection.hooks ?? {}),
  }

  hooks.afterOperation = [
    ...(hooks.afterOperation ?? []),
    buildCollectionAfterOperationHook(target, options),
  ]

  if (target.onDelete) {
    hooks.afterDelete = [
      ...(hooks.afterDelete ?? []),
      buildCollectionAfterDeleteHook(target, options),
    ]
  }

  config.collections[index] = {
    ...existingCollection,
    hooks,
  }
}

const applyGlobalTarget = (
  config: Config,
  options: PayloadIsrConfig,
  target: GlobalISRTarget,
): void => {
  if (!config.globals) {
    config.globals = []
  }

  const index = config.globals.findIndex((global) => global.slug === target.slug)

  if (index < 0) {
    options.logger?.warn(`[payload-isr] Global "${target.slug}" not found. Skipping target.`)
    return
  }

  const existingGlobal = config.globals[index]
  const hooks = {
    ...(existingGlobal.hooks ?? {}),
  }

  hooks.afterChange = [...(hooks.afterChange ?? []), buildGlobalAfterChangeHook(target, options)]

  config.globals[index] = {
    ...existingGlobal,
    hooks,
  }
}

export const payloadIsr =
  (pluginOptions: PayloadIsrConfig) =>
  (incomingConfig: Config): Config => {
    if (pluginOptions.disabled) {
      return incomingConfig
    }

    const config: Config = {
      ...incomingConfig,
      collections: [...(incomingConfig.collections ?? [])],
      globals: [...(incomingConfig.globals ?? [])],
    }

    const runtimeOptions: PayloadIsrConfig = {
      ...pluginOptions,
      logger: pluginOptions.logger ?? console,
    }

    for (const collectionTarget of runtimeOptions.collections ?? []) {
      applyCollectionTarget(config, runtimeOptions, collectionTarget)
    }

    for (const globalTarget of runtimeOptions.globals ?? []) {
      applyGlobalTarget(config, runtimeOptions, globalTarget)
    }

    return config
  }
