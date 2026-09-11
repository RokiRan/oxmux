import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { repairPackagedOpencodePostinstall, resolveOpencodeExecutable } from './opencode-runtime'

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

    const repairs = repairPackagedOpencodePostinstall(process.cwd(), [tempDir])
    const repair = repairs.find((item) => item.dir === packageDir)
    assert.ok(repair, 'expected repair entry for bundled opencode-ai package')
    assert.equal(repair.ok, true, repair.detail)
    assert.equal(readFileSync(markerPath, 'utf8'), 'ok')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('repairPackagedOpencodePostinstall skips directories without postinstall script', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-opencode-repair-empty-'))
  try {
    assert.deepEqual(repairPackagedOpencodePostinstall(process.cwd(), [tempDir]), [])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
