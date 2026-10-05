import { describe, expect, test } from 'vitest'

import type { CollectionAfterOperationArgs } from '../src/types.js'

import { defaultUnpublishMatcher } from '../src/utils.js'

describe('defaultUnpublishMatcher', () => {
  test.each(['update', 'updateByID'] as const)(
    'detects an update to draft for %s operations',
    (operation) => {
      expect(defaultUnpublishMatcher({
        args: { data: { _status: 'draft', title: 'Changed title' } },
        operation,
      } as unknown as CollectionAfterOperationArgs)).toBe(true)
    },
  )

  test.each([
    { data: { _status: 'draft' }, operation: 'create' },
    { data: { _status: 'published' }, operation: 'update' },
    { data: { title: 'Changed title' }, operation: 'update' },
    { data: undefined, operation: 'update' },
  ] as const)('ignores $operation with data $data', ({ data, operation }) => {
    expect(defaultUnpublishMatcher({
      args: { data },
      operation,
    } as unknown as CollectionAfterOperationArgs)).toBe(false)
  })
})
