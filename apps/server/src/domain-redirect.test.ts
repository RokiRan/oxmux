import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLegacyDomainRedirect } from './domain-redirect'

test('redirects the preview legacy domain and preserves path/query', () => {
  assert.equal(
    resolveLegacyDomainRedirect(
      'http://origin.internal/api/bootstrap?scope=workspaces',
      'vibemux.xyz',
    ),
    'https://oxmux.xyz/api/bootstrap?scope=workspaces',
  )
})

test('redirects production subdomains to the matching oxmux.ai subdomain', () => {
  assert.equal(
    resolveLegacyDomainRedirect('http://origin.internal/chat', 'www.vibemux.com'),
    'https://www.oxmux.ai/chat',
  )
  assert.equal(
    resolveLegacyDomainRedirect('http://origin.internal/health', 'hk.vibemux.com:443'),
    'https://hk.oxmux.ai/health',
  )
})

test('does not redirect canonical, local, or lookalike hosts', () => {
  assert.equal(resolveLegacyDomainRedirect('http://origin.internal/', 'oxmux.ai'), null)
  assert.equal(resolveLegacyDomainRedirect('http://origin.internal/', 'app.vibemux.localtest.me'), null)
  assert.equal(resolveLegacyDomainRedirect('http://origin.internal/', 'notvibemux.xyz'), null)
})
