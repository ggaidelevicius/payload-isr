import type { Config } from 'payload'

import { payloadIsr, type LoggerLike } from '../src/index.js'
import { defaultUnpublishMatcher } from '../src/utils.js'
import { describe, expect, test, vi } from 'vitest'

const createBaseConfig = (): Config =>
  ({
    collections: [
      {
        fields: [],
        slug: 'posts',
      },
    ],
    globals: [
      {
        fields: [],
        slug: 'site-settings',
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
          pathResolver: () => ['/posts'],
          slug: 'posts',
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
          disabled: true,
          pathResolver: () => ['/posts'],
          slug: 'posts',
        },
      ],
      globals: [
        {
          disabled: true,
          revalidateAllOnChange: true,
          slug: 'site-settings',
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
          pathResolver: () => ['/posts'],
          slug: 'posts',
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
            pathResolver: () => ['/posts/first-post'],
            probeURL: () => '/posts/first-post',
            slug: 'posts',
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
        mode: 'path',
        reason: 'collection-update',
        scope: 'collection',
        slug: 'posts',
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
