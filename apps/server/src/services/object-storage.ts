// [INPUT]: 对象存储请求
// [OUTPUT]: S3 操作
// [POS]: 对象存储封装
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { AwsClient } from 'aws4fetch'

type ObjectStorageConfig = {
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  region: string
  keyPrefix: string
  configured: boolean
}

const normalizeObjectStorageKeyPrefix = (value: string) => value
  .trim()
  .replace(/^\/+/, '')
  .replace(/\/+$/, '')

export const readObjectStorageConfig = (): ObjectStorageConfig => {
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim() ?? ''
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ?? ''
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() ?? ''
  const endpoint = (process.env.OBJECT_STORAGE_ENDPOINT?.trim() ?? '').replace(/\/$/, '')
  const region = process.env.OBJECT_STORAGE_REGION?.trim() || 'auto'
  const keyPrefix = normalizeObjectStorageKeyPrefix(process.env.OBJECT_STORAGE_KEY_PREFIX ?? '')

  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    keyPrefix,
    configured: Boolean(endpoint && bucket && accessKeyId && secretAccessKey),
  }
}

const resolveObjectStorageKey = (keyPrefix: string, key: string) => {
  const normalizedKey = key.replace(/^\/+/, '')
  return keyPrefix ? `${keyPrefix}/${normalizedKey}` : normalizedKey
}

const buildObjectUrl = (endpoint: string, bucket: string, key: string) => {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `${endpoint}/${bucket}/${encodedKey}`
}

const getClient = () => {
  const config = readObjectStorageConfig()
  if (!config.configured) {
    throw new Error('对象存储未配置，请补充 OBJECT_STORAGE_ENDPOINT、OBJECT_STORAGE_BUCKET、OBJECT_STORAGE_ACCESS_KEY_ID、OBJECT_STORAGE_SECRET_ACCESS_KEY 和可选 OBJECT_STORAGE_REGION。')
  }

  return {
    config,
    client: new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: config.region,
    }),
  }
}

export const getObjectStorageStatus = () => {
  const config = readObjectStorageConfig()

  return {
    configured: config.configured,
    driver: 's3-compatible',
    bucket: config.bucket,
    region: config.region,
    keyPrefix: config.keyPrefix,
  }
}

export const uploadObject = async (key: string, body: ArrayBuffer | Uint8Array, options: {
  contentType: string
  cacheControl?: string
}) => {
  const { config, client } = getClient()
  const payload = new Blob([body instanceof Uint8Array ? Uint8Array.from(body).buffer : body])
  const response = await client.fetch(buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)), {
    method: 'PUT',
    headers: {
      'Content-Type': options.contentType,
      'Cache-Control': options.cacheControl || 'public, max-age=31536000, immutable',
    },
    body: payload,
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || '上传对象到对象存储失败。')
  }
}

export const streamObject = async (key: string) => {
  const { config, client } = getClient()
  const response = await client.fetch(buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)), { method: 'GET' })

  if (response.status === 404) {
    return new Response(JSON.stringify({ message: '文件不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    return new Response(JSON.stringify({ message: message || '读取文件失败' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers = new Headers()
  headers.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream')
  headers.set('Cache-Control', response.headers.get('cache-control') || 'public, max-age=3600')

  return new Response(response.body, {
    status: 200,
    headers,
  })
}

export const downloadObject = async (key: string) => {
  const { config, client } = getClient()
  const response = await client.fetch(
    buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)),
    { method: 'GET' },
  )
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || (response.status === 404 ? '对象不存在。' : '读取对象失败。'))
  }
  return new Uint8Array(await response.arrayBuffer())
}

export const deleteObject = async (key: string) => {
  const { config, client } = getClient()
  const response = await client.fetch(
    buildObjectUrl(config.endpoint, config.bucket, resolveObjectStorageKey(config.keyPrefix, key)),
    { method: 'DELETE' },
  )
  if (!response.ok && response.status !== 404) {
    const message = await response.text().catch(() => '')
    throw new Error(message || '删除对象失败。')
  }
}
