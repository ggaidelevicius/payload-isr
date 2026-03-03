import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { payloadIsr } from '../src/index.js'
import {
  createIsrDevLogger,
  recordFullRebuild,
  recordRevalidation,
  recordTagRevalidation,
} from './helpers/revalidationRecorder.js'
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

declare global {
   
  var __payloadMemoryDbUri: string | undefined
   
  var __payloadMemoryDbUriPromise: Promise<string> | undefined
}

const getOrCreateMemoryDatabaseURI = async (): Promise<string> => {
  if (globalThis.__payloadMemoryDbUri) {
    return globalThis.__payloadMemoryDbUri
  }

  if (!globalThis.__payloadMemoryDbUriPromise) {
    globalThis.__payloadMemoryDbUriPromise = MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: 'payloadmemory',
      },
    }).then((memoryDB) => `${memoryDB.getUri()}&retryWrites=true`)
  }

  const uri = await globalThis.__payloadMemoryDbUriPromise
  globalThis.__payloadMemoryDbUri = uri
  return uri
}

const parseBoolean = (
  value: string | undefined,
  defaultValue: boolean,
): boolean => {
  if (typeof value !== 'string') {
    return defaultValue
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === '') {
    return defaultValue
  }

  return !['0', 'false', 'no', 'off'].includes(normalized)
}

const isrDebugEnabled = parseBoolean(process.env.PAYLOAD_ISR_DEBUG, true)
const isrFullRebuildEnabled = parseBoolean(
  process.env.PAYLOAD_ISR_FULL_REBUILD,
  false,
)
const isrProbeOrigin = process.env.PAYLOAD_ISR_PROBE_ORIGIN ?? 'http://127.0.0.1:3000'
const isrLogger = createIsrDevLogger()

const toAbsoluteDevURL = (pathname: string): string => {
  return new URL(pathname, isrProbeOrigin).toString()
}

const isPayloadGenerateCommand = process.argv.some(
  (arg) => arg === 'generate:types' || arg === 'generate:importmap',
)

const buildConfigWithMemoryDB = async () => {
  if (isPayloadGenerateCommand && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'mongodb://127.0.0.1:27017/payloadmemory'
  } else if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = await getOrCreateMemoryDatabaseURI()
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'posts',
        fields: [
          {
            name: 'title',
            type: 'text',
            required: true,
          },
          {
            name: 'slug',
            type: 'text',
            required: true,
            unique: true,
          },
          {
            name: 'isPublished',
            type: 'checkbox',
            defaultValue: false,
          },
        ],
      },
      {
        slug: 'media',
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, 'media'),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    globals: [
      {
        slug: 'site-settings',
        fields: [
          {
            name: 'homepageTitle',
            type: 'text',
          },
          {
            name: 'isPublished',
            type: 'checkbox',
            defaultValue: false,
          },
        ],
      },
    ],
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [
      payloadIsr({
        collections: [
          {
            slug: 'posts',
            onDelete: {
              pathResolver: ({ id }) => [`/posts/${id}`, '/posts'],
              tagResolver: ({ id }) => ['posts', `post:${id}`],
            },
            pathResolver: ({ result }) => [
              `/posts/${result.slug ?? result.id}`,
              '/posts',
            ],
            probeURL: ({ result }) =>
              toAbsoluteDevURL(`/posts/${result.slug ?? result.id}`),
            referencePathResolver: (args) => {
              if (args.operation !== 'update' && args.operation !== 'updateByID') {
                return []
              }

              const previousSlug =
                'previousDoc' in args &&
                typeof args.previousDoc === 'object' &&
                args.previousDoc !== null &&
                'slug' in args.previousDoc &&
                typeof args.previousDoc.slug === 'string'
                  ? args.previousDoc.slug
                  : null
              const currentSlug =
                typeof args.result.slug === 'string' ? args.result.slug : null

              if (
                !previousSlug ||
                previousSlug === currentSlug
              ) {
                return []
              }

              return [`/posts/${previousSlug}`]
            },
            shouldHandle: ({ result }) => Boolean(result.isPublished),
            tagResolver: ({ result }) => ['posts', `post:${result.id}`],
            unpublish: {
              matcher: ({ args, operation }) => {
                if (operation !== 'updateByID') {return false}
                const data = args?.data
                return (
                  typeof data === 'object' &&
                  data !== null &&
                  !Array.isArray(data) &&
                  Object.keys(data).length === 1 &&
                  data.isPublished === false
                )
              },
            },
          },
        ],
        debug: isrDebugEnabled,
        debugURLOrigin: isrProbeOrigin,
        fullRebuild: {
          enabled: isrFullRebuildEnabled,
          shouldTrigger: (context) => {
            const shouldTrigger = context.probeStatus === 404
            isrLogger.info?.({
              type: 'callback',
              callback: 'fullRebuild.shouldTrigger',
              context,
              shouldTrigger,
              source: 'payload-isr-dev',
            })
            return shouldTrigger
          },
          trigger: async (context) => {
            recordFullRebuild(context)
            isrLogger.warn({
              type: 'callback',
              callback: 'fullRebuild.trigger',
              context,
              source: 'payload-isr-dev',
            })
          },
        },
        globals: [
          {
            slug: 'site-settings',
            probeURL: () => toAbsoluteDevURL('/'),
            revalidateAllOnChange: true,
            shouldHandle: ({ doc }) => Boolean(doc.isPublished),
            tagResolver: () => ['site-settings', 'global'],
          },
        ],
        logger: isrLogger,
        revalidatePath: (path, meta) => {
          recordRevalidation(path, meta)
          isrLogger.info?.({
            type: 'callback',
            callback: 'revalidatePath',
            meta,
            path,
            source: 'payload-isr-dev',
          })
        },
        revalidateTag: (tag, meta) => {
          recordTagRevalidation(tag, meta)
          isrLogger.info?.({
            type: 'callback',
            callback: 'revalidateTag',
            meta,
            source: 'payload-isr-dev',
            tag,
          })
        },
      }),
    ],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
