/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: 执行节点记录与 Agent 绑定信息。
 * [OUTPUT]: 节点在线判定与执行节点选项过滤。
 * [POS]: 展示层统一在线判定——托管云节点能力已移除，在线与否只看实时 status，
 *        不存在「按需拉起视为在线」的特例。
 */

import type { ExecutorRecord } from '@shared/types'

/** 执行节点在线判定：仅看实时连接状态。 */
export const isExecutorOnline = (executor?: { status?: string } | null) => executor?.status === 'online'

/**
 * Agent 的有效可用性：运行中心跳在线；或默认执行节点在线；
 * 未配置默认节点（或存量标记匹配不到节点）时要求存在任一在线节点。
 */
export const isAgentAvailable = (params: {
  agentStatus?: string
  defaultExecutorId?: string
  executors?: Array<Pick<ExecutorRecord, 'executorId' | 'status'>>
}): boolean => {
  if (params.agentStatus === 'online') {
    return true
  }
  if (params.agentStatus === 'error') {
    return false
  }

  const defaultExecutorId = params.defaultExecutorId?.trim()
  const executors = params.executors ?? []
  if (!defaultExecutorId) {
    return executors.some((executor) => executor.status === 'online')
  }

  const executor = executors.find((item) => item.executorId === defaultExecutorId)
  return executor
    ? executor.status === 'online'
    : executors.some((item) => item.status === 'online')
}

/** 执行节点选项过滤：默认只留 online/paired，可选包含 offline。 */
export const buildExecutorOptions = (
  executors: ExecutorRecord[],
  options?: {
    includeOffline?: boolean
  },
) => {
  const includeOffline = options?.includeOffline ?? false
  return executors.filter((executor) => (
    executor.status === 'online' || executor.status === 'paired' || (includeOffline && executor.status === 'offline')
  ))
}
