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
  }) as unknown as Config

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
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchSpy

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

describe('collection document operations', () => {
  test('handles each successful bulk update document and preserves the Payload result', async () => {
    const revalidatePath = vi.fn()
    const revalidateTag = vi.fn()
    const pathResolver = vi.fn(({ result }) => [`/posts/${result.slug}`])
    const config = payloadIsr({
      collections: [{
        slug: 'posts',
        pathResolver,
        tagResolver: ({ result }) => [`post:${result.id}`],
      }],
      logger: createLoggerRecorder().logger,
      revalidatePath,
      revalidateTag,
    })(createBaseConfig())
    const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]
    const result = {
      docs: [
        { id: '1', slug: 'published-post', _status: 'published' },
        { id: '2', slug: 'draft-post', _status: 'draft' },
        { id: '3', slug: 'unversioned-post' },
      ],
      errors: [{ id: '4', message: 'Update failed' }],
    }

    const returned = await afterOperation?.({
      args: { data: { title: 'Updated title' } },
      operation: 'update',
      result,
    } as never)

    expect(returned).toBe(result)
    expect(pathResolver.mock.calls.map(([args]) => args.result)).toEqual([
      result.docs[0],
      result.docs[2],
    ])
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/posts/published-post',
      '/posts/unversioned-post',
    ])
    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual(['post:1', 'post:3'])
  })

  test('does not run guards or resolvers for a bulk update without successful documents', async () => {
    const shouldHandle = vi.fn(() => true)
    const pathResolver = vi.fn(() => ['/posts'])
    const config = payloadIsr({
      collections: [{ slug: 'posts', pathResolver, shouldHandle }],
      logger: createLoggerRecorder().logger,
      revalidatePath: vi.fn(),
    })(createBaseConfig())
    const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]
    const result = { docs: [], errors: [{ id: '1', message: 'Update failed' }] }

    expect(await afterOperation?.({
      args: { data: {} },
      operation: 'update',
      result,
    } as never)).toBe(result)
    expect(shouldHandle).not.toHaveBeenCalled()
    expect(pathResolver).not.toHaveBeenCalled()
  })

  test('passes individual bulk documents and original request data to custom guards', async () => {
    const handledDocuments: unknown[] = []
    const requestArgs = { data: { title: 'Updated title' } }
    const req = { context: { source: 'bulk-editor' } }
    const revalidatePath = vi.fn()
    const config = payloadIsr({
      collections: [{
        slug: 'posts',
        pathResolver: ({ result }) => [`/posts/${result.slug}`],
        shouldHandle: (args) => {
          expect(args.args).toBe(requestArgs)
          expect(args.req).toBe(req)
          expect(args.operation).toBe('update')
          handledDocuments.push(args.result)
          return args.result.id === '2'
        },
      }],
      logger: createLoggerRecorder().logger,
      revalidatePath,
    })(createBaseConfig())
    const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]
    const docs = [{ id: '1', slug: 'first' }, { id: '2', slug: 'second' }]

    await afterOperation?.({
      args: requestArgs,
      operation: 'update',
      req,
      result: { docs, errors: [] },
    } as never)

    expect(handledDocuments).toEqual(docs)
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(['/posts/second'])
  })

  test('revalidates each document when a bulk update unpublishes content', async () => {
    const revalidatePath = vi.fn()
    const shouldHandle = vi.fn(() => false)
    const config = payloadIsr({
      collections: [{
        slug: 'posts',
        pathResolver: ({ result }) => [`/posts/${result.slug}`],
        shouldHandle,
      }],
      logger: createLoggerRecorder().logger,
      revalidatePath,
    })(createBaseConfig())
    const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]

    await afterOperation?.({
      args: { data: { _status: 'draft' } },
      operation: 'update',
      result: {
        docs: [
          { id: '1', slug: 'first', _status: 'draft' },
          { id: '2', slug: 'second', _status: 'draft' },
        ],
        errors: [],
      },
    } as never)

    expect(shouldHandle).not.toHaveBeenCalled()
    expect(revalidatePath.mock.calls).toEqual([
      ['/posts/first', { slug: 'posts', mode: 'path', reason: 'collection-unpublish', scope: 'collection' }],
      ['/posts/second', { slug: 'posts', mode: 'path', reason: 'collection-unpublish', scope: 'collection' }],
    ])
  })
})

describe('plugin instance diagnostics', () => {
  test.each(['path', 'tag'])('deduplicates missing %s callbacks independently per plugin instance', async (kind) => {
    for (let instance = 0; instance < 2; instance += 1) {
      const { lines, logger } = createLoggerRecorder()
      const config = payloadIsr({
        collections: [{
          slug: 'posts',
          pathResolver: () => ['/posts'],
          tagResolver: () => ['posts'],
        }],
        debug: true,
        logger,
        ...(kind === 'path' ? { revalidateTag: vi.fn() } : { revalidatePath: vi.fn() }),
      })(createBaseConfig())
      const afterOperation = config.collections?.[0]?.hooks?.afterOperation?.[0]

      for (let operation = 0; operation < 2; operation += 1) {
        await afterOperation?.({
          args: {},
          operation: 'create',
          result: { id: '1', slug: 'first' },
        } as never)
      }

      const prefix = kind === 'path' ? 'Paths' : 'Tags'
      expect(lines.warn.filter((line) => line.includes(`${prefix} were resolved for "posts"`))).toHaveLength(1)
      expect(lines.info.filter((line) => line.includes('config.runtime.initialized'))).toHaveLength(1)
    }
  })
})

describe('full rebuild probes', () => {
  test.each([false, undefined])('skips collection and global probe resolvers when rebuild is %s', async (enabled) => {
    const probeURL = vi.fn(() => { throw new Error('Probe resolver should not run') })
    const revalidatePath = vi.fn()
    const config = payloadIsr({
      collections: [{ slug: 'posts', pathResolver: () => ['/posts'], probeURL }],
      fullRebuild: enabled === undefined ? undefined : { enabled, trigger: vi.fn() },
      globals: [{ slug: 'site-settings', probeURL, revalidateAllOnChange: true }],
      logger: createLoggerRecorder().logger,
      revalidatePath,
    })(createBaseConfig())

    await config.collections?.[0]?.hooks?.afterOperation?.[0]?.({
      args: {},
      operation: 'create',
      result: { id: '1' },
    } as never)
    await config.globals?.[0]?.hooks?.afterChange?.[0]?.({ doc: { id: '1' } } as never)

    expect(probeURL).not.toHaveBeenCalled()
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(['/posts', '/'])
  })

  test('aborts a stalled probe, revalidates content, and clears its timer', async () => {
    vi.useFakeTimers()
    const originalFetch = globalThis.fetch
    const revalidatePath = vi.fn()
    const trigger = vi.fn()
    const { lines, logger } = createLoggerRecorder()
    let probeSignal: AbortSignal | null | undefined
    globalThis.fetch = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      probeSignal = init?.signal
      probeSignal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
    })) as typeof fetch

    try {
      const config = payloadIsr({
        collections: [{
          slug: 'posts',
          pathResolver: () => ['/posts'],
          probeURL: () => 'https://example.com/posts',
        }],
        fullRebuild: { probeTimeoutMs: 25, trigger },
        logger,
        revalidatePath,
      })(createBaseConfig())
      const operation = config.collections?.[0]?.hooks?.afterOperation?.[0]?.({
        args: {},
        operation: 'create',
        result: { id: '1' },
      } as never)

      await vi.advanceTimersByTimeAsync(24)
      expect(revalidatePath).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await operation

      expect(probeSignal?.aborted).toBe(true)
      expect(trigger).not.toHaveBeenCalled()
      expect(revalidatePath).toHaveBeenCalledTimes(1)
      expect(lines.warn.some((line) => line.includes('Failed to probe URL'))).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
      vi.useRealTimers()
    }
  })

  test('cancels unused response bodies and clears the probe timer after success', async () => {
    vi.useFakeTimers()
    const originalFetch = globalThis.fetch
    const cancel = vi.fn()
    const trigger = vi.fn()
    const revalidatePath = vi.fn()
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(new ReadableStream({ cancel }), { status: 404 })))

    try {
      const config = payloadIsr({
        fullRebuild: { trigger },
        globals: [{
          slug: 'site-settings',
          probeURL: () => 'https://example.com/',
          revalidateAllOnChange: true,
        }],
        logger: createLoggerRecorder().logger,
        revalidatePath,
      })(createBaseConfig())

      await config.globals?.[0]?.hooks?.afterChange?.[0]?.({ doc: { id: '1' } } as never)

      expect(cancel).toHaveBeenCalledTimes(1)
      expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ probeStatus: 404 }))
      expect(revalidatePath).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
      vi.useRealTimers()
    }
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])('uses the default probe timeout for invalid value %s', async (probeTimeoutMs) => {
    vi.useFakeTimers()
    const originalFetch = globalThis.fetch
    const revalidatePath = vi.fn()
    const { lines, logger } = createLoggerRecorder()
    globalThis.fetch = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
    })) as typeof fetch

    try {
      const config = payloadIsr({
        collections: [{
          slug: 'posts',
          pathResolver: () => ['/posts'],
          probeURL: () => 'https://example.com/posts',
        }],
        fullRebuild: { probeTimeoutMs, trigger: vi.fn() },
        logger,
        revalidatePath,
      })(createBaseConfig())
      const operation = config.collections?.[0]?.hooks?.afterOperation?.[0]?.({
        args: {},
        operation: 'create',
        result: { id: '1' },
      } as never)

      await vi.advanceTimersByTimeAsync(9_999)
      expect(revalidatePath).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await operation

      expect(revalidatePath).toHaveBeenCalledTimes(1)
      expect(lines.warn.some((line) => line.includes('probeTimeoutMs must be'))).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
      vi.useRealTimers()
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
