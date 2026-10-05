import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const validatorPath = fileURLToPath(new URL('../scripts/validate-commit-msg.mjs', import.meta.url))
const tempDirectory = mkdtempSync(path.join(tmpdir(), 'payload-isr-release-'))
let messageNumber = 0

const validateMessage = (message: string, printBump = false) => {
  const messageFile = path.join(tempDirectory, `message-${messageNumber++}.txt`)
  writeFileSync(messageFile, message)

  return spawnSync(process.execPath, [
    validatorPath,
    messageFile,
    ...(printBump ? ['--print-bump'] : []),
  ], { encoding: 'utf8' })
}

afterAll(() => {
  rmSync(tempDirectory, { force: true, recursive: true })
})

describe('release commit validation', () => {
  test('accepts ordinary commits without a release marker', () => {
    const result = validateMessage('Improve release validation')

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  test.each(['patch', 'minor', 'major'])('extracts the %s bump for CI', (bump) => {
    const result = validateMessage(`Ship improvements (release:${bump})\n\nDetails.`, true)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${bump}\n`)
  })

  test.each([
    '(release:path)',
    '(release:)',
    '(release:patch',
    '(release:patch) (release:minor)',
    '(release:patch) (release:patch)',
    '(release:patch) (release)',
    '(release:patch) (release',
    '(release:patch) (release:path)',
    '(release\n(release:patch)',
  ])('rejects malformed or conflicting markers: %s', (message) => {
    const result = validateMessage(message)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Use exactly one of:')
  })

  test('requires a release marker when CI requests a bump', () => {
    const result = validateMessage('Ordinary commit', true)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })

  test('treats shell syntax in a commit message as literal text', () => {
    const result = validateMessage('Improve $(printf unsafe) and `printf unsafe` (release:minor)', true)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('minor\n')
  })
})
