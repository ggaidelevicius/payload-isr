import type { Payload } from 'payload'

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
  const findMock = vi.fn(async ({ collection }: { collection: string }) => {
    return args.collections?.[collection] ?? { docs: [] }
  })
  const findGlobalMock = vi.fn(async ({ slug }: { slug: string }) => {
    return args.globals?.[slug] ?? {}
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
        pages: {
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
        homepage: {
          layout: [{ value: 'ref-1' }],
        },
      },
    })

    const paths = await findReferencingPaths({
      fieldPaths: ['layout'],
      payload,
      referencedValues: 'ref-1',
      targets: {
        collections: ['pages'],
        globals: ['homepage'],
      },
    })

    expect(paths).toEqual(['/about', '/'])
    expect(findMock).toHaveBeenCalledWith({
      collection: 'pages',
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    expect(findGlobalMock).toHaveBeenCalledWith({
      slug: 'homepage',
      depth: 0,
      overrideAccess: true,
    })
  })

  test('supports custom field paths and custom path resolution', async () => {
    const { payload } = createPayloadStub({
      collections: {
        news: {
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
        return typeof doc.slug === 'string' ? [`/news/${doc.slug}`] : []
      },
      targets: {
        collections: ['news'],
      },
    })

    expect(paths).toEqual(['/news/launch-post'])
  })

  test('supports custom search roots for non-layout content', async () => {
    const { payload } = createPayloadStub({
      collections: {
        pages: {
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
        collections: ['pages'],
      },
    })

    expect(paths).toEqual(['/custom-page'])
  })

  test('allows overriding query depth and access behavior', async () => {
    const { findGlobalMock, findMock, payload } = createPayloadStub({
      collections: {
        pages: {
          docs: [],
        },
      },
      globals: {
        homepage: {
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
        collections: ['pages'],
        globals: ['homepage'],
      },
    })

    expect(findMock).toHaveBeenCalledWith({
      collection: 'pages',
      depth: 2,
      overrideAccess: false,
      pagination: false,
    })
    expect(findGlobalMock).toHaveBeenCalledWith({
      slug: 'homepage',
      depth: 2,
      overrideAccess: false,
    })
  })

  test('throws when neither fieldPaths nor getSearchRoots is provided', async () => {
    const { payload } = createPayloadStub({
      collections: {
        pages: {
          docs: [],
        },
      },
    })

    await expect(
      findReferencingPaths({
        payload,
        referencedValues: 'alpha',
        targets: {
          collections: ['pages'],
        },
      } as never),
    ).rejects.toThrow('findReferencingPaths requires either fieldPaths or getSearchRoots')
  })
})
