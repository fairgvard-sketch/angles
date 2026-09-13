import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccountProblem, AuthEntry, PasswordRecovery } from './AccountAuth.jsx'

test('sign-in offers reset and confirmation without imposing new password length on old accounts', () => {
  const html = renderToStaticMarkup(h(AuthEntry, { client: {} }))
  assert.match(html, /Forgot password/)
  assert.match(html, /Resend confirmation email/)
  assert.match(html, /autoComplete="current-password"/)
  assert.doesNotMatch(html, /minLength=/)
})
test('reset form does not ask for the forgotten password', () => {
  const html = renderToStaticMarkup(h(AuthEntry, { client: {}, initialMode: 'reset' }))
  assert.match(html, /Send reset link/)
  assert.doesNotMatch(html, /type="password"/)
})
test('signup sets the new password requirement and confirmation has an email form', () => {
  const html = renderToStaticMarkup(h(AuthEntry, { client: {}, initialMode: 'signup' }))
  assert.match(html, /minLength="8"/)
  const confirm = renderToStaticMarkup(h(AuthEntry, { client: {}, initialMode: 'confirm' }))
  assert.match(confirm, /Resend confirmation/)
  assert.match(confirm, /type="email"/)
})
test('recovery names the account and requires matching password entries', () => {
  const html = renderToStaticMarkup(h(PasswordRecovery, { session: { user: { email: 'owner@example.test' } }, controller: {} }))
  assert.match(html, /owner@example.test/)
  assert.equal((html.match(/autoComplete="new-password"/g) || []).length, 2)
  assert.match(html, /Cancel and sign out/)
})
test('invalid confirmation link offers another confirmation, not workspace access', () => {
  const html = renderToStaticMarkup(h(AccountProblem, { state: { status: 'recovery-error', callbackMode: 'confirm' }, controller: {}, client: {} }))
  assert.match(html, /role="alert"/)
  assert.match(html, /Resend confirmation/)
  assert.doesNotMatch(html, /Continue to workspace/)
})
