// [INPUT]: omp CLI（models ls --json）、worker Omp runtime 设置（profile/defaultModel）、omp config.yml
// [OUTPUT]: Omp 可用模型清单与默认模型
// [POS]: Omp 模型枚举（available-models 共用）；omp 只列出已授权 provider 的模型，天然过滤静态目录
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExecutionModelOption, WorkerConfig } from '@shared/types'
import { loadWorkerConfig } from '../core/config'
import { resolveExecutable } from './agent-runner-shared'
import { resolveOmpProfile } from './omp-runner'

const OMP_MODELS_LS_TIMEOUT_MS = 20_000

type OmpModelEntry = {
  provider?: string
  id?: string
  selector?: string
  name?: string
}

// profile 解析与执行期（omp-runner）同一规则：显式配置 > 按 actingUserId 派生 > omp 主配置（~/.omp/agent），
// 保证 UI 枚举出的模型就是运行时可用的模型
export const resolveOmpAgentDir = (profile: string) => {
  return profile
    ? path.join(os.homedir(), '.omp', 'profiles', profile, 'agent')
    : path.join(os.homedir(), '.omp', 'agent')
}

export const readLocalOmpDefaultModel = (agentDir: string) => {
  const configPath = path.join(agentDir, 'config.yml')
  if (!existsSync(configPath)) {
    return ''
  }
  try {
    // 不引 yaml 依赖（worker bundle 打 ESM，CJS 依赖会引入 dynamic require 导致远端启动崩溃）；
    // config.yml 里 modelRoles.default 是简单标量行，定向行解析即可
    const content = readFileSync(configPath, 'utf8')
    const rolesIndex = content.indexOf('modelRoles:')
    if (rolesIndex < 0) {
      return ''
    }
    const match = /^\s{2}default:\s*(\S+)\s*$/m.exec(content.slice(rolesIndex))
    return match?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

const runOmpModelsLs = (ompCommand: string, profile: string) => new Promise<OmpModelEntry[]>((resolvePromise, rejectPromise) => {
  const args = [...(profile ? ['--profile', profile] : []), 'models', 'ls', '--json']
  execFile(ompCommand, args, { timeout: OMP_MODELS_LS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
    if (error) {
      rejectPromise(error)
      return
    }
    try {
      const parsed = JSON.parse(stdout) as { models?: OmpModelEntry[] }
      resolvePromise(Array.isArray(parsed?.models) ? parsed.models : [])
    } catch {
      rejectPromise(new Error('omp models ls 输出不是合法 JSON。'))
    }
  })
})

const buildOmpExecutionModelOption = (providerId: string, modelId: string, defaultModel: string): ExecutionModelOption => {
  const id = `${providerId}/${modelId}`
  return {
    id,
    label: id,
    providerId,
    modelId,
    isDefault: Boolean(defaultModel) && id === defaultModel,
  }
}

export const listWorkerAvailableOmpModels = async (config = loadWorkerConfig(), actingUserId?: string): Promise<{
  models: ExecutionModelOption[]
  defaultModel?: string
  message?: string
}> => {
  const settings = config.agentSettings?.Omp
  let profile = ''
  try {
    profile = resolveOmpProfile(settings, actingUserId?.trim() || undefined)
  } catch (error) {
    return { models: [], message: error instanceof Error ? error.message : 'omp profile 配置非法。' }
  }

  const configuredDefault = settings?.defaultModel?.trim() || ''
  const defaultModel = configuredDefault || readLocalOmpDefaultModel(resolveOmpAgentDir(profile))

  const ompCommand = resolveExecutable('omp')
  if (!ompCommand) {
    return { models: [], defaultModel, message: '本机未检测到 omp CLI。' }
  }

  try {
    const entries = await runOmpModelsLs(ompCommand, profile)
    const models = entries
      .filter((entry): entry is OmpModelEntry & { provider: string; id: string } => Boolean(entry.provider?.trim() && entry.id?.trim()))
      .map((entry) => buildOmpExecutionModelOption(entry.provider, entry.id, defaultModel))

    if (configuredDefault && !models.some((model) => model.id === configuredDefault)) {
      const slashIndex = configuredDefault.indexOf('/')
      models.unshift(buildOmpExecutionModelOption(
        slashIndex > 0 ? configuredDefault.slice(0, slashIndex) : 'omp',
        slashIndex > 0 ? configuredDefault.slice(slashIndex + 1) : configuredDefault,
        defaultModel,
      ))
    }

    if (models.length === 0) {
      return {
        models,
        defaultModel,
        message: profile
          ? `omp profile "${profile}" 还没有已授权的模型，请先用该 profile 在 omp 中登录 provider。`
          : 'omp 还没有已授权的模型，请先在 omp 中登录 provider。',
      }
    }
    return { models, defaultModel }
  } catch (error) {
    const models: ExecutionModelOption[] = []
    if (configuredDefault) {
      const slashIndex = configuredDefault.indexOf('/')
      models.push(buildOmpExecutionModelOption(
        slashIndex > 0 ? configuredDefault.slice(0, slashIndex) : 'omp',
        slashIndex > 0 ? configuredDefault.slice(slashIndex + 1) : configuredDefault,
        defaultModel,
      ))
    }
    return {
      models,
      defaultModel,
      message: error instanceof Error ? error.message : 'omp 模型列表读取失败。',
    }
  }
}
