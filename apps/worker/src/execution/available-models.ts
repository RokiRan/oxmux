// [INPUT]: 各 runtime 可用模型源
// [OUTPUT]: 模型清单
// [POS]: 可用模型列表
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Task } from '@shared/types'
import { CLAUDE_CODE_MODEL_IDS } from '@shared/agent-config'
import { loadWorkerConfig } from '../core/config'
import { listWorkerAvailableCodexModels } from './codex-models'
import { listWorkerAvailableModels as listWorkerOpenCodeModels } from './opencode'
import { listWorkerAvailablePiModels } from './pi-models'
import { listWorkerAvailableOmpModels } from './omp-models'
import type { ExecutionModelOption } from '@shared/types'

const listClaudeCodeModels = (): { models: ExecutionModelOption[]; defaultModel?: string; message?: string } => {
  const models: ExecutionModelOption[] = CLAUDE_CODE_MODEL_IDS.map((id) => ({
    id,
    label: id,
    providerId: 'anthropic',
    modelId: id,
    isDefault: id === 'default',
  }))
  return { models, defaultModel: 'default' }
}

export interface WorkerAvailableModelSnapshot {
  models: ExecutionModelOption[]
  defaultModel?: string
  message?: string
}

export const listWorkerAvailableModels = async (
  agentType?: Task['agentType'],
  options?: { actingUserId?: string },
): Promise<WorkerAvailableModelSnapshot> => {
  const config = loadWorkerConfig()

  if (agentType === 'Codex') {
    return listWorkerAvailableCodexModels(config)
  }

  if (agentType === 'ClaudeCode') {
    return listClaudeCodeModels()
  }

  if (agentType === 'Pi') {
    return listWorkerAvailablePiModels(config)
  }
  if (agentType === 'Omp') {
    // omp 只枚举已授权 provider 的模型（omp models ls 天然过滤静态目录）；模型按 profile 隔离
    return listWorkerAvailableOmpModels(config, options?.actingUserId)
  }

  return listWorkerOpenCodeModels()
}
