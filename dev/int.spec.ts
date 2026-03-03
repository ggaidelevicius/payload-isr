import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  clearRevalidationEvents,
  getPathRevalidationEvents,
  getTagRevalidationEvents,
} from './helpers/revalidationRecorder.js'

let payload: Payload

beforeAll(async () => {
  payload = await getPayload({ config })
})

beforeEach(() => {
  clearRevalidationEvents()
})

describe('Plugin integration tests', () => {
  test('revalidates publish paths and tags for collection updates', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        title: 'First post',
        slug: 'first-post',
        isPublished: true,
      },
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()

    expect(pathEvents.map((event) => event.path)).toEqual([
      '/posts/first-post',
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

  test('revalidates collection paths and tags when unpublishing', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        title: 'Second post',
        slug: 'second-post',
        isPublished: true,
      },
    })

    clearRevalidationEvents()

    await payload.update({
      collection: 'posts',
      data: {
        isPublished: false,
      },
      id: post.id,
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()

    expect(pathEvents.map((event) => event.path)).toEqual(['/posts/second-post', '/posts'])
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
        title: 'Third post',
        slug: 'third-post',
        isPublished: true,
      },
    })

    clearRevalidationEvents()

    await payload.delete({
      collection: 'posts',
      id: post.id,
    })

    const pathEvents = getPathRevalidationEvents()
    const tagEvents = getTagRevalidationEvents()

    expect(pathEvents.map((event) => event.path)).toEqual([
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
