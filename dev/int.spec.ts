import type { Payload } from 'payload'

import { getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  clearRevalidationEvents,
  getFullRebuildEvents,
  getIsrTraceEvents,
  getPathRevalidationEvents,
  getTagRevalidationEvents,
} from './helpers/revalidationRecorder.js'

let payload: Payload
const originalFetch = globalThis.fetch

beforeAll(async () => {
  process.env.PAYLOAD_ISR_FULL_REBUILD = '1'
  const { default: config } = await import('@payload-config')
  payload = await getPayload({ config })
})

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch
  clearRevalidationEvents()
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('Plugin integration tests', () => {
  test('revalidates publish paths and tags for collection updates', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        slug: 'first-post',
        isPublished: true,
        title: 'First post',
      },
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()

    expect(pathEvents.map((event) => event.path)).toEqual([
      '/posts/first-post',
      `/posts/${post.id}`,
      '/posts',
    ])
    expect(pathEvents.every((event) => event.meta.reason === 'collection-update')).toBe(
      true,
    )
    expect(pathEvents.every((event) => event.meta.mode === 'path')).toBe(true)

    expect(tagEvents.map((event) => event.tag)).toEqual([
      'posts',
      `post:${post.id}`,
    ])
    expect(tagEvents.every((event) => event.meta.reason === 'collection-update')).toBe(
      true,
    )
  })

  test('records short-circuit trace when shouldHandle returns false', async () => {
    await payload.create({
      collection: 'posts',
      data: {
        slug: 'draft-like-post',
        isPublished: false,
        title: 'Draft-like post',
      },
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()
    const traceEvents = getIsrTraceEvents()

    expect(pathEvents).toHaveLength(0)
    expect(tagEvents).toHaveLength(0)
    expect(
      traceEvents.some(
        (event) =>
          event.event === 'collection.afterOperation.skip.shouldHandleFalse' &&
          event.details.slug === 'posts',
      ),
    ).toBe(true)
  })

  test('revalidates collection paths and tags when unpublishing', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        slug: 'second-post',
        isPublished: true,
        title: 'Second post',
      },
    })

    clearRevalidationEvents()

    await payload.update({
      id: post.id,
      collection: 'posts',
      data: {
        isPublished: false,
      },
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()

    expect(pathEvents.map((event) => event.path)).toEqual([
      '/posts/second-post',
      `/posts/${post.id}`,
      '/posts',
    ])
    expect(pathEvents.every((event) => event.meta.reason === 'collection-unpublish')).toBe(
      true,
    )
    expect(pathEvents.every((event) => event.meta.mode === 'path')).toBe(true)

    expect(tagEvents.map((event) => event.tag)).toEqual([
      'posts',
      `post:${post.id}`,
    ])
    expect(tagEvents.every((event) => event.meta.reason === 'collection-unpublish')).toBe(
      true,
    )
  })

  test('revalidates delete paths and tags for collection deletes', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        slug: 'third-post',
        isPublished: true,
        title: 'Third post',
      },
    })

    clearRevalidationEvents()

    await payload.delete({
      id: post.id,
      collection: 'posts',
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()

    expect(pathEvents.map((event) => event.path)).toEqual([
      '/posts/third-post',
      `/posts/${post.id}`,
      '/posts',
    ])
    expect(pathEvents.every((event) => event.meta.reason === 'collection-delete')).toBe(
      true,
    )
    expect(pathEvents.every((event) => event.meta.mode === 'path')).toBe(true)

    expect(tagEvents.map((event) => event.tag)).toEqual([
      'posts',
      `post:${post.id}`,
    ])
    expect(tagEvents.every((event) => event.meta.reason === 'collection-delete')).toBe(
      true,
    )
  })

  test('revalidates current friendly and id paths when slug changes', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        slug: 'renamable-post',
        isPublished: true,
        title: 'Renamable post',
      },
    })

    clearRevalidationEvents()

    await payload.update({
      id: post.id,
      collection: 'posts',
      data: {
        slug: 'renamed-post',
      },
    })

    const pathEvents = getPathRevalidationEvents()
    expect(pathEvents.map((event) => event.path)).toEqual([
      '/posts/renamed-post',
      `/posts/${post.id}`,
      '/posts',
    ])
    expect(pathEvents.every((event) => event.meta.reason === 'collection-update')).toBe(
      true,
    )
  })

  test('triggers full rebuild fallback when probe returns 404 on publish', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch

    const post = await payload.create({
      collection: 'posts',
      data: {
        slug: 'missing-route-post',
        isPublished: true,
        title: 'Missing route post',
      },
    })

    const fullRebuildEvents = getFullRebuildEvents()
    expect(fullRebuildEvents).toHaveLength(1)
    expect(fullRebuildEvents[0]?.context.probeStatus).toBe(404)
    expect(fullRebuildEvents[0]?.context.reason).toBe('collection-update')
    expect(fullRebuildEvents[0]?.context.scope).toBe('collection')
    expect(fullRebuildEvents[0]?.context.slug).toBe('posts')
    expect(fullRebuildEvents[0]?.context.probeURL).toBe(
      `http://127.0.0.1:3000/posts/${post.slug}`,
    )
  })

  test('revalidates entire site and global tags for global settings change', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: {
        homepageTitle: 'Home',
        isPublished: true,
      },
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()

    expect(pathEvents.map((event) => event.path)).toEqual(['/'])
    expect(pathEvents.every((event) => event.meta.reason === 'global-update')).toBe(
      true,
    )
    expect(pathEvents.every((event) => event.meta.mode === 'site')).toBe(true)

    expect(tagEvents.map((event) => event.tag)).toEqual(['site-settings', 'global'])
    expect(tagEvents.every((event) => event.meta.reason === 'global-update')).toBe(
      true,
    )
  })
})
