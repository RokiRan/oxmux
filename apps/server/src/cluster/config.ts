import os from 'node:os'
import path from 'node:path'
import type { ClusterNode } from '@shared/types'
import { getEnv } from '@shared/env'

const trimTrailingSlash = (value: string) => value.trim().replace(/\/+$/, '')

export const clusterConfig = {
  nodeId: (getEnv('OXMUX_NODE_ID') || os.hostname()).trim(),
  nodeName: (getEnv('OXMUX_NODE_NAME') || os.hostname()).trim(),
  nodeUrl: trimTrailingSlash(getEnv('OXMUX_NODE_URL') || getEnv('OXMUX_PUBLIC_BASE_URL') || ''),
  nodeRelayUrl: trimTrailingSlash(getEnv('OXMUX_NODE_RELAY_URL') || getEnv('OXMUX_NODE_URL') || getEnv('OXMUX_PUBLIC_BASE_URL') || ''),
  sharedToken: (getEnv('OXMUX_CLUSTER_TOKEN') || '').trim(),
  region: (getEnv('OXMUX_NODE_REGION') || '').trim(),
  workspaceDir: path.resolve(process.cwd(), getEnv('OXMUX_WORKSPACE_DIR') || '.vibemux-cluster'),
  maxConcurrentTasks: Number(getEnv('OXMUX_MAX_CONCURRENT_TASKS') || 5),
  version: (process.env.npm_package_version || '0.0.0').trim(),
  capabilities: ['code-execution', 'git-operations'],
}

export const assertClusterTokenConfigured = () => {
  const multiNodeConfigured = Boolean(
    getEnv('OXMUX_NODE_URL')?.trim()
    || getEnv('OXMUX_NODE_RELAY_URL')?.trim()
    || getEnv('OXMUX_EXECUTOR_ROUTE_RULES_JSON')?.trim(),
  )
  if (process.env.NODE_ENV !== 'production' || !multiNodeConfigured || clusterConfig.sharedToken) {
    return
  }

  throw new Error(
    'OXMUX_CLUSTER_TOKEN is required for a production multi-node control plane. All nodes must share the same value.',
  )
}

export const buildLocalNode = (overrides?: Partial<ClusterNode>): ClusterNode => ({
  nodeId: clusterConfig.nodeId,
  name: clusterConfig.nodeName,
  url: clusterConfig.nodeUrl || undefined,
  relayUrl: clusterConfig.nodeRelayUrl || undefined,
  status: 'online',
  capabilities: clusterConfig.capabilities,
  activeTasks: 0,
  maxConcurrentTasks: clusterConfig.maxConcurrentTasks,
  region: clusterConfig.region || undefined,
  hasProjectBinding: false,
  lastHeartbeatAt: new Date().toISOString(),
  version: clusterConfig.version,
  ...overrides,
})
