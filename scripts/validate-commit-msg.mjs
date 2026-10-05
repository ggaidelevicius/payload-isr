import fs from 'node:fs'

const commitMsgFile = process.argv[2]
const printBump = process.argv[3] === '--print-bump'

if (!commitMsgFile || process.argv.length > 4 || (process.argv[3] && !printBump)) {
  console.error('[payload-isr] Usage: validate-commit-msg.mjs <message-file> [--print-bump]')
  process.exit(1)
}

const message = fs.readFileSync(commitMsgFile, 'utf8')

if (!message.includes('(release') && !printBump) {
  process.exit(0)
}

const allowedMarkers = new Set([
  '(release:patch)',
  '(release:minor)',
  '(release:major)',
])

// Include malformed and unclosed markers so a valid marker cannot hide a typo.
const foundMarkers = message.match(/\(release[^)]*(?:\)|$)/g) ?? []
const marker = foundMarkers[0]

if (foundMarkers.length === 1 && allowedMarkers.has(marker)) {
  if (printBump) {
    console.log(marker.slice('(release:'.length, -1))
  }
  process.exit(0)
}

console.error('[payload-isr] Invalid release marker in commit message.')
console.error(
  '[payload-isr] Use exactly one of: (release:patch), (release:minor), (release:major).',
)
if (foundMarkers.length > 0) {
  console.error(`[payload-isr] Found markers: ${foundMarkers.join(', ')}`)
}

process.exit(1)
