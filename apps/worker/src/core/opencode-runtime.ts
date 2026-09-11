// [INPUT]: OpenCode 运行时输入
// [OUTPUT]: 就绪检测、打包 postinstall 自愈（repairPackagedOpencodePostinstall）
// [POS]: OpenCode 运行时
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import path from 'node:path'
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
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
  shimRepaired?: boolean
  platformPackageRestored?: string
}

// 与 opencode-ai postinstall.mjs 相同的平台包优先级（baseline/musl 变体兜底）
export const resolveOpencodePlatformPackageNames = (optionalDependencies: Record<string, string>) => {
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const base = `opencode-${platform}-${process.arch}`
  const names = [base]
  if (platform === 'linux') {
    names.push(`${base}-musl`)
  }
  if (process.arch === 'x64') {
    names.push(`${base}-baseline`, `${base}-baseline-musl`)
  }
  return names.filter((name) => optionalDependencies[name])
}

// server 模式运行时需要平台包作为 node_modules 兄弟包存在（实证：仅拷贝裸二进制时
// prompt_async 必报 no such column: replacement_seq）。缺失时按 postinstall 的
// 兜底方式装到临时 prefix 再拷回 worker 根的 node_modules。
const restoreOpencodePlatformPackage = (packageDir: string, optionalDependencies: Record<string, string>) => {
  const workerNodeModules = path.dirname(packageDir)
  for (const name of resolveOpencodePlatformPackageNames(optionalDependencies)) {
    const targetDir = path.join(workerNodeModules, name)
    if (existsSync(path.join(targetDir, 'package.json'))) {
      return name
    }
    const tempPrefix = mkdtempSync(path.join(os.tmpdir(), 'oxmux-opencode-install-'))
    try {
      const install = runCommand(
        'npm',
        ['install', '--ignore-scripts', '--no-save', '--loglevel=error', '--prefix', tempPrefix, `${name}@${optionalDependencies[name]}`],
        { timeout: 180000 },
      )
      const staged = path.join(tempPrefix, 'node_modules', name)
      if (!install.ok || !existsSync(path.join(staged, 'package.json'))) {
        continue
      }
      cpSync(staged, targetDir, { recursive: true })
      return name
    } finally {
      rmSync(tempPrefix, { recursive: true, force: true })
    }
  }
  return ''
}

const OPENCODE_STUB_MARKER = 'postinstall script was not run'

// tgz 分发时 node_modules/.bin/opencode 也是同一个报错 stub；postinstall 只替换
// opencode-ai/bin/opencode.exe，不会动 .bin shim。postinstall 成功后若 shim 仍是 stub，
// 换成指向真身二进制的符号链接，否则 resolveOpencodeExecutable 命中的还是 stub。
const refreshOpencodeBinStubShim = (packageDir: string) => {
  if (process.platform === 'win32') {
    return false
  }
  const shimPath = path.join(packageDir, '..', '.bin', 'opencode')
  try {
    if (!existsSync(shimPath) || lstatSync(shimPath).isSymbolicLink()) {
      return false
    }
    if (!readFileSync(shimPath, 'utf8').includes(OPENCODE_STUB_MARKER)) {
      return false
    }
    rmSync(shimPath)
    symlinkSync(path.join('..', 'opencode-ai', 'bin', 'opencode.exe'), shimPath)
    return true
  } catch {
    return false
  }
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
      // 先补平台兄弟包再跑 postinstall：postinstall 的 require.resolve 路径依赖它
      let platformPackageRestored = ''
      try {
        const pkgJson = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { optionalDependencies?: Record<string, string> }
        if (pkgJson.optionalDependencies) {
          platformPackageRestored = restoreOpencodePlatformPackage(dir, pkgJson.optionalDependencies)
        }
      } catch {
        // package.json 不可读时仍尝试 postinstall 兜底
      }
      const result = runCommand(process.execPath, [path.join(dir, 'postinstall.mjs')], { cwd: dir, timeout: 180000 })
      const shimRepaired = result.ok ? refreshOpencodeBinStubShim(dir) : false
      return { dir, ok: result.ok, detail: getCommandDetail(result, 'opencode-ai postinstall failed'), shimRepaired, platformPackageRestored }
    })
}
