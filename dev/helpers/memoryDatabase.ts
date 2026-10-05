import { MongoMemoryReplSet } from 'mongodb-memory-server'

export type MemoryDatabase = {
  instance: MongoMemoryReplSet
  uri: string
}

declare global {
  var __payloadMemoryDatabase: {
    instance: MongoMemoryReplSet
    ready: Promise<MemoryDatabase>
  } | undefined
}

export const getOrCreateMemoryDatabase = (): Promise<MemoryDatabase> => {
  if (!globalThis.__payloadMemoryDatabase) {
    const instance = new MongoMemoryReplSet({
      replSet: {
        count: 1,
        dbName: 'payloadmemory',
      },
    })
    const ready = instance.start().then(() => ({
      instance,
      uri: `${instance.getUri()}&retryWrites=true`,
    })).catch(async (error: unknown) => {
      try {
        await instance.stop()
      } finally {
        if (globalThis.__payloadMemoryDatabase?.instance === instance) {
          globalThis.__payloadMemoryDatabase = undefined
        }
      }
      throw error
    })

    globalThis.__payloadMemoryDatabase = { instance, ready }
  }

  return globalThis.__payloadMemoryDatabase.ready
}

export const stopMemoryDatabase = async (database: MemoryDatabase): Promise<void> => {
  try {
    await database.instance.stop()
  } finally {
    if (globalThis.__payloadMemoryDatabase?.instance === database.instance) {
      globalThis.__payloadMemoryDatabase = undefined
    }
  }
}
