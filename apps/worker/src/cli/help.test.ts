import assert from 'node:assert/strict'
import test from 'node:test'

import { getCliName, isCanonicalCliName, renderRootHelp, renderTopicHelp } from './help'

test('root help presents worker as a first-class resource', () => {
  const help = renderRootHelp('oxmux', '1.2.3')

  assert.match(help, /oxmux CLI 1\.2\.3/)
  assert.match(help, /Resources:/)
  assert.match(help, /worker\s+Manage the local worker/)
  assert.match(help, /project\s+Manage projects/)
  assert.doesNotMatch(help, /Worker commands:/)
  assert.doesNotMatch(help, /Advanced commands:/)
})

test('worker help contains lifecycle and advanced commands under one namespace', () => {
  const help = renderTopicHelp('oxmux', 'worker')

  assert.match(help || '', /worker connect --pairing-code/)
  assert.match(help || '', /worker service/)
  assert.match(help || '', /worker mcp-stdio/)
})

test('topic help supports nested workspace session commands', () => {
  const help = renderTopicHelp('oxmux', 'workspace', 'session list')

  assert.match(help || '', /workspace session list <task-id>/)
})

test('resource help covers inbox, drive and chat', () => {
  const inbox = renderTopicHelp('oxmux', 'inbox')
  assert.match(inbox || '', /inbox list/)
  assert.match(inbox || '', /inbox reply <item-id>/)

  const drive = renderTopicHelp('oxmux', 'drive')
  assert.match(drive || '', /drive list/)
  assert.match(drive || '', /drive write <name>/)

  const chat = renderTopicHelp('oxmux', 'chat')
  assert.match(chat || '', /chat conversations/)
  assert.match(chat || '', /chat channel send/)
})

test('CLI uses one canonical name', () => {
  assert.equal(getCliName('oxmux'), 'oxmux')
  assert.equal(getCliName('vbx'), 'vbx')
  assert.equal(getCliName('vibemux'), 'vibemux')
  // daemon package bins and unknown invocations fall back to the brand default
  assert.equal(getCliName('oxmux-worker'), 'oxmux')
  assert.equal(getCliName('vibemux-worker'), 'oxmux')
  assert.equal(getCliName(), 'oxmux')
})

test('canonical CLI names cover oxmux and legacy aliases only', () => {
  assert.equal(isCanonicalCliName('oxmux'), true)
  assert.equal(isCanonicalCliName('vbx'), true)
  assert.equal(isCanonicalCliName('vibemux'), true)
  assert.equal(isCanonicalCliName('oxmux-worker'), false)
  assert.equal(isCanonicalCliName('vibemux-worker'), false)
  assert.equal(isCanonicalCliName(undefined), false)
})
