import type { CollectionAfterOperationArgs } from './types.js'

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const normalizePaths = (paths: string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const candidate of paths) {
    if (typeof candidate !== 'string') {
      continue
    }

    const path = candidate.trim()
    if (path.length === 0 || !path.startsWith('/')) {
      continue
    }
    if (seen.has(path)) {
      continue
    }

    seen.add(path)
    result.push(path)
  }

  return result
}

export const normalizeTags = (tags: string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const candidate of tags) {
    if (typeof candidate !== 'string') {
      continue
    }

    const tag = candidate.trim()
    if (tag.length === 0) {
      continue
    }
    if (seen.has(tag)) {
      continue
    }

    seen.add(tag)
    result.push(tag)
  }

  return result
}

export const defaultPublishedDocGuard = (doc: unknown): boolean => {
  if (!isPlainObject(doc)) {
    return true
  }
  if (!('_status' in doc)) {
    return true
  }

  return doc._status === 'published'
}

export const defaultUnpublishMatcher = (args: CollectionAfterOperationArgs): boolean => {
  if (args.operation !== 'updateByID') {
    return false
  }

  const data = (args.args as { data?: unknown }).data
  if (!isPlainObject(data)) {
    return false
  }

  const keys = Object.keys(data)
  return keys.length === 1 && data._status === 'draft'
}
