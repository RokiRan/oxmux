// [INPUT]: 临时 HOME 下的 omp profile config.yml、WorkerConfig 的 Omp 设置
// [OUTPUT]: 枚举期 profile 解析与默认模型读取断言（与执行期 omp-runner 同规则）
// [POS]: omp 模型枚举的 profile 一致性契约测试：保证 UI 枚举的 profile 就是运行时使用的 profile
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { WorkerConfig } from '@shared/types'
import { listWorkerAvailableOmpModels, readLocalOmpDefaultModel, resolveOmpAgentDir } from './omp-models'
import { resolveOmpProfile } from './omp-runner'

const withTempHome = (fn: (home: string) => void) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'omp-models-home-'))
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    fn(home)
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    rmSync(home, { recursive: true, force: true })
  }
}

const seedProfileDefaultModel = (home: string, profile: string, defaultModel: string) => {
  const agentDir = path.join(home, '.omp', 'profiles', profile, 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(path.join(agentDir, 'config.yml'), `modelRoles:\n  default: ${defaultModel}\n`, 'utf8')
}

test('empty configured profile reads default model from the actingUserId-derived profile', () => {
  withTempHome((home) => {
    seedProfileDefaultModel(home, 'oxmux-user-abc', 'derived-provider/derived-model')
    // 与 listWorkerAvailableOmpModels 完全相同的解析式：空配置 → 派生 profile
    const profile = resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: '' }, 'user-abc')
    assert.equal(profile, 'oxmux-user-abc')
    assert.equal(readLocalOmpDefaultModel(resolveOmpAgentDir(profile)), 'derived-provider/derived-model')
  })
})

test('explicit profile reads default model from that profile, ignoring the derived one', () => {
  withTempHome((home) => {
    seedProfileDefaultModel(home, 'team-shared', 'shared-provider/shared-model')
    seedProfileDefaultModel(home, 'oxmux-user-abc', 'derived-provider/derived-model')
    const profile = resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: 'team-shared' }, 'user-abc')
    assert.equal(profile, 'team-shared')
    assert.equal(readLocalOmpDefaultModel(resolveOmpAgentDir(profile)), 'shared-provider/shared-model')
  })
})

test('listWorkerAvailableOmpModels rejects escaping explicit profiles before touching the CLI', async () => {
  const config = {
    agentSettings: { Omp: { _runtime: 'Omp', defaultModel: '', profile: '../evil' } },
  } as unknown as WorkerConfig
  const result = await listWorkerAvailableOmpModels(config, 'user-abc')
  assert.deepEqual(result.models, [])
  assert.match(result.message ?? '', /omp profile/)
})
