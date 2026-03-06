import type {
  FindReferencingPathsOptions,
  ISRDocument,
  ReferencingDocumentMeta,
} from './types.js'

import {
  defaultPublishedDocGuard,
  normalizePaths,
} from './utils.js'

const getValueAtPath = (
  value: unknown,
  path: string,
): unknown => {
  if (path.trim().length === 0) {
    return value
  }

  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean)
  let current: unknown = value

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

const hasReferenceMatch = (
  value: unknown,
  references: ReadonlySet<string>,
): boolean => {
  if (typeof value === 'string' || typeof value === 'number') {
    return references.has(String(value))
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasReferenceMatch(item, references))
  }

  if (typeof value !== 'object' || value === null) {
    return false
  }

  return Object.values(value).some((item) => hasReferenceMatch(item, references))
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
  fieldPaths: ReadonlyArray<string>,
): unknown[] => {
  return fieldPaths
    .map((fieldPath) => getValueAtPath(doc, fieldPath))
    .filter((value) => typeof value !== 'undefined')
}

export const findReferencingPaths = async <TDoc extends ISRDocument = ISRDocument>(
  options: FindReferencingPathsOptions<TDoc>,
): Promise<string[]> => {
  const referenceValues = normalizeReferenceValues(options.referencedValues)
  if (referenceValues.length === 0) {
    return []
  }

  const fieldPaths = options.fieldPaths?.filter((fieldPath) => fieldPath.trim().length > 0) ?? []
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
        (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/'),
      )
      if (nonAbsolute.length > 0) {
        logger.warn(
          `[payload-isr] findReferencingPaths: resolvePaths returned non-absolute paths for "${meta.slug}" that will be ignored: ${nonAbsolute.join(', ')}`,
        )
      }
    }

    paths.push(...resolvedPaths)
  }

  for (const slug of options.targets.collections ?? []) {
    try {
      const result = await options.payload.find({
        collection: slug,
        depth: queryDepth,
        overrideAccess,
        pagination: false,
      })

      for (const doc of result.docs as unknown as TDoc[]) {
        await resolveCandidatePaths(doc, { slug, scope: 'collection' })
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
      }) as unknown as TDoc

      await resolveCandidatePaths(doc, { slug, scope: 'global' })
    } catch (error) {
      logger.warn(
        `[payload-isr] findReferencingPaths: failed to query global "${slug}". Skipping.`,
        error,
      )
    }
  }

  return normalizePaths(paths)
}
