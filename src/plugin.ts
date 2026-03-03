import type { CollectionConfig, Config, GlobalConfig } from 'payload'

import type {
  AnyCollectionISRTarget,
  AnyGlobalISRTarget,
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

const isFullRebuildEnabled = (options: PayloadIsrConfig): boolean =>
  Boolean(options.fullRebuild) && options.fullRebuild?.enabled !== false

const getDocumentId = (doc: unknown): null | string => {
  if (typeof doc !== 'object' || doc === null || !('id' in doc)) {
    return null
  }

  const value = (doc as { id?: unknown }).id
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  return null
}

const logDebugTrace = (
  options: PayloadIsrConfig,
  event: string,
  details: Record<string, unknown> = {},
): void => {
  if (!options.debug || !options.logger?.info) {
    return
  }

  options.logger.info({
    source: 'payload-isr',
    type: 'debug-trace',
    event,
    ...details,
  })
}

const findDuplicateSlugs = <TTarget extends { slug: string }>(targets: TTarget[]): string[] => {
  const counts = new Map<string, number>()

  for (const target of targets) {
    counts.set(target.slug, (counts.get(target.slug) ?? 0) + 1)
  }

  return [...counts.entries()].filter(([, count]) => count > 1).map(([slug]) => slug)
}

const hasCollectionUpdateStrategy = (target: AnyCollectionISRTarget): boolean =>
  Boolean(
    target.pathResolver ||
      target.tagResolver ||
      target.referencePathResolver ||
      target.referenceTagResolver ||
      target.probeURL,
  )

const hasGlobalUpdateStrategy = (target: AnyGlobalISRTarget): boolean =>
  target.revalidateAllOnChange === true || Boolean(target.pathResolver || target.tagResolver || target.probeURL)

const usesTagResolvers = (options: PayloadIsrConfig): boolean =>
  (options.collections ?? []).some(
    (target) =>
      Boolean(
        target.tagResolver ||
          target.referenceTagResolver ||
          target.onDelete?.tagResolver ||
          target.onDelete?.referenceTagResolver ||
          target.unpublish?.tagResolver ||
          target.unpublish?.referenceTagResolver,
      ),
  ) || (options.globals ?? []).some((target) => Boolean(target.tagResolver))

const validateRuntimeConfiguration = (options: PayloadIsrConfig): void => {
  const collectionTargets = options.collections ?? []
  const globalTargets = options.globals ?? []
  logDebugTrace(options, 'config.validate.start', {
    collectionTargetCount: collectionTargets.length,
    globalTargetCount: globalTargets.length,
    hasRevalidateTag: Boolean(options.revalidateTag),
    fullRebuildConfigured: Boolean(options.fullRebuild),
    fullRebuildEnabled: options.fullRebuild?.enabled !== false,
  })

  const duplicateCollections = findDuplicateSlugs(collectionTargets)
  if (duplicateCollections.length > 0) {
    options.logger?.warn(
      `[payload-isr] Duplicate collection targets detected: ${duplicateCollections.join(
        ', ',
      )}. Hooks may run multiple times for the same slug.`,
    )
  }

  const duplicateGlobals = findDuplicateSlugs(globalTargets)
  if (duplicateGlobals.length > 0) {
    options.logger?.warn(
      `[payload-isr] Duplicate global targets detected: ${duplicateGlobals.join(
        ', ',
      )}. Hooks may run multiple times for the same slug.`,
    )
  }

  const missingCollectionStrategy = collectionTargets
    .filter((target) => !hasCollectionUpdateStrategy(target))
    .map((target) => target.slug)
  if (missingCollectionStrategy.length > 0) {
    options.logger?.warn(
      `[payload-isr] Collection targets missing update revalidation strategy (path/tag/probe): ${missingCollectionStrategy.join(
        ', ',
      )}.`,
    )
  }

  const missingGlobalStrategy = globalTargets
    .filter((target) => !hasGlobalUpdateStrategy(target))
    .map((target) => target.slug)
  if (missingGlobalStrategy.length > 0) {
    options.logger?.warn(
      `[payload-isr] Global targets missing revalidation strategy (revalidateAllOnChange/path/tag/probe): ${missingGlobalStrategy.join(
        ', ',
      )}.`,
    )
  }

  if (usesTagResolvers(options) && !options.revalidateTag) {
    options.logger?.warn(
      '[payload-isr] Tag resolvers are configured, but revalidateTag is not provided. Tag revalidation callbacks will be skipped.',
    )
  }

  for (const target of globalTargets) {
    if (target.revalidateAllOnChange && target.pathResolver) {
      options.logger?.warn(
        `[payload-isr] Global "${target.slug}" has revalidateAllOnChange enabled; pathResolver is ignored for that target.`,
      )
    }

    if (
      target.revalidateAllOnChange &&
      target.revalidateAllPath &&
      !target.revalidateAllPath.startsWith('/')
    ) {
      options.logger?.warn(
        `[payload-isr] Global "${target.slug}" has revalidateAllPath="${target.revalidateAllPath}" which does not start with "/". It will be ignored by path normalization.`,
      )
    }
  }

  logDebugTrace(options, 'config.validate.complete')
}

const isSupportedCollectionOperation = (
  operation: CollectionAfterOperationHookArgs['operation'],
): operation is CollectionAfterOperationArgs['operation'] =>
  DEFAULT_COLLECTION_OPERATIONS.includes(operation as CollectionAfterOperationArgs['operation'])

const resolveProbeStatus = async (
  probeURL: string,
  options: PayloadIsrConfig,
): Promise<null | number> => {
  logDebugTrace(options, 'fullRebuild.probe.start', { probeURL })

  try {
    const response = await fetch(probeURL)
    logDebugTrace(options, 'fullRebuild.probe.complete', {
      probeURL,
      probeStatus: response.status,
    })
    return response.status
  } catch (error) {
    options.logger?.warn(
      `[payload-isr] Failed to probe URL "${probeURL}". Continuing with cache revalidation.`,
      error,
    )
    logDebugTrace(options, 'fullRebuild.probe.failed', { probeURL })
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
    logDebugTrace(options, 'fullRebuild.skip.noConfig', {
      slug: args.slug,
      reason: args.reason,
      scope: args.scope,
    })
    return false
  }
  if (options.fullRebuild.enabled === false) {
    logDebugTrace(options, 'fullRebuild.skip.disabled', {
      slug: args.slug,
      reason: args.reason,
      scope: args.scope,
    })
    return false
  }
  if (!args.probeURL) {
    logDebugTrace(options, 'fullRebuild.skip.noProbeURL', {
      slug: args.slug,
      reason: args.reason,
      scope: args.scope,
    })
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

  logDebugTrace(options, 'fullRebuild.decision', {
    slug: args.slug,
    reason: args.reason,
    scope: args.scope,
    probeStatus,
    probeURL: args.probeURL,
    shouldTrigger,
    hasCustomShouldTrigger: Boolean(options.fullRebuild.shouldTrigger),
  })

  if (!shouldTrigger) {
    return false
  }

  await options.fullRebuild.trigger(context)
  logDebugTrace(options, 'fullRebuild.triggered', {
    slug: args.slug,
    reason: args.reason,
    scope: args.scope,
    probeStatus,
    probeURL: args.probeURL,
  })
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
  const normalizedPaths = normalizePaths(args.paths)
  logDebugTrace(options, 'revalidate.paths.resolved', {
    slug: args.slug,
    reason: args.reason,
    scope: args.scope,
    mode: args.mode,
    rawCount: args.paths.length,
    normalizedCount: normalizedPaths.length,
    normalizedPaths,
  })

  for (const path of normalizedPaths) {
    logDebugTrace(options, 'revalidate.path.dispatch', {
      slug: args.slug,
      reason: args.reason,
      scope: args.scope,
      mode: args.mode,
      path,
    })
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
  logDebugTrace(options, 'revalidate.tags.resolved', {
    slug: args.slug,
    reason: args.reason,
    scope: args.scope,
    rawCount: args.tags.length,
    normalizedCount: tags.length,
    normalizedTags: tags,
  })

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
    logDebugTrace(options, 'revalidate.tag.dispatch', {
      slug: args.slug,
      reason: args.reason,
      scope: args.scope,
      tag,
    })
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
    logDebugTrace(options, 'collection.afterOperation.enter', {
      slug: target.slug,
      operation: args.operation,
      documentId: getDocumentId(args.result),
    })

    if (!isSupportedCollectionOperation(args.operation)) {
      logDebugTrace(options, 'collection.afterOperation.skip.unsupportedOperation', {
        slug: target.slug,
        operation: args.operation,
      })
      return args.result
    }
    const operationArgs = args as unknown as CollectionAfterOperationArgs
    const supportsUnpublish = target.unpublish?.enabled !== false

    logDebugTrace(options, 'collection.afterOperation.unpublish.check', {
      slug: target.slug,
      operation: operationArgs.operation,
      supportsUnpublish,
    })

    if (
      supportsUnpublish &&
      (operationArgs.operation === 'update' || operationArgs.operation === 'updateByID')
    ) {
      const matcher = target.unpublish?.matcher ?? defaultUnpublishMatcher
      const isUnpublish = await matcher(operationArgs)
      logDebugTrace(options, 'collection.afterOperation.unpublish.result', {
        slug: target.slug,
        operation: operationArgs.operation,
        isUnpublish,
      })

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

        logDebugTrace(options, 'collection.afterOperation.unpublish.revalidate', {
          slug: target.slug,
          pathCount: paths.length,
          tagCount: tags.length,
        })

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

        logDebugTrace(options, 'collection.afterOperation.unpublish.complete', {
          slug: target.slug,
        })
        return args.result
      }
    }

    const operations = target.operations ?? DEFAULT_COLLECTION_OPERATIONS
    if (!operations.includes(operationArgs.operation)) {
      logDebugTrace(options, 'collection.afterOperation.skip.operationNotEnabled', {
        slug: target.slug,
        operation: operationArgs.operation,
        enabledOperations: operations,
      })
      return args.result
    }

    const shouldHandle = target.shouldHandle
      ? await target.shouldHandle(operationArgs)
      : defaultPublishedDocGuard(operationArgs.result)
    logDebugTrace(options, 'collection.afterOperation.shouldHandle.result', {
      slug: target.slug,
      operation: operationArgs.operation,
      shouldHandle,
      usedCustomGuard: Boolean(target.shouldHandle),
    })

    if (!shouldHandle) {
      logDebugTrace(options, 'collection.afterOperation.skip.shouldHandleFalse', {
        slug: target.slug,
        operation: operationArgs.operation,
      })
      return args.result
    }

    const probeURL = target.probeURL ? await target.probeURL(operationArgs) : null
    logDebugTrace(options, 'collection.afterOperation.probeURL.resolved', {
      slug: target.slug,
      operation: operationArgs.operation,
      hasProbeURL: Boolean(probeURL),
      probeURL,
    })

    const fullRebuildTriggered = await maybeTriggerFullRebuild(options, {
      slug: target.slug,
      probeURL,
      reason: 'collection-update',
      scope: 'collection',
    })

    if (fullRebuildTriggered) {
      logDebugTrace(options, 'collection.afterOperation.complete.fullRebuild', {
        slug: target.slug,
        operation: operationArgs.operation,
      })
      return args.result
    }

    const paths = await resolveCollectionPaths(target, operationArgs)
    const tags = await resolveCollectionTags(target, operationArgs)
    logDebugTrace(options, 'collection.afterOperation.revalidate', {
      slug: target.slug,
      operation: operationArgs.operation,
      pathCount: paths.length,
      tagCount: tags.length,
    })

    await revalidatePaths(options, {
      slug: target.slug,
      mode: 'path',
      paths,
      reason: 'collection-update',
      scope: 'collection',
    })
    await revalidateTags(options, {
      slug: target.slug,
      reason: 'collection-update',
      scope: 'collection',
      tags,
    })

    logDebugTrace(options, 'collection.afterOperation.complete.revalidation', {
      slug: target.slug,
      operation: operationArgs.operation,
    })
    return args.result
  }
}

const buildCollectionAfterDeleteHook = (
  target: CollectionISRTarget,
  options: PayloadIsrConfig,
): CollectionAfterDeleteHookFn => {
  return async (args) => {
    logDebugTrace(options, 'collection.afterDelete.enter', {
      slug: target.slug,
      documentId: getDocumentId(args.doc),
      hasOnDelete: Boolean(target.onDelete),
    })

    if (!target.onDelete) {
      logDebugTrace(options, 'collection.afterDelete.skip.noOnDeleteConfig', {
        slug: target.slug,
      })
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

    logDebugTrace(options, 'collection.afterDelete.revalidate', {
      slug: target.slug,
      pathCount: paths.length,
      tagCount: tags.length,
    })

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

    logDebugTrace(options, 'collection.afterDelete.complete.revalidation', {
      slug: target.slug,
    })
    return args.doc
  }
}

const buildGlobalAfterChangeHook = (
  target: GlobalISRTarget,
  options: PayloadIsrConfig,
): GlobalAfterChangeHookFn => {
  return async (args) => {
    logDebugTrace(options, 'global.afterChange.enter', {
      slug: target.slug,
      documentId: getDocumentId(args.doc),
      revalidateAllOnChange: Boolean(target.revalidateAllOnChange),
    })

    const shouldHandle = target.shouldHandle
      ? await target.shouldHandle(args)
      : defaultPublishedDocGuard(args.doc)
    logDebugTrace(options, 'global.afterChange.shouldHandle.result', {
      slug: target.slug,
      shouldHandle,
      usedCustomGuard: Boolean(target.shouldHandle),
    })

    if (!shouldHandle) {
      logDebugTrace(options, 'global.afterChange.skip.shouldHandleFalse', {
        slug: target.slug,
      })
      return args.doc
    }

    const probeURL = target.probeURL ? await target.probeURL(args) : null
    logDebugTrace(options, 'global.afterChange.probeURL.resolved', {
      slug: target.slug,
      hasProbeURL: Boolean(probeURL),
      probeURL,
    })

    const fullRebuildTriggered = await maybeTriggerFullRebuild(options, {
      slug: target.slug,
      probeURL,
      reason: 'global-update',
      scope: 'global',
    })

    if (fullRebuildTriggered) {
      logDebugTrace(options, 'global.afterChange.complete.fullRebuild', {
        slug: target.slug,
      })
      return args.doc
    }

    if (target.revalidateAllOnChange) {
      logDebugTrace(options, 'global.afterChange.revalidateAll', {
        slug: target.slug,
        path: target.revalidateAllPath ?? '/',
      })
      await revalidatePaths(options, {
        slug: target.slug,
        mode: 'site',
        paths: [target.revalidateAllPath ?? '/'],
        reason: 'global-update',
        scope: 'global',
      })
    } else {
      const paths = target.pathResolver ? await target.pathResolver(args) : []
      logDebugTrace(options, 'global.afterChange.revalidatePaths', {
        slug: target.slug,
        pathCount: paths.length,
      })
      await revalidatePaths(options, {
        slug: target.slug,
        mode: 'path',
        paths,
        reason: 'global-update',
        scope: 'global',
      })
    }

    const tags = target.tagResolver ? await target.tagResolver(args) : []
    logDebugTrace(options, 'global.afterChange.revalidateTags', {
      slug: target.slug,
      tagCount: tags.length,
    })
    await revalidateTags(options, {
      slug: target.slug,
      reason: 'global-update',
      scope: 'global',
      tags,
    })

    logDebugTrace(options, 'global.afterChange.complete.revalidation', {
      slug: target.slug,
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
    logDebugTrace(options, 'config.applyCollectionTarget.skip.notFound', {
      slug: target.slug,
    })
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

  logDebugTrace(options, 'config.applyCollectionTarget.applied', {
    slug: target.slug,
    afterOperationHookCount: hooks.afterOperation?.length ?? 0,
    afterDeleteHookCount: hooks.afterDelete?.length ?? 0,
  })
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
    logDebugTrace(options, 'config.applyGlobalTarget.skip.notFound', {
      slug: target.slug,
    })
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

  logDebugTrace(options, 'config.applyGlobalTarget.applied', {
    slug: target.slug,
    afterChangeHookCount: hooks.afterChange?.length ?? 0,
  })
}

export const payloadIsr =
  <const TConfig extends PayloadIsrConfig>(pluginOptions: TConfig) =>
  (incomingConfig: Config): Config => {
    if (pluginOptions.disabled) {
      logDebugTrace(pluginOptions, 'config.skip.disabled')
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

    logDebugTrace(runtimeOptions, 'config.runtime.initialized', {
      collectionTargetCount: runtimeOptions.collections?.length ?? 0,
      globalTargetCount: runtimeOptions.globals?.length ?? 0,
      fullRebuildConfigured: Boolean(runtimeOptions.fullRebuild),
      fullRebuildEnabled: runtimeOptions.fullRebuild?.enabled !== false,
    })

    validateRuntimeConfiguration(runtimeOptions)

    if (isFullRebuildEnabled(runtimeOptions)) {
      const hasProbeURLResolver =
        (runtimeOptions.collections ?? []).some((target) => typeof target.probeURL === 'function') ||
        (runtimeOptions.globals ?? []).some((target) => typeof target.probeURL === 'function')

      if (!hasProbeURLResolver) {
        runtimeOptions.logger?.warn(
          '[payload-isr] fullRebuild is enabled, but no probeURL resolvers are configured. Full rebuild fallback will never run.',
        )
        logDebugTrace(runtimeOptions, 'fullRebuild.warn.noProbeResolver')
      }
    }

    for (const collectionTarget of runtimeOptions.collections ?? []) {
      applyCollectionTarget(config, runtimeOptions, collectionTarget)
    }

    for (const globalTarget of runtimeOptions.globals ?? []) {
      applyGlobalTarget(config, runtimeOptions, globalTarget)
    }

    logDebugTrace(runtimeOptions, 'config.runtime.complete')
    return config
  }
