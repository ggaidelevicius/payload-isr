import type { Payload, PayloadRequest } from 'payload'

import { describe, expect, test, vi } from 'vitest'

import { findReferencingPaths } from '../src/index.js'

const createPayloadStub = (args: {
  collections?: Record<string, { docs: unknown[] }>
  globals?: Record<string, unknown>
}): {
  findGlobalMock: ReturnType<typeof vi.fn>
  findMock: ReturnType<typeof vi.fn>
  payload: Payload
} => {
  const findMock = vi.fn(({ collection }: {
    collection: string
    req?: Partial<PayloadRequest>
  }) => {
    return Promise.resolve(args.collections?.[collection] ?? { docs: [] })
  })
  const findGlobalMock = vi.fn(({ slug }: {
    req?: Partial<PayloadRequest>
    slug: string
  }) => {
    return Promise.resolve(args.globals?.[slug] ?? {})
  })

  return {
    findGlobalMock,
    findMock,
    payload: {
      find: findMock,
      findGlobal: findGlobalMock,
    } as unknown as Payload,
  }
}

describe('findReferencingPaths', () => {
  test('finds published referencing documents across collections and globals', async () => {
    const { findGlobalMock, findMock, payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [
            {
              _status: 'published',
              breadcrumbs: [{ url: '/about' }],
              layout: [
                {
                  relationship: {
                    value: 'ref-1',
                  },
                },
              ],
            },
            {
              slug: 'draft-page',
              _status: 'draft',
              layout: [{ value: 'ref-1' }],
            },
            {
              slug: 'other-page',
              _status: 'published',
              layout: [{ value: 'other-id' }],
            },
          ],
        },
      },
      globals: {
        'site-settings': {
          layout: [{ value: 'ref-1' }],
        },
      },
    })

    const paths = await findReferencingPaths({
      fieldPaths: ['layout'],
      payload,
      referencedValues: 'ref-1',
      targets: {
        collections: ['posts'],
        globals: ['site-settings'],
      },
    })

    expect(paths).toEqual(['/about', '/'])
    expect(findMock).toHaveBeenCalledWith({
      collection: 'posts',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req: undefined,
    })
    expect(findGlobalMock).toHaveBeenCalledWith({
      slug: 'site-settings',
      depth: 0,
      overrideAccess: true,
      req: undefined,
    })
  })

  test('supports custom field paths and custom path resolution', async () => {
    const { payload } = createPayloadStub({
      collections: {
        media: {
          docs: [
            {
              slug: 'launch-post',
              hero: {
                blocks: [{ relationTo: 'posts', value: 42 }],
              },
            },
          ],
        },
      },
    })

    const paths = await findReferencingPaths({
      fieldPaths: ['hero.blocks'],
      payload,
      referencedValues: '42',
      resolvePaths: (doc) => {
        return typeof doc.slug === 'string' ? [`/media/${doc.slug}`] : []
      },
      targets: {
        collections: ['media'],
      },
    })

    expect(paths).toEqual(['/media/launch-post'])
  })

  test('follows dotted paths through nested arrays without matching unrelated fields', async () => {
    const { payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [
            {
              slug: 'matching',
              layout: [
                { sections: [{ relatedPost: { value: { id: 'ref-1' } } }] },
              ],
            },
            {
              slug: 'unrelated',
              layout: [
                { sections: [{ caption: 'ref-1', relatedPost: 'other-id' }] },
              ],
            },
          ],
        },
      },
    })

    expect(await findReferencingPaths({
      fieldPaths: [' layout . sections . relatedPost '],
      payload,
      referencedValues: 'ref-1',
      targets: { collections: ['posts'] },
    })).toEqual(['/matching'])
  })

  test('preserves explicit numeric indexes in dotted field paths', async () => {
    const { payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [
            {
              slug: 'matching',
              layout: [{ post: 'ref-1' }, { post: 'other-id' }],
            },
            {
              slug: 'different-index',
              layout: [{ post: 'other-id' }, { post: 'ref-1' }],
            },
          ],
        },
      },
    })

    expect(await findReferencingPaths({
      fieldPaths: ['layout.0.post'],
      payload,
      referencedValues: 'ref-1',
      targets: { collections: ['posts'] },
    })).toEqual(['/matching'])
  })

  test('does not search nested arrays when an explicit outer index is missing', async () => {
    const { payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [{
            slug: 'missing-index',
            layout: [[{ post: 'other-id' }, { post: 'ref-1' }]],
          }],
        },
      },
    })

    expect(await findReferencingPaths({
      fieldPaths: ['layout.1.post'],
      payload,
      referencedValues: 'ref-1',
      targets: { collections: ['posts'] },
    })).toEqual([])
  })

  test('handles cyclic and deeply nested search roots without skipping later documents', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deeplyNested: unknown = 'ref-1'
    for (let i = 0; i < 10_000; i++) {
      deeplyNested = { child: deeplyNested }
    }
    const { payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [
            { slug: 'cyclic', layout: cyclic },
            { slug: 'deep', layout: deeplyNested },
          ],
        },
      },
    })
    const logger = { error: vi.fn(), warn: vi.fn() }

    expect(await findReferencingPaths({
      fieldPaths: ['layout'],
      logger,
      payload,
      referencedValues: 'ref-1',
      targets: { collections: ['posts'] },
    })).toEqual(['/deep'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test.each(['getSearchRoots', 'resolvePaths', 'shouldInclude'] as const)(
    'continues scanning when %s fails for an individual document',
    async (callback) => {
      const { payload } = createPayloadStub({
        collections: {
          posts: {
            docs: [
              { slug: 'broken', layout: 'ref-1' },
              { slug: 'working', layout: 'ref-1' },
            ],
          },
        },
      })
      const error = new Error('Bad candidate')
      const logger = { error: vi.fn(), warn: vi.fn() }
      const rejectBroken = (slug: unknown): void => {
        if (slug === 'broken') {
          throw error
        }
      }

      expect(await findReferencingPaths({
        fieldPaths: ['layout'],
        getSearchRoots: callback === 'getSearchRoots'
          ? (doc) => {
              rejectBroken(doc.slug)
              return [doc.layout]
            }
          : undefined,
        logger,
        payload,
        referencedValues: 'ref-1',
        resolvePaths: callback === 'resolvePaths'
          ? (doc) => {
              rejectBroken(doc.slug)
              return [`/${doc.slug}`]
            }
          : undefined,
        shouldInclude: callback === 'shouldInclude'
          ? (doc) => {
              rejectBroken(doc.slug)
              return true
            }
          : undefined,
        targets: { collections: ['posts'] },
      })).toEqual(['/working'])
      expect(logger.warn).toHaveBeenCalledOnce()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed to inspect a document in collection "posts"'),
        error,
      )
    },
  )

  test('continues to other targets after a query fails', async () => {
    const { findMock, payload } = createPayloadStub({
      collections: { media: { docs: [{ slug: 'media', layout: 'ref-1' }] } },
      globals: { 'site-settings': { layout: 'ref-1' } },
    })
    const error = new Error('Query failed')
    findMock.mockRejectedValueOnce(error)
    const logger = { error: vi.fn(), warn: vi.fn() }

    expect(await findReferencingPaths({
      fieldPaths: ['layout'],
      logger,
      payload,
      referencedValues: 'ref-1',
      targets: { collections: ['posts', 'media'], globals: ['site-settings'] },
    })).toEqual(['/media', '/'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to query collection "posts"'),
      error,
    )
  })

  test('normalizes resolver paths before identifying invalid paths', async () => {
    const { payload } = createPayloadStub({
      collections: { posts: { docs: [{ layout: 'ref-1' }] } },
    })
    const logger = { error: vi.fn(), warn: vi.fn() }

    expect(await findReferencingPaths({
      fieldPaths: ['layout'],
      logger,
      payload,
      referencedValues: 'ref-1',
      resolvePaths: () => [' /about ', '/about', 'about'],
      targets: { collections: ['posts'] },
    })).toEqual(['/about'])
    expect(logger.warn).toHaveBeenCalledWith(
      '[payload-isr] findReferencingPaths: resolvePaths returned non-absolute paths for "posts" that will be ignored: about',
    )
  })

  test('supports custom search roots for non-layout content', async () => {
    const { payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [
            {
              slug: 'custom-page',
              sections: {
                nested: [{ id: 'alpha' }],
              },
            },
          ],
        },
      },
    })

    const paths = await findReferencingPaths({
      getSearchRoots: (doc) => [doc.sections],
      payload,
      referencedValues: 'alpha',
      targets: {
        collections: ['posts'],
      },
    })

    expect(paths).toEqual(['/custom-page'])
  })

  test('allows overriding query depth and access behavior', async () => {
    const { findGlobalMock, findMock, payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [],
        },
      },
      globals: {
        'site-settings': {
          layout: [],
        },
      },
    })

    await findReferencingPaths({
      fieldPaths: ['layout'],
      overrideAccess: false,
      payload,
      queryDepth: 2,
      referencedValues: 'alpha',
      targets: {
        collections: ['posts'],
        globals: ['site-settings'],
      },
    })

    expect(findMock).toHaveBeenCalledWith({
      collection: 'posts',
      depth: 2,
      overrideAccess: false,
      pagination: false,
      req: undefined,
    })
    expect(findGlobalMock).toHaveBeenCalledWith({
      slug: 'site-settings',
      depth: 2,
      overrideAccess: false,
      req: undefined,
    })
  })

  test('forwards the originating request to collection and global queries', async () => {
    const { findGlobalMock, findMock, payload } = createPayloadStub({})
    const req: Partial<PayloadRequest> = {
      context: { source: 'content-hook' },
      locale: 'all',
      transactionID: 'transaction-1',
    }

    await findReferencingPaths({
      fieldPaths: ['layout'],
      overrideAccess: false,
      payload,
      referencedValues: 'ref-1',
      req,
      targets: { collections: ['posts'], globals: ['site-settings'] },
    })

    expect(findMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ req }))
    expect(findGlobalMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ req }))
    expect(findMock.mock.calls[0]?.[0].req).toBe(req)
    expect(findGlobalMock.mock.calls[0]?.[0].req).toBe(req)
  })

  test('throws when neither fieldPaths nor getSearchRoots is provided', async () => {
    const { payload } = createPayloadStub({
      collections: {
        posts: {
          docs: [],
        },
      },
    })

    await expect(
      findReferencingPaths({
        payload,
        referencedValues: 'alpha',
        targets: {
          collections: ['posts'],
        },
      } as never),
    ).rejects.toThrow('findReferencingPaths requires either fieldPaths or getSearchRoots')
  })

  test('rejects field paths without a field name instead of searching the whole document', async () => {
    const { findMock, payload } = createPayloadStub({})

    await expect(findReferencingPaths({
      fieldPaths: [' . . '],
      payload,
      referencedValues: 'ref-1',
      targets: { collections: ['posts'] },
    })).rejects.toThrow('findReferencingPaths requires either fieldPaths or getSearchRoots')
    expect(findMock).not.toHaveBeenCalled()
  })
})
