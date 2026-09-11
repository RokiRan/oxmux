// [INPUT]: 控制面受管模型 env（OXMUX_MANAGED_MODEL_*）、omp profile 的 agent 目录
// [OUTPUT]: 合并写入 omp models.yml 的受管 provider 定义（apiKey 只写 env 名引用，不落盘明文）
// [POS]: Omp 受管模型桥接：omp 模型/凭据由 profile 自管，这里把控制面 binding 翻译成 omp 自定义 provider
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// 为什么不能引 yaml 依赖：worker bundle 是 ESM，yaml 的 node 主入口是 CJS（内部 require('process')），
// 打进去会变成 dynamic require，远端启动即崩（omp-models.ts 不引 yaml 是同一约束，已在线上炸过一次）。
// 因此这里手写「缩进受控的文本手术」：只重写受管 provider 块，绝不触碰文件其余部分。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MANAGED_MODEL_RUNTIME_ENV } from '@shared/model-profile'

type ManagedOmpModel = {
  providerId: string
  modelId: string
  baseUrl: string
  /** models.yml 里 apiKey 字段引用环境变量名（omp resolveConfigValue 先查 env），真实 key 由 runtimeEnv 注入 */
  apiKeyEnv: string
}

const DEFAULT_MODEL_CONTEXT_WINDOW = 128000
const DEFAULT_MODEL_MAX_TOKENS = 16384

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

// YAML 双引号标量与 JSON 字符串转义规则兼容（\" \\ \n \uXXXX），复用 JSON.stringify 避免引号/换行注入
const yamlQuote = (value: string) => JSON.stringify(value)

/** 受管 provider 块统一用 2 空格缩进（与 omp 自身迁移写出的 YAML.stringify 格式一致），flow 数组/对象也是合法 YAML */
const renderManagedProviderBlock = (managed: ManagedOmpModel, api: string) => [
  `  ${yamlQuote(managed.providerId)}:`,
  `    baseUrl: ${yamlQuote(managed.baseUrl)}`,
  `    apiKey: ${yamlQuote(managed.apiKeyEnv)}`,
  `    api: ${yamlQuote(api)}`,
  `    models:`,
  `      - id: ${yamlQuote(managed.modelId)}`,
  `        name: ${yamlQuote(managed.modelId)}`,
  `        reasoning: ${inferReasoningSupport(managed)}`,
  `        input: ["text"]`,
  `        contextWindow: ${DEFAULT_MODEL_CONTEXT_WINDOW}`,
  `        maxTokens: ${DEFAULT_MODEL_MAX_TOKENS}`,
  `        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`,
]

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 既有受管块里用户显式写死的 api 予以保留（如手工改成 anthropic-messages）；读不到就用启发式 */
const pickExistingApi = (blockLines: string[]) => {
  for (const line of blockLines) {
    const match = /^    api:\s*"?([^"\s#]+)"?\s*(?:#.*)?$/.exec(line)
    if (match?.[1]) {
      return match[1]
    }
  }
  return ''
}

const isTopLevelKey = (line: string) => /^\S/.test(line)
const isProviderEntry = (line: string) => /^  \S/.test(line)

/** 在 models.yml 文本里 upsert 受管 provider 块；其余 provider/顶层键原样保留 */
const upsertProviderBlock = (content: string, managed: ManagedOmpModel) => {
  const lines = content.split('\n')
  const providersIndex = lines.findIndex((line) => /^providers:(\s*\{\s*\})?\s*(?:#.*)?$/.test(line))
  const providerKeyPattern = new RegExp(`^  (?:"${escapeRegExp(managed.providerId)}"|${escapeRegExp(managed.providerId)}):\\s*(?:#.*)?$`)

  if (providersIndex < 0) {
    const block = renderManagedProviderBlock(managed, inferOmpProviderApi(managed))
    return [...content.trimEnd().split('\n').filter(Boolean), 'providers:', ...block, ''].join('\n')
  }

  // providers: {} 流式空表改写成块形式，后续统一按块处理
  if (/^providers:\s*\{\s*\}/.test(lines[providersIndex])) {
    lines[providersIndex] = 'providers:'
  }

  // providers 段范围：从 providers: 下一行到下一个顶层键（或 EOF）
  let providersEnd = lines.length
  for (let i = providersIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim() && isTopLevelKey(lines[i])) {
      providersEnd = i
      break
    }
  }

  const existingIndex = lines.findIndex((line, i) => i > providersIndex && i < providersEnd && providerKeyPattern.test(line))

  if (existingIndex >= 0) {
    // 受管块范围：到下一个 provider 条目或 providers 段结束
    let blockEnd = providersEnd
    for (let i = existingIndex + 1; i < providersEnd; i += 1) {
      if (lines[i].trim() && isProviderEntry(lines[i])) {
        blockEnd = i
        break
      }
    }
    const api = pickExistingApi(lines.slice(existingIndex, blockEnd)) || inferOmpProviderApi(managed)
    lines.splice(existingIndex, blockEnd - existingIndex, ...renderManagedProviderBlock(managed, api))
    return lines.join('\n')
  }

  // 新受管 provider 追加到 providers 段末尾（保持段内尾部空行在段外）
  let insertAt = providersEnd
  while (insertAt > providersIndex + 1 && !lines[insertAt - 1].trim()) {
    insertAt -= 1
  }
  lines.splice(insertAt, 0, ...renderManagedProviderBlock(managed, inferOmpProviderApi(managed)))
  return lines.join('\n')
}

/**
 * 把受管 binding 合并进 omp profile 的 models.yml。
 * 只重写目标 provider 块，用户在同 profile 配置的其他 provider/顶层键原样保留；
 * 文件缺失或为空时直接生成。apiKey 落 env 名引用，真实 key 随 runtimeEnv 注入子进程，不落盘明文。
 */
export const upsertOmpManagedProvider = (agentDir: string, managed: ManagedOmpModel) => {
  const modelsPath = path.join(agentDir, 'models.yml')
  const existing = existsSync(modelsPath) ? readFileSync(modelsPath, 'utf8') : ''
  const next = upsertProviderBlock(existing, managed)
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(modelsPath, next, 'utf8')
}
