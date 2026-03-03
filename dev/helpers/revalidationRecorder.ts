import type {
  RevalidationMode,
  RevalidationReason,
  RevalidateTagFn,
} from '../../src/index.js'

type PathRevalidationEvent = {
  meta: {
    mode: RevalidationMode
    reason: RevalidationReason
    scope: 'collection' | 'global'
    slug: string
  }
  path: string
}

type TagRevalidationEvent = {
  meta: {
    reason: RevalidationReason
    scope: 'collection' | 'global'
    slug: string
  }
  tag: string
}

const pathEvents: PathRevalidationEvent[] = []
const tagEvents: TagRevalidationEvent[] = []

export const recordRevalidation = (
  path: string,
  meta: PathRevalidationEvent['meta'],
): void => {
  pathEvents.push({ meta, path })
}

export const recordTagRevalidation: RevalidateTagFn = (
  tag,
  meta,
): void => {
  tagEvents.push({ meta, tag })
}

export const getPathRevalidationEvents = (): PathRevalidationEvent[] => {
  return [...pathEvents]
}

export const getTagRevalidationEvents = (): TagRevalidationEvent[] => {
  return [...tagEvents]
}

export const clearRevalidationEvents = (): void => {
  pathEvents.length = 0
  tagEvents.length = 0
}
