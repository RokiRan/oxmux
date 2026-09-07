// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Node process environment + home directory 文件系统状态（仅 server / worker 使用；web 不得 import 本模块）。
// [OUTPUT]: worker / agent 主数据目录（home）的解析：新目录 `~/.oxmux*` 优先，存量 `~/.vibemux*` 沿用。
// [POS]: 品牌迁移兼容层（Phase 3）。保证 worker 配置目录与 agent workdir 使用同一解析结果，避免两侧分叉。

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type OxmuxHomeProfile = 'development' | 'preview' | 'production'

const HOME_SUFFIXES: Record<OxmuxHomeProfile, string> = {
  development: '-dev',
  preview: '-preview',
  production: '',
}

const buildHomeCandidates = (profile: OxmuxHomeProfile) => {
  const suffix = HOME_SUFFIXES[profile]
  return {
    oxmuxHome: path.join(os.homedir(), `.oxmux${suffix}`),
    legacyHome: path.join(os.homedir(), `.vibemux${suffix}`),
  }
}

/**
 * 兼容窗口：新目录 `~/.oxmux*` 优先；存量 `~/.vibemux*` 目录沿用（避免丢失配对与配置）；
 * 两者都不存在时使用新目录（新装默认 oxmux 品牌）。
 */
export const resolveOxmuxHomeDir = (profile: OxmuxHomeProfile = 'production'): string => {
  const { oxmuxHome, legacyHome } = buildHomeCandidates(profile)
  if (existsSync(oxmuxHome)) {
    return oxmuxHome
  }
  if (existsSync(legacyHome)) {
    return legacyHome
  }
  return oxmuxHome
}

export const isOxmuxHomePath = (value?: string): boolean => {
  const normalized = path.resolve(value?.trim() || '')
  return Object.values(HOME_SUFFIXES).some((suffix) => {
    const oxmuxHome = path.join(os.homedir(), `.oxmux${suffix}`)
    const legacyHome = path.join(os.homedir(), `.vibemux${suffix}`)
    return normalized === oxmuxHome || normalized === legacyHome
  })
}
