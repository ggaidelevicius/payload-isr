import fs from 'node:fs'

const commitMsgFile = process.argv[2]

if (!commitMsgFile) {
  console.error('[payload-isr] commit-msg validation requires a commit message file path.')
  process.exit(1)
}

const message = fs.readFileSync(commitMsgFile, 'utf8')

if (!message.includes('(release')) {
  process.exit(0)
}

const allowedMarkers = new Set([
  '(release:patch)',
  '(release:minor)',
  '(release:major)',
])

const foundMarkers = [...message.matchAll(/\(release:[^)]+\)/g)].map((match) => match[0])
const validMarkers = foundMarkers.filter((marker) => allowedMarkers.has(marker))
const invalidMarkers = foundMarkers.filter((marker) => !allowedMarkers.has(marker))

const hasValidSingleMarker = validMarkers.length === 1
const hasInvalidMarkers = invalidMarkers.length > 0

if (hasValidSingleMarker && !hasInvalidMarkers) {
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
