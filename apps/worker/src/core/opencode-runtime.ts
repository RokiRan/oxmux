// [INPUT]: OpenCode 运行时输入
// [OUTPUT]: 就绪检测、打包 postinstall 自愈（repairPackagedOpencodePostinstall）
// [POS]: OpenCode 运行时
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import path from 'node:path'
import { existsSync } from 'node:fs'
import { getWorkerAppRoot, getWorkerNpmInstallPrefix } from './app-root'
import { getCommandDetail, resolveExecutable, runCommand } from './command-utils'

const getOpencodeBinaryName = () => {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode'
}

const pushUnique = (items: string[], item: string) => {
  if (!items.includes(item)) {
    items.push(item)
  }
}

const addNodeModuleCandidates = (candidates: string[], root: string) => {
  if (!root) {
    return
  }

  pushUnique(candidates, path.join(root, 'node_modules', '.bin', 'opencode'))
  pushUnique(candidates, path.join(root, 'node_modules', 'opencode-ai', 'bin', getOpencodeBinaryName()))
}

export const buildPackagedOpencodeCandidates = (workspaceRoot: string) => {
  const candidates: string[] = []
  const workerAppRoot = getWorkerAppRoot()
  const workerNpmPrefix = getWorkerNpmInstallPrefix()

  addNodeModuleCandidates(candidates, workspaceRoot)
  addNodeModuleCandidates(candidates, workerAppRoot)
  addNodeModuleCandidates(candidates, workerNpmPrefix)

  return candidates
}

export const resolvePackagedOpencodeExecutable = (workspaceRoot: string) => {
  return buildPackagedOpencodeCandidates(workspaceRoot)
    .map((candidate) => resolveExecutable(candidate))
    .find(Boolean) || null
}

export const resolveOpencodeExecutable = (workspaceRoot = process.cwd()) => {
  return resolveExecutable('opencode') || resolvePackagedOpencodeExecutable(workspaceRoot)
}

const resolveOpencodeRepairRoots = (workspaceRoot: string) => {
  const roots: string[] = []
  for (const root of [workspaceRoot, getWorkerAppRoot(), getWorkerNpmInstallPrefix()]) {
    if (root) {
      pushUnique(roots, root)
    }
  }
  return roots
}

export type OpencodePostinstallRepair = {
  dir: string
  ok: boolean
  detail: string
}

// 打包分发（tgz 内置 node_modules 或直接拷贝依赖）会跳过 opencode-ai 的 postinstall，
// 平台专属二进制因此缺失，opencode serve 直接退出。检测到该报错时补跑 postinstall 自愈。
export const repairPackagedOpencodePostinstall = (
  workspaceRoot = process.cwd(),
  roots = resolveOpencodeRepairRoots(workspaceRoot),
): OpencodePostinstallRepair[] => {
  return roots
    .map((root) => path.join(root, 'node_modules', 'opencode-ai'))
    .filter((dir) => existsSync(path.join(dir, 'postinstall.mjs')))
    .map((dir) => {
      const result = runCommand(process.execPath, [path.join(dir, 'postinstall.mjs')], { cwd: dir, timeout: 180000 })
      return { dir, ok: result.ok, detail: getCommandDetail(result, 'opencode-ai postinstall failed') }
    })
}
