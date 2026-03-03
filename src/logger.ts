import type { LoggerLike } from './types.js'

export type PayloadIsrLoggerOptions = {
  prefix?: string
}

const DEFAULT_PREFIX = '[payload-isr]'

const withPrefix = (
  prefix: string,
  method: (...args: unknown[]) => void,
): ((...args: unknown[]) => void) => {
  return (...args: unknown[]) => {
    method(prefix, ...args)
  }
}

export const createPayloadIsrLogger = (
  options: PayloadIsrLoggerOptions = {},
): LoggerLike => {
  const prefix = options.prefix?.trim() || DEFAULT_PREFIX

  return {
    error: withPrefix(prefix, (...args) => {
      console.error(...args)
    }),
    info: withPrefix(prefix, (...args) => {
      console.info(...args)
    }),
    warn: withPrefix(prefix, (...args) => {
      console.warn(...args)
    }),
  }
}
