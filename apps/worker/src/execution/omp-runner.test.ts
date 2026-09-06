// [INPUT]: resolveOmpProfile 输入
// [OUTPUT]: profile 派生断言
// [POS]: omp runner profile 隔离契约测试
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveOmpProfile } from './omp-runner'

test('resolveOmpProfile prefers explicitly configured profile', () => {
  assert.equal(resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: 'team-shared' }, 'user-1'), 'team-shared')
})

test('resolveOmpProfile derives isolated profile from actingUserId when not configured', () => {
  assert.equal(resolveOmpProfile({ _runtime: 'Omp', defaultModel: '' }, 'user-abc-123'), 'wemux-user-abc-123')
  assert.equal(resolveOmpProfile(undefined, 'user-abc-123'), 'wemux-user-abc-123')
})

test('resolveOmpProfile sanitizes unsafe characters in actingUserId', () => {
  assert.equal(resolveOmpProfile(undefined, 'user/with space@example.com'), 'wemux-user-with-space-example-com')
})

test('resolveOmpProfile returns empty when neither configured nor derivable', () => {
  assert.equal(resolveOmpProfile(undefined, undefined), '')
  assert.equal(resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: '  ' }, ' '), '')
})
test('resolveOmpProfile rejects configured profiles that escape the profiles directory scope', () => {
  assert.throws(() => resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: '../evil' }, 'user-1'), /omp profile/)
  assert.throws(() => resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: 'a/b' }, 'user-1'), /omp profile/)
  assert.throws(() => resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: '..' }, 'user-1'), /omp profile/)
  assert.throws(() => resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: '.' }, 'user-1'), /omp profile/)
  assert.throws(() => resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: '/etc/passwd' }, 'user-1'), /omp profile/)
  assert.throws(() => resolveOmpProfile({ _runtime: 'Omp', defaultModel: '', profile: '..\\evil' }, 'user-1'), /omp profile/)
})
