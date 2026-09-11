import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parse as parseYaml } from 'yaml'
import { MANAGED_MODEL_RUNTIME_ENV } from '@shared/model-profile'
import { readManagedOmpModel, upsertOmpManagedProvider } from './omp-managed-models'

const createTempAgentDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'omp-managed-models-'))
  const agentDir = path.join(root, 'agent')
  return {
    agentDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

const buildManagedEnv = (overrides: Record<string, string> = {}) => ({
  [MANAGED_MODEL_RUNTIME_ENV.enabled]: '1',
  [MANAGED_MODEL_RUNTIME_ENV.bindingId]: 'binding-minimax',
  [MANAGED_MODEL_RUNTIME_ENV.providerId]: 'minimax-cn',
  [MANAGED_MODEL_RUNTIME_ENV.modelId]: 'MiniMax-M3',
  [MANAGED_MODEL_RUNTIME_ENV.baseUrl]: 'https://api.minimaxi.com/v1',
  [MANAGED_MODEL_RUNTIME_ENV.apiKey]: 'profile-api-key',
  ...overrides,
})

test('readManagedOmpModel returns null when managed model env is absent', () => {
  assert.equal(readManagedOmpModel(undefined), null)
  assert.equal(readManagedOmpModel({}), null)
  assert.equal(readManagedOmpModel({ [MANAGED_MODEL_RUNTIME_ENV.providerId]: 'minimax-cn' }), null)
})

test('readManagedOmpModel rejects incomplete managed env instead of falling back to local credentials', () => {
  assert.throws(
    () => readManagedOmpModel(buildManagedEnv({ [MANAGED_MODEL_RUNTIME_ENV.apiKey]: '' })),
    /受管 Omp 模型配置不完整/,
  )
  assert.throws(
    () => readManagedOmpModel(buildManagedEnv({ [MANAGED_MODEL_RUNTIME_ENV.baseUrl]: ' ' })),
    /受管 Omp 模型配置不完整/,
  )
})

test('readManagedOmpModel never exposes the raw key: models.yml references the env name', () => {
  const managed = readManagedOmpModel(buildManagedEnv())
  assert.ok(managed)
  assert.equal(managed.providerId, 'minimax-cn')
  assert.equal(managed.modelId, 'MiniMax-M3')
  assert.equal(managed.apiKeyEnv, MANAGED_MODEL_RUNTIME_ENV.apiKey)
  assert.equal(JSON.stringify(managed).includes('profile-api-key'), false)
})

test('upsertOmpManagedProvider creates models.yml with an env-referenced openai-compatible provider', () => {
  const { agentDir, cleanup } = createTempAgentDir()
  try {
    const managed = readManagedOmpModel(buildManagedEnv())!
    upsertOmpManagedProvider(agentDir, managed)

    const config = parseYaml(readFileSync(path.join(agentDir, 'models.yml'), 'utf8'))
    const provider = config.providers['minimax-cn']
    assert.equal(provider.baseUrl, 'https://api.minimaxi.com/v1')
    assert.equal(provider.apiKey, MANAGED_MODEL_RUNTIME_ENV.apiKey)
    assert.equal(JSON.stringify(provider).includes('profile-api-key'), false)
    assert.equal(provider.api, 'openai-completions')
    assert.deepEqual(provider.models.map((model: { id: string }) => model.id), ['MiniMax-M3'])
  } finally {
    cleanup()
  }
})

test('upsertOmpManagedProvider infers anthropic-messages for claude-style bindings', () => {
  const { agentDir, cleanup } = createTempAgentDir()
  try {
    const managed = readManagedOmpModel(buildManagedEnv({
      [MANAGED_MODEL_RUNTIME_ENV.providerId]: 'anthropic',
      [MANAGED_MODEL_RUNTIME_ENV.modelId]: 'claude-sonnet-4-6',
      [MANAGED_MODEL_RUNTIME_ENV.baseUrl]: 'https://api.anthropic.com',
    }))!
    upsertOmpManagedProvider(agentDir, managed)

    const config = parseYaml(readFileSync(path.join(agentDir, 'models.yml'), 'utf8'))
    assert.equal(config.providers.anthropic.api, 'anthropic-messages')
    assert.equal(config.providers.anthropic.models[0].reasoning, true)
  } finally {
    cleanup()
  }
})

test('upsertOmpManagedProvider preserves other providers and the managed block api, regenerating the managed provider', () => {
  const { agentDir, cleanup } = createTempAgentDir()
  try {
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(path.join(agentDir, 'models.yml'), [
      'providers:',
      '  minimax-code-cn:',
      '    baseUrl: https://api.minimaxi.com/anthropic',
      '    apiKey: MINIMAX_CODE_KEY',
      '    api: anthropic-messages',
      '    models:',
      '      - id: MiniMax-M2.7',
      '        contextWindow: 204800',
      '  minimax-cn:',
      '    baseUrl: https://stale.example/v1',
      '    apiKey: STALE_KEY',
      '    api: openai-completions',
      '    models:',
      '      - id: MiniMax-M3',
      '        contextWindow: 204800',
      '',
    ].join('\n'), 'utf8')

    const managed = readManagedOmpModel(buildManagedEnv())!
    upsertOmpManagedProvider(agentDir, managed)

    const config = parseYaml(readFileSync(path.join(agentDir, 'models.yml'), 'utf8'))
    // 其他 provider 整段原样保留
    assert.equal(config.providers['minimax-code-cn'].apiKey, 'MINIMAX_CODE_KEY')
    assert.equal(config.providers['minimax-code-cn'].api, 'anthropic-messages')
    assert.equal(config.providers['minimax-code-cn'].models[0].contextWindow, 204800)
    // 受管 provider 块由控制面重建：baseUrl/apiKey 覆盖，既有显式 api 保留
    const provider = config.providers['minimax-cn']
    assert.equal(provider.baseUrl, 'https://api.minimaxi.com/v1')
    assert.equal(provider.apiKey, MANAGED_MODEL_RUNTIME_ENV.apiKey)
    assert.equal(provider.api, 'openai-completions')
    assert.deepEqual(provider.models.map((model: { id: string }) => model.id), ['MiniMax-M3'])
  } finally {
    cleanup()
  }
})

test('upsertOmpManagedProvider never crashes on unrecognized existing content and still writes the managed block', () => {
  const { agentDir, cleanup } = createTempAgentDir()
  try {
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(path.join(agentDir, 'models.yml'), '# hand-written notes\nproviders: {}\n', 'utf8')

    const managed = readManagedOmpModel(buildManagedEnv())!
    upsertOmpManagedProvider(agentDir, managed)

    const content = readFileSync(path.join(agentDir, 'models.yml'), 'utf8')
    assert.ok(content.includes('# hand-written notes'))
    const config = parseYaml(content)
    assert.equal(config.providers['minimax-cn'].baseUrl, 'https://api.minimaxi.com/v1')
  } finally {
    cleanup()
  }
})

test('upsertOmpManagedProvider creates a missing agent dir for first-run profiles', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'omp-managed-models-fresh-'))
  try {
    const agentDir = path.join(root, 'profiles', 'oxmux-user', 'agent')
    const managed = readManagedOmpModel(buildManagedEnv())!
    upsertOmpManagedProvider(agentDir, managed)
    assert.ok(existsSync(path.join(agentDir, 'models.yml')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
