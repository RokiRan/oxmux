// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Worker 启动期域名可达性探测结果 + 默认 cloud URL。
// [OUTPUT]: 品牌迁移兼容窗口的默认 cloud URL：`oxmux.ai/.xyz` 优先，不可达时回退 `vibemux.com/.xyz`。
// [POS]: Worker 默认连接地址解析；oxmux 域名未上线期间保证新装 worker 仍可配对到旧控制面。

import { lookup } from 'node:dns/promises'

export const OXMUX_PRODUCTION_CLOUD_URL = 'https://oxmux.ai'
export const LEGACY_PRODUCTION_CLOUD_URL = 'https://oxmux.com'
export const OXMUX_PREVIEW_CLOUD_URL = 'https://oxmux.xyz'
export const LEGACY_PREVIEW_CLOUD_URL = 'https://oxmux.xyz'

type ReachabilityProbe = (url: string) => Promise<boolean>

const probeHostResolvable = async (url: string): Promise<boolean> => {
  try {
    await lookup(new URL(url).hostname, { verbatim: true })
    return true
  } catch {
    return false
  }
}

let probeImpl: ReachabilityProbe = probeHostResolvable
let cachedOxmuxReachable: boolean | null = null

/** 测试注入：替换可达性探测实现。 */
export const __setReachabilityProbeForTest = (impl: ReachabilityProbe | null) => {
  probeImpl = impl ?? probeHostResolvable
  cachedOxmuxReachable = null
}

/**
 * 启动期探测一次 oxmux 主域名是否可达，结果缓存。
 * 在 worker main 早期调用；help/version 等快速路径可跳过。
 */
export const warmDefaultCloudUrlFallback = async (): Promise<boolean> => {
  if (cachedOxmuxReachable !== null) {
    return cachedOxmuxReachable
  }
  cachedOxmuxReachable = await probeImpl(OXMUX_PRODUCTION_CLOUD_URL)
  return cachedOxmuxReachable
}

/**
 * 对默认 cloud URL 应用回退：仅当探测已执行且 oxmux 不可达时，
 * 把 oxmux.ai / oxmux.xyz 默认值映射回 vibemux.com / vibemux.xyz。
 * 显式 env 覆盖与已保存配对不受影响（它们不经过此函数）。
 */
export const resolveDefaultCloudUrl = (candidate: string): string => {
  if (cachedOxmuxReachable === false) {
    if (candidate === OXMUX_PRODUCTION_CLOUD_URL) {
      return LEGACY_PRODUCTION_CLOUD_URL
    }
    if (candidate === OXMUX_PREVIEW_CLOUD_URL) {
      return LEGACY_PREVIEW_CLOUD_URL
    }
  }
  return candidate
}
