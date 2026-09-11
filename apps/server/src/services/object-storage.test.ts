import assert from 'node:assert/strict'
import test from 'node:test'
import { getObjectStorageStatus, readObjectStorageConfig } from './object-storage'

const OBJECT_STORAGE_ENV_KEYS = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_KEY_PREFIX',
] as const

const withObjectStorageEnv = (
  env: Partial<Record<(typeof OBJECT_STORAGE_ENV_KEYS)[number], string>>,
  fn: () => void,
) => {
  const previous = new Map<string, string | undefined>()
  for (const key of OBJECT_STORAGE_ENV_KEYS) {
    previous.set(key, process.env[key])
    const value = env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    fn()
  } finally {
    for (const key of OBJECT_STORAGE_ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('readObjectStorageConfig defaults the S3-compatible region to auto for Cloudflare R2', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com/',
    OBJECT_STORAGE_BUCKET: 'vibemux-preview',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
  }, () => {
    assert.deepEqual(readObjectStorageConfig(), {
      endpoint: 'https://example-account.r2.cloudflarestorage.com',
      bucket: 'vibemux-preview',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      region: 'auto',
      keyPrefix: '',
      configured: true,
    })
  })
})

test('readObjectStorageConfig preserves an explicit S3-compatible region', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://s3.us-west-2.amazonaws.com',
    OBJECT_STORAGE_BUCKET: 'vibemux-production',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    OBJECT_STORAGE_REGION: 'us-west-2',
  }, () => {
    assert.equal(readObjectStorageConfig().region, 'us-west-2')
  })
})

test('getObjectStorageStatus defaults region to auto for R2-compatible config', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com/',
    OBJECT_STORAGE_BUCKET: 'vibemux-preview',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
  }, () => {
    assert.deepEqual(getObjectStorageStatus(), {
      configured: true,
      driver: 's3-compatible',
      bucket: 'vibemux-preview',
      region: 'auto',
      keyPrefix: '',
    })
  })
})

test('getObjectStorageStatus accepts explicit S3-compatible region', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://s3.example.com',
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_BUCKET: 'vibemux-production',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
  }, () => {
    assert.equal(getObjectStorageStatus().region, 'us-east-1')
  })
})

test('readObjectStorageConfig normalizes an optional object key prefix', () => {
  withObjectStorageEnv({
    OBJECT_STORAGE_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com/',
    OBJECT_STORAGE_BUCKET: 'vibemux-preview',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    OBJECT_STORAGE_KEY_PREFIX: '/pr/my-branch/',
  }, () => {
    assert.equal(readObjectStorageConfig().keyPrefix, 'pr/my-branch')
    assert.equal(getObjectStorageStatus().keyPrefix, 'pr/my-branch')
  })
})

