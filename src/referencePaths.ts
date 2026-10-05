import type {
  FindReferencingPathsOptions,
  ISRDocument,
  ReferencingDocumentMeta,
} from './types.js'

import {
  defaultPublishedDocGuard,
  normalizePaths,
} from './utils.js'

const getValuesAtPath = (
  value: unknown,
  segments: ReadonlyArray<string>,
): unknown[] => {
  let values: unknown[] = [value]

  for (const segment of segments) {
    const pending = values
    values = []
    const visited = new WeakSet<object>()

    while (pending.length > 0) {
      const current = pending.pop()
      if (typeof current !== 'object' || current === null || visited.has(current)) {
        continue
      }
      visited.add(current)

      if (Array.isArray(current) && !Object.hasOwn(current, segment) && !/^\d+$/.test(segment)) {
        for (const item of current) {
          pending.push(item)
        }
      } else if (Object.hasOwn(current, segment)) {
        values.push((current as Record<string, unknown>)[segment])
      }
    }
  }

  return values
}

const hasReferenceMatch = (
  value: unknown,
  references: ReadonlySet<string>,
): boolean => {
  const pending = [value]
  const visited = new WeakSet<object>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string' || typeof current === 'number') {
      if (references.has(String(current))) {
        return true
      }
      continue
    }

    if (typeof current !== 'object' || current === null || visited.has(current)) {
      continue
    }
    visited.add(current)

    for (const item of Object.values(current)) {
      pending.push(item)
    }
  }

  return false
}

const normalizeReferenceValues = (
  referencedValues: FindReferencingPathsOptions['referencedValues'],
): string[] => {
  const values = Array.isArray(referencedValues) ? referencedValues : [referencedValues]

  return values.flatMap((value) => {
    if (typeof value === 'number') {
      return [String(value)]
    }
    if (typeof value === 'string') {
      const normalized = value.trim()
      return normalized.length > 0 ? [normalized] : []
    }

    return []
  })
}

const getDefaultReferencingPaths = (
  doc: ISRDocument,
  meta: ReferencingDocumentMeta,
): string[] => {
  const lastBreadcrumbURL = doc.breadcrumbs?.at(-1)?.url
  if (typeof lastBreadcrumbURL === 'string' && lastBreadcrumbURL.startsWith('/')) {
    return [lastBreadcrumbURL]
  }

  if (typeof doc.slug === 'string') {
    const slug = doc.slug.trim()
    if (slug.length > 0) {
      return [`/${slug}`]
    }
  }

  if (typeof doc.id === 'string' || typeof doc.id === 'number') {
    return [`/${String(doc.id)}`]
  }

  if (meta.scope === 'global') {
    return ['/']
  }

  return []
}

const getSearchRootsFromFieldPaths = <TDoc extends ISRDocument>(
  doc: TDoc,
  fieldPaths: ReadonlyArray<ReadonlyArray<string>>,
): unknown[] => {
  return fieldPaths
    .flatMap((fieldPath) => getValuesAtPath(doc, fieldPath))
    .filter((value) => typeof value !== 'undefined')
}

export const findReferencingPaths = async <TDoc extends ISRDocument = ISRDocument>(
  options: FindReferencingPathsOptions<TDoc>,
): Promise<string[]> => {
  const referenceValues = normalizeReferenceValues(options.referencedValues)
  if (referenceValues.length === 0) {
    return []
  }

  const fieldPaths = options.fieldPaths
    ?.map((fieldPath) => fieldPath.split('.').map((segment) => segment.trim()).filter(Boolean))
    .filter((segments) => segments.length > 0) ?? []
  if (fieldPaths.length === 0 && !options.getSearchRoots) {
    throw new Error(
      '[payload-isr] findReferencingPaths requires either fieldPaths or getSearchRoots.',
    )
  }

  const logger = options.logger ?? console
  const queryDepth = options.queryDepth ?? 0
  const overrideAccess = options.overrideAccess ?? true
  const references = new Set(referenceValues)
  const paths: string[] = []

  const resolveCandidatePaths = async (doc: TDoc, meta: ReferencingDocumentMeta): Promise<void> => {
    const shouldInclude = options.shouldInclude
      ? await options.shouldInclude(doc, meta)
      : defaultPublishedDocGuard(doc)
    if (!shouldInclude) {
      return
    }

    const roots = options.getSearchRoots
      ? [
          ...getSearchRootsFromFieldPaths(doc, fieldPaths),
          ...options.getSearchRoots(doc, meta),
        ]
      : getSearchRootsFromFieldPaths(doc, fieldPaths)
    if (!roots.some((root) => hasReferenceMatch(root, references))) {
      return
    }

    const resolvedPaths = options.resolvePaths
      ? await options.resolvePaths(doc, meta)
      : getDefaultReferencingPaths(doc, meta)

    if (options.resolvePaths) {
      const nonAbsolute = resolvedPaths.filter(
        (p) => typeof p === 'string' && p.trim().length > 0 && !p.trim().startsWith('/'),
      )
      if (nonAbsolute.length > 0) {
        logger.warn(
          `[payload-isr] findReferencingPaths: resolvePaths returned non-absolute paths for "${meta.slug}" that will be ignored: ${nonAbsolute.join(', ')}`,
        )
      }
    }

    paths.push(...resolvedPaths)
  }

  const resolveCandidateSafely = async (doc: TDoc, meta: ReferencingDocumentMeta): Promise<void> => {
    try {
      await resolveCandidatePaths(doc, meta)
    } catch (error) {
      logger.warn(
        `[payload-isr] findReferencingPaths: failed to inspect a document in ${meta.scope} "${meta.slug}". Skipping document.`,
        error,
      )
    }
  }

  for (const slug of options.targets.collections ?? []) {
    try {
      const result = await options.payload.find({
        collection: slug,
        depth: queryDepth,
        overrideAccess,
        pagination: false,
        req: options.req,
      })

      for (const doc of result.docs as unknown as TDoc[]) {
        await resolveCandidateSafely(doc, { slug, scope: 'collection' })
      }
    } catch (error) {
      logger.warn(
        `[payload-isr] findReferencingPaths: failed to query collection "${slug}". Skipping.`,
        error,
      )
    }
  }

  for (const slug of options.targets.globals ?? []) {
    try {
      const doc = await options.payload.findGlobal({
        slug,
        depth: queryDepth,
        overrideAccess,
        req: options.req,
      }) as unknown as TDoc

      await resolveCandidateSafely(doc, { slug, scope: 'global' })
    } catch (error) {
      logger.warn(
        `[payload-isr] findReferencingPaths: failed to query global "${slug}". Skipping.`,
        error,
      )
    }
  }

  return normalizePaths(paths)
}
