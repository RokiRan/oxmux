// [INPUT]: 存量持久化的执行节点 id
// [OUTPUT]: 历史标记判定
// [POS]: 读边界归一化——托管云节点能力已移除，存量 'managed-cloud:auto' 一律按「未指定执行节点」处理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const LEGACY_MANAGED_CLOUD_AUTO_EXECUTOR_ID = 'managed-cloud:auto'

export const isLegacyManagedCloudAutoExecutorId = (executorId?: string | null) => {
  return executorId?.trim() === LEGACY_MANAGED_CLOUD_AUTO_EXECUTOR_ID
}
