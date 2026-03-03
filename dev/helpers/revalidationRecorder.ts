import type {
  FullRebuildContext,
  LoggerLike,
  RevalidationMode,
  RevalidationReason,
  RevalidateTagFn,
} from '../../src/index.js'

type RevalidationScope = 'collection' | 'global'

export type PathRevalidationEvent = {
  at: string
  meta: {
    mode: RevalidationMode
    reason: RevalidationReason
    scope: RevalidationScope
    slug: string
  }
  path: string
}

export type TagRevalidationEvent = {
  at: string
  meta?: {
    reason: RevalidationReason
    scope: RevalidationScope
    slug: string
  }
  tag: string
}

export type FullRebuildEvent = {
  at: string
  context: FullRebuildContext
}

type LogLevel = 'error' | 'info' | 'warn'

export type IsrLogEvent = {
  at: string
  level: LogLevel
  line: string
}

export type IsrTraceEvent = {
  at: string
  details: Record<string, unknown>
  event: string
}

type PayloadIsrTracePayload = {
  event: string
  source: 'payload-isr'
  type: 'debug-trace'
} & Record<string, unknown>

const pathEvents: PathRevalidationEvent[] = []
const tagEvents: TagRevalidationEvent[] = []
const fullRebuildEvents: FullRebuildEvent[] = []
const logEvents: IsrLogEvent[] = []
const traceEvents: IsrTraceEvent[] = []

const now = (): string => new Date().toISOString()

const formatLogArg = (value: unknown): string => {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const isPayloadIsrTracePayload = (value: unknown): value is PayloadIsrTracePayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return (
    'source' in value &&
    value.source === 'payload-isr' &&
    'type' in value &&
    value.type === 'debug-trace' &&
    'event' in value &&
    typeof value.event === 'string'
  )
}

const recordLog = (level: LogLevel, args: unknown[]): void => {
  const at = now()
  logEvents.push({
    at,
    level,
    line: args.map((arg) => formatLogArg(arg)).join(' '),
  })

  for (const arg of args) {
    if (!isPayloadIsrTracePayload(arg)) {
      continue
    }

    const { event, source: _source, type: _type, ...details } = arg
    traceEvents.push({
      at,
      event,
      details,
    })
  }
}

const writeConsole = (level: LogLevel, args: unknown[]): void => {
  const prefixedArgs = ['[payload-isr/dev]', ...args]

  if (level === 'error') {
    console.error(...prefixedArgs)
    return
  }
  if (level === 'warn') {
    console.warn(...prefixedArgs)
    return
  }

  console.info(...prefixedArgs)
}

export const recordRevalidation = (
  path: string,
  meta: PathRevalidationEvent['meta'],
): void => {
  pathEvents.push({
    at: now(),
    meta,
    path,
  })
}

export const recordTagRevalidation: RevalidateTagFn = (
  tag,
  meta,
): void => {
  tagEvents.push({
    at: now(),
    meta,
    tag,
  })
}

export const recordFullRebuild = (context: FullRebuildContext): void => {
  fullRebuildEvents.push({
    at: now(),
    context,
  })
}

export const createIsrDevLogger = (): LoggerLike => {
  return {
    error: (...args: unknown[]): void => {
      recordLog('error', args)
      writeConsole('error', args)
    },
    info: (...args: unknown[]): void => {
      recordLog('info', args)
      writeConsole('info', args)
    },
    warn: (...args: unknown[]): void => {
      recordLog('warn', args)
      writeConsole('warn', args)
    },
  }
}

export const getPathRevalidationEvents = (): PathRevalidationEvent[] => {
  return [...pathEvents]
}

export const getTagRevalidationEvents = (): TagRevalidationEvent[] => {
  return [...tagEvents]
}

export const getFullRebuildEvents = (): FullRebuildEvent[] => {
  return [...fullRebuildEvents]
}

export const getIsrLogEvents = (): IsrLogEvent[] => {
  return [...logEvents]
}

export const getIsrTraceEvents = (): IsrTraceEvent[] => {
  return [...traceEvents]
}

export const clearRevalidationEvents = (): void => {
  pathEvents.length = 0
  tagEvents.length = 0
  fullRebuildEvents.length = 0
  logEvents.length = 0
  traceEvents.length = 0
}
