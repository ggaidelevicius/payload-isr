import type { Config } from 'payload'

import { describe, expect, test, vi } from 'vitest'

import { type LoggerLike, payloadIsr } from '../src/index.js'
import { defaultUnpublishMatcher } from '../src/utils.js'

const createBaseConfig = (): Config =>
  ({
    collections: [
      {
        slug: 'posts',
        fields: [],
      },
    ],
    globals: [
      {
        slug: 'site-settings',
        fields: [],
      },
    ],
  }) as Config

const createLoggerRecorder = (): {
  lines: {
    error: string[]
    info: string[]
    warn: string[]
  }
  logger: LoggerLike
} => {
  const lines = {
    error: [] as string[],
    info: [] as string[],
    warn: [] as string[],
  }

  const toLine = (args: unknown[]): string =>
    args
      .map((arg) => {
        if (typeof arg === 'string') {
          return arg
        }
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
      .join(' ')

  return {
    lines,
    logger: {
      error: (...args: unknown[]) => {
        lines.error.push(toLine(args))
      },
      info: (...args: unknown[]) => {
        lines.info.push(toLine(args))
      },
      warn: (...args: unknown[]) => {
        lines.warn.push(toLine(args))
      },
    },
  }
}

describe('payloadIsr runtime safeguards', () => {
  test('warns when a collection has update resolvers but no onDelete strategy', () => {
    const { lines, logger } = createLoggerRecorder()

    const plugin = payloadIsr({
      collections: [
        {
          slug: 'posts',
          pathResolver: () => ['/posts'],
        },
      ],
      logger,
      revalidatePath: () => undefined,
    })

    plugin(createBaseConfig())

    expect(
      lines.warn.some((line) =>
        line.includes('missing delete revalidation strategy (onDelete): posts'),
      ),
    ).toBe(true)
  })

  test('does not register hooks for disabled collection/global targets', () => {
    const plugin = payloadIsr({
      collections: [
        {
          slug: 'posts',
          disabled: true,
          pathResolver: () => ['/posts'],
        },
      ],
      globals: [
        {
          slug: 'site-settings',
          disabled: true,
          revalidateAllOnChange: true,
        },
      ],
      revalidatePath: () => undefined,
    })

    const config = plugin(createBaseConfig())
    const postsCollection = config.collections?.find((collection) => collection.slug === 'posts')
    const settingsGlobal = config.globals?.find((global) => global.slug === 'site-settings')

    expect(postsCollection?.hooks?.afterOperation ?? []).toHaveLength(0)
    expect(settingsGlobal?.hooks?.afterChange ?? []).toHaveLength(0)
  })

  test('warns once per target/reason when tags resolve without revalidateTag callback', async () => {
    const { lines, logger } = createLoggerRecorder()

    const plugin = payloadIsr({
      collections: [
        {
          slug: 'posts',
          pathResolver: () => ['/posts'],
          tagResolver: () => ['posts'],
        },
      ],
      logger,
      revalidatePath: () => undefined,
    })

    const config = plugin(createBaseConfig())
    const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]
    expect(afterOperation).toBeDefined()

    await afterOperation?.({
      args: {},
      operation: 'create',
      result: {
        id: '1',
        slug: 'first-post',
      },
    } as never)

    await afterOperation?.({
      args: {},
      operation: 'create',
      result: {
        id: '2',
        slug: 'second-post',
      },
    } as never)

    const runtimeWarnings = lines.warn.filter((line) =>
      line.includes('Tags were resolved for "posts"'),
    )
    expect(runtimeWarnings).toHaveLength(1)
  })

  test('supports tag-only configuration without revalidatePath', async () => {
    const revalidateTag = vi.fn()

    const plugin = payloadIsr({
      collections: [
        {
          slug: 'posts',
          tagResolver: () => ['posts'],
        },
      ],
      revalidateTag,
    })

    const config = plugin(createBaseConfig())
    const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]
    expect(afterOperation).toBeDefined()

    await afterOperation?.({
      args: {},
      operation: 'create',
      result: {
        id: '1',
        slug: 'first-post',
      },
    } as never)

    expect(revalidateTag).toHaveBeenCalledWith('posts', {
      slug: 'posts',
      reason: 'collection-update',
      scope: 'collection',
    })
  })

  test('warns once per target/reason when paths resolve without revalidatePath callback', async () => {
    const { lines, logger } = createLoggerRecorder()

    const plugin = payloadIsr({
      collections: [
        {
          slug: 'posts',
          pathResolver: () => ['/posts'],
        },
      ],
      logger,
      revalidateTag: () => undefined,
    })

    const config = plugin(createBaseConfig())
    const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]
    expect(afterOperation).toBeDefined()

    await afterOperation?.({
      args: {},
      operation: 'create',
      result: {
        id: '1',
        slug: 'first-post',
      },
    } as never)

    await afterOperation?.({
      args: {},
      operation: 'create',
      result: {
        id: '2',
        slug: 'second-post',
      },
    } as never)

    const runtimeWarnings = lines.warn.filter((line) =>
      line.includes('Paths were resolved for "posts"'),
    )
    expect(runtimeWarnings).toHaveLength(1)
  })

  test('warns and skips full-rebuild probe when probeURL is not absolute http(s)', async () => {
    const { lines, logger } = createLoggerRecorder()
    const trigger = vi.fn()
    const revalidatePath = vi.fn()
    const originalFetch = globalThis.fetch
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchSpy as typeof fetch

    try {
      const plugin = payloadIsr({
        collections: [
          {
            slug: 'posts',
            pathResolver: () => ['/posts/first-post'],
            probeURL: () => '/posts/first-post',
          },
        ],
        fullRebuild: {
          enabled: true,
          trigger,
        },
        logger,
        revalidatePath,
      })

      const config = plugin(createBaseConfig())
      const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]
      expect(afterOperation).toBeDefined()

      await afterOperation?.({
        args: {},
        operation: 'create',
        result: {
          id: '1',
          slug: 'first-post',
        },
      } as never)

      expect(
        lines.warn.some((line) => line.includes('Expected an absolute http(s) URL')),
      ).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(trigger).not.toHaveBeenCalled()
      expect(revalidatePath).toHaveBeenCalledWith('/posts/first-post', {
        slug: 'posts',
        mode: 'path',
        reason: 'collection-update',
        scope: 'collection',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('defaultUnpublishMatcher', () => {
  test('treats updateByID with _status=draft as unpublish even with extra fields', () => {
    expect(
      defaultUnpublishMatcher({
        args: {
          data: {
            _status: 'draft',
            title: 'Updated title',
          },
        },
        operation: 'updateByID',
        result: {
          id: '1',
        },
      } as never),
    ).toBe(true)
  })

  test('returns false for updateByID when _status is not draft', () => {
    expect(
      defaultUnpublishMatcher({
        args: {
          data: {
            _status: 'published',
          },
        },
        operation: 'updateByID',
        result: {
          id: '1',
        },
      } as never),
    ).toBe(false)
  })
})
