import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadIsr } from 'payload-isr'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import {
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
  // eslint-disable-next-line no-var
  var __payloadMemoryDbUri: string | undefined
  // eslint-disable-next-line no-var
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

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) {
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
            required: true,
            type: 'text',
          },
          {
            name: 'slug',
            required: true,
            type: 'text',
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
            shouldHandle: ({ result }) => Boolean(result.isPublished),
            pathResolver: ({ result }) => [
              `/posts/${result.slug ?? result.id}`,
              '/posts',
            ],
            tagResolver: ({ result }) => ['posts', `post:${result.id}`],
            unpublish: {
              matcher: ({ operation, args }) => {
                if (operation !== 'updateByID') return false
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
            onDelete: {
              pathResolver: ({ id }) => [`/posts/${id}`, '/posts'],
              tagResolver: ({ id }) => ['posts', `post:${id}`],
            },
          },
        ],
        globals: [
          {
            slug: 'site-settings',
            shouldHandle: ({ doc }) => Boolean(doc.isPublished),
            revalidateAllOnChange: true,
            tagResolver: () => ['site-settings', 'global'],
          },
        ],
        revalidatePath: recordRevalidation,
        revalidateTag: recordTagRevalidation,
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
