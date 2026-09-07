import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isOxmuxHomePath, resolveOxmuxHomeDir } from './oxmux-home'

const withHome = async (home: string, run: () => void) => {
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    run()
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
  }
}

test('resolveOxmuxHomeDir prefers the new ~/.oxmux directory when both exist', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'oxmux-home-both-'))
  mkdirSync(path.join(tempHome, '.oxmux'), { recursive: true })
  mkdirSync(path.join(tempHome, '.vibemux'), { recursive: true })
  try {
    withHome(tempHome, () => {
      assert.equal(resolveOxmuxHomeDir('production'), path.join(tempHome, '.oxmux'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('resolveOxmuxHomeDir falls back to an existing legacy ~/.vibemux directory', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'oxmux-home-legacy-'))
  mkdirSync(path.join(tempHome, '.vibemux'), { recursive: true })
  try {
    withHome(tempHome, () => {
      assert.equal(resolveOxmuxHomeDir('production'), path.join(tempHome, '.vibemux'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('resolveOxmuxHomeDir uses the new directory when neither exists', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'oxmux-home-fresh-'))
  try {
    withHome(tempHome, () => {
      assert.equal(resolveOxmuxHomeDir('production'), path.join(tempHome, '.oxmux'))
      assert.equal(resolveOxmuxHomeDir('development'), path.join(tempHome, '.oxmux-dev'))
      assert.equal(resolveOxmuxHomeDir('preview'), path.join(tempHome, '.oxmux-preview'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('isOxmuxHomePath recognizes both new and legacy default homes', () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'oxmux-home-is-'))
  try {
    withHome(tempHome, () => {
      assert.equal(isOxmuxHomePath(path.join(tempHome, '.oxmux')), true)
      assert.equal(isOxmuxHomePath(path.join(tempHome, '.vibemux')), true)
      assert.equal(isOxmuxHomePath(path.join(tempHome, '.oxmux-preview')), true)
      assert.equal(isOxmuxHomePath(path.join(tempHome, '.custom-data')), false)
      assert.equal(existsSync(tempHome), true)
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})
