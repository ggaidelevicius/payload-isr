/* eslint-disable no-console */
import type { LoggerLike } from './types.js'

export type PayloadIsrLoggerOptions = {
  includeConfigDebugEvents?: boolean
  prefix?: string
}

const DEFAULT_PREFIX = '[payload-isr]'

type PayloadIsrDebugTrace = {
  event: string
  type: 'debug-trace'
}

const isPayloadIsrConfigDebugTrace = (
  value: unknown,
): value is PayloadIsrDebugTrace => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  if (!('type' in value) || value.type !== 'debug-trace') {
    return false
  }

  if (!('event' in value) || typeof value.event !== 'string') {
    return false
  }

  return value.event.startsWith('config.')
}

const shouldFilterLog = (
  args: unknown[],
  includeConfigDebugEvents: boolean,
): boolean => {
  if (includeConfigDebugEvents) {
    return false
  }

  return args.some((arg) => isPayloadIsrConfigDebugTrace(arg))
}

const withPrefix = (
  prefix: string,
  method: (...args: unknown[]) => void,
  includeConfigDebugEvents: boolean,
): ((...args: unknown[]) => void) => {
  return (...args: unknown[]) => {
    if (shouldFilterLog(args, includeConfigDebugEvents)) {
      return
    }

    method(prefix, ...args)
  }
}

export const createPayloadIsrLogger = (
  options: PayloadIsrLoggerOptions = {},
): LoggerLike => {
  const includeConfigDebugEvents = options.includeConfigDebugEvents === true
  const prefix = options.prefix?.trim() || DEFAULT_PREFIX

  return {
    error: withPrefix(prefix, (...args) => {
      console.error(...args)
    }, includeConfigDebugEvents),
    info: withPrefix(prefix, (...args) => {
      console.info(...args)
    }, includeConfigDebugEvents),
    warn: withPrefix(prefix, (...args) => {
      console.warn(...args)
    }, includeConfigDebugEvents),
  }
}
