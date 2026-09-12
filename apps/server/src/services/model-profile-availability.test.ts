import assert from 'node:assert/strict'
import test from 'node:test'
import { testModelProfileAvailability } from './model-profile-availability'

test('testModelProfileAvailability uses OpenAI-compatible chat completions endpoint', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  const result = await testModelProfileAvailability({
    providerId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiToken: 'test-key',
    compatibility: 'openai',
    modelIds: ['openai/gpt-5'],
    timeoutMs: 1000,
  }, {
    fetchImpl: async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({ id: 'chatcmpl_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(requestUrl, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(requestInit?.method, 'POST')
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer test-key')
  assert.equal(result.testedModelId, 'openai/gpt-5')
})

test('testModelProfileAvailability uses Anthropic messages endpoint', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  const result = await testModelProfileAvailability({
    providerId: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiToken: 'anthropic-key',
    compatibility: 'anthropic',
    modelIds: ['claude-sonnet-4-20250514'],
    timeoutMs: 1000,
  }, {
    fetchImpl: async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({ id: 'msg_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(requestUrl, 'https://api.anthropic.com/v1/messages')
  assert.equal((requestInit?.headers as Record<string, string>)['x-api-key'], 'anthropic-key')
  assert.equal((requestInit?.headers as Record<string, string>)['anthropic-version'], '2023-06-01')
  assert.equal(result.providerId, 'anthropic')
})

test('testModelProfileAvailability surfaces upstream API errors', async () => {
  await assert.rejects(
    () => testModelProfileAvailability({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiToken: 'bad-key',
      compatibility: 'openai',
      modelIds: ['gpt-5'],
      timeoutMs: 1000,
    }, {
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          message: 'Invalid API key',
        },
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /Invalid API key/,
  )
})

test('testModelProfileAvailability falls back to /anthropic/v1/messages when standard path returns routing-missing 404', async () => {
  const visited: string[] = []
  const result = await testModelProfileAvailability({
    providerId: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiToken: 'minimax-key',
    compatibility: 'anthropic',
    modelIds: ['MiniMax-M3'],
    timeoutMs: 1000,
  }, {
    fetchImpl: async (input) => {
      const url = String(input)
      visited.push(url)
      if (url.endsWith('/v1/messages') && !url.includes('/anthropic/')) {
        return new Response('404 page not found', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        })
      }
      return new Response(JSON.stringify({ id: 'msg_fallback' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.deepEqual(visited, [
    'https://api.minimaxi.com/v1/messages',
    'https://api.minimaxi.com/anthropic/v1/messages',
  ])
  assert.equal(result.status, 200)
  assert.equal(result.endpoint, 'https://api.minimaxi.com/anthropic/v1/messages')
})

test('testModelProfileAvailability does not fall back on auth errors', async () => {
  const visited: string[] = []
  await assert.rejects(
    () => testModelProfileAvailability({
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiToken: 'bad-key',
      compatibility: 'anthropic',
      modelIds: ['claude-sonnet-4-20250514'],
      timeoutMs: 1000,
    }, {
      fetchImpl: async (input) => {
        visited.push(String(input))
        return new Response(JSON.stringify({
          error: { message: 'Invalid API key' },
        }), { status: 401, headers: { 'content-type': 'application/json' } })
      },
    }),
    /Invalid API key/,
  )
  assert.deepEqual(visited, ['https://api.anthropic.com/v1/messages'])
})
