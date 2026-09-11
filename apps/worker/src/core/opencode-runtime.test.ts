import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { repairPackagedOpencodePostinstall, resolveOpencodeExecutable, resolveOpencodePlatformPackageNames } from './opencode-runtime'

test('resolveOpencodeExecutable finds Windows npm prefix opencode binary', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-opencode-runtime-'))
  const previousPath = process.env.PATH
  const previousPrefix = process.env.VIBEMUX_WORKER_INSTALL_PREFIX
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

  try {
    const executablePath = path.join(tempDir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
    mkdirSync(path.dirname(executablePath), { recursive: true })
    writeFileSync(executablePath, '')

    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.PATH = ''
    process.env.VIBEMUX_WORKER_INSTALL_PREFIX = tempDir

    assert.equal(resolveOpencodeExecutable(tempDir), executablePath)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }
    if (previousPrefix === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALL_PREFIX
    } else {
      process.env.VIBEMUX_WORKER_INSTALL_PREFIX = previousPrefix
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('repairPackagedOpencodePostinstall runs bundled postinstall script', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-opencode-repair-'))

  try {
    const packageDir = path.join(tempDir, 'node_modules', 'opencode-ai')
    mkdirSync(packageDir, { recursive: true })
    const markerPath = path.join(packageDir, 'postinstall-ran')
    writeFileSync(
      path.join(packageDir, 'postinstall.mjs'),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(markerPath)}, 'ok')\n`,
    )
    // tgz 分发形态：.bin/opencode 与 bin/opencode.exe 都是报错 stub
    const binDir = path.join(tempDir, 'node_modules', '.bin')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(path.join(packageDir, 'bin'), { recursive: true })
    const shimPath = path.join(binDir, 'opencode')
    writeFileSync(shimPath, 'echo "Error: opencode-ai\'s postinstall script was not run." >&2\nexit 1\n')
    writeFileSync(path.join(packageDir, 'bin', 'opencode.exe'), '')

    const repairs = repairPackagedOpencodePostinstall(process.cwd(), [tempDir])
    const repair = repairs.find((item) => item.dir === packageDir)
    assert.ok(repair, 'expected repair entry for bundled opencode-ai package')
    assert.equal(repair.ok, true, repair.detail)
    assert.equal(readFileSync(markerPath, 'utf8'), 'ok')
    if (process.platform !== 'win32') {
      assert.equal(repair.shimRepaired, true, 'stub shim should be replaced')
      assert.ok(lstatSync(shimPath).isSymbolicLink(), 'shim should become a symlink')
      assert.equal(readlinkSync(shimPath), path.join('..', 'opencode-ai', 'bin', 'opencode.exe'))
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('resolveOpencodePlatformPackageNames picks platform package by priority', () => {
  const deps = {
    'opencode-darwin-arm64': '1.17.3',
    'opencode-linux-arm64': '1.17.3',
    'opencode-linux-arm64-musl': '1.17.3',
  }
  const names = resolveOpencodePlatformPackageNames(deps)
  const expectedBase = `opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
  assert.equal(names[0], expectedBase)
  if (process.platform === 'linux') {
    assert.deepEqual(names, [expectedBase, `${expectedBase}-musl`])
  } else {
    assert.deepEqual(names, [expectedBase])
  }
  assert.deepEqual(resolveOpencodePlatformPackageNames({ 'opencode-windows-x64': '1.0.0' }), process.platform === 'win32' && process.arch === 'x64' ? ['opencode-windows-x64'] : [])
})

test('repairPackagedOpencodePostinstall skips directories without postinstall script', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-opencode-repair-empty-'))
  try {
    assert.deepEqual(repairPackagedOpencodePostinstall(process.cwd(), [tempDir]), [])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
