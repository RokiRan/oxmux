// [INPUT]: 控制面受管模型 env（OXMUX_MANAGED_MODEL_*）、omp profile 的 agent 目录
// [OUTPUT]: 合并写入 omp models.yml 的受管 provider 定义（apiKey 只写 env 名引用，不落盘明文）
// [POS]: Omp 受管模型桥接：omp 模型/凭据由 profile 自管，这里把控制面 binding 翻译成 omp 自定义 provider
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { MANAGED_MODEL_RUNTIME_ENV } from '@shared/model-profile'
import { isRecord } from '@shared/utils'

type ManagedOmpModel = {
  providerId: string
  modelId: string
  baseUrl: string
  /** models.yml 里 apiKey 字段引用环境变量名（omp resolveConfigValue 先查 env），真实 key 由 runtimeEnv 注入 */
  apiKeyEnv: string
}

type OmpModelsConfig = {
  providers?: Record<string, Record<string, unknown>>
}

const DEFAULT_MODEL_CONTEXT_WINDOW = 128000
const DEFAULT_MODEL_MAX_TOKENS = 16384
const DEFAULT_MODEL_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** 与 pi-session-config 的 inferModelApi 保持同一启发式，避免两个 runtime 对同一 binding 推断出不同协议 */
const inferOmpProviderApi = (managed: Omit<ManagedOmpModel, 'apiKeyEnv'>) => {
  const combined = `${managed.providerId} ${managed.modelId} ${managed.baseUrl}`.toLowerCase()
  if (combined.includes('anthropic') || combined.includes('claude')) {
    return 'anthropic-messages'
  }
  if (combined.includes('google') || combined.includes('gemini')) {
    return 'google-generative-ai'
  }
  return 'openai-completions'
}

const inferReasoningSupport = (managed: Pick<ManagedOmpModel, 'providerId' | 'modelId'>) => {
  const normalized = `${managed.providerId}/${managed.modelId}`.toLowerCase()
  return normalized.includes('gpt-5')
    || normalized.includes('claude')
    || normalized.includes('gemini')
    || normalized.includes('deepseek')
    || normalized.includes('qwen')
    || normalized.includes('kimi')
}

/** 控制面未下发受管模型时返回 null；下发但缺字段时拒绝静默回退到节点本地凭据（与 Codex 桥接同一纪律） */
export const readManagedOmpModel = (runtimeEnv?: Record<string, string>): ManagedOmpModel | null => {
  if (runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.enabled] !== '1') {
    return null
  }

  const providerId = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.providerId]?.trim() || ''
  const modelId = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.modelId]?.trim() || ''
  const baseUrl = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.baseUrl]?.trim() || ''
  const apiKey = runtimeEnv[MANAGED_MODEL_RUNTIME_ENV.apiKey]?.trim() || ''
  if (!providerId || !modelId || !baseUrl || !apiKey) {
    throw new Error('受管 Omp 模型配置不完整（需要 providerId/modelId/baseUrl/apiKey），已拒绝回退到 omp profile 本地凭据。')
  }

  return { providerId, modelId, baseUrl, apiKeyEnv: MANAGED_MODEL_RUNTIME_ENV.apiKey }
}

const readExistingModelsConfig = (modelsPath: string): OmpModelsConfig => {
  if (!existsSync(modelsPath)) {
    return {}
  }
  try {
    const parsed = parseYaml(readFileSync(modelsPath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed as OmpModelsConfig : {}
  } catch {
    // 已损坏的 models.yml 不应让整个执行失败；保留其他 provider 的 best-effort 合并不再可能，按空配置处理
    return {}
  }
}

const upsertManagedModel = (models: unknown, managed: ManagedOmpModel) => {
  const existingModels = Array.isArray(models) ? models.filter(isRecord) : []
  const existing = existingModels.find((model) => model.id === managed.modelId)
  const nextModel = {
    ...(existing ?? {}),
    id: managed.modelId,
    name: typeof existing?.name === 'string' ? existing.name : managed.modelId,
    reasoning: typeof existing?.reasoning === 'boolean' ? existing.reasoning : inferReasoningSupport(managed),
    input: Array.isArray(existing?.input) ? existing.input : ['text'],
    contextWindow: typeof existing?.contextWindow === 'number' ? existing.contextWindow : DEFAULT_MODEL_CONTEXT_WINDOW,
    maxTokens: typeof existing?.maxTokens === 'number' ? existing.maxTokens : DEFAULT_MODEL_MAX_TOKENS,
    cost: isRecord(existing?.cost) ? existing.cost : DEFAULT_MODEL_COST,
  }
  return [...existingModels.filter((model) => model.id !== managed.modelId), nextModel]
}

/**
 * 把受管 binding 合并进 omp profile 的 models.yml。
 * 只覆盖目标 provider 的 baseUrl/apiKey/api 与目标 model 条目，用户在同 profile 配置的其他 provider/model 原样保留。
 */
export const upsertOmpManagedProvider = (agentDir: string, managed: ManagedOmpModel) => {
  const modelsPath = path.join(agentDir, 'models.yml')
  const existing = readExistingModelsConfig(modelsPath)
  const existingProviders = isRecord(existing.providers) ? existing.providers : {}
  const existingProvider = isRecord(existingProviders[managed.providerId]) ? existingProviders[managed.providerId] : {}

  const nextProvider = {
    ...existingProvider,
    baseUrl: managed.baseUrl,
    apiKey: managed.apiKeyEnv,
    api: typeof existingProvider.api === 'string' && existingProvider.api.trim()
      ? existingProvider.api
      : inferOmpProviderApi(managed),
    models: upsertManagedModel(existingProvider.models, managed),
  }

  mkdirSync(agentDir, { recursive: true })
  writeFileSync(modelsPath, stringifyYaml({
    ...existing,
    providers: {
      ...existingProviders,
      [managed.providerId]: nextProvider,
    },
  }), 'utf8')
}
