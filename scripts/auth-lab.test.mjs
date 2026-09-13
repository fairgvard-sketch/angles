import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateAuthDatabase, validateAuthMigrations, localDatabaseUri, startAuthLab } from './auth-lab.mjs'

test('Auth lab accepts only an explicit synthetic database name', () => {
  assert.equal(validateAuthDatabase('angle_auth_lab_local_1'), 'angle_auth_lab_local_1')
  for (const name of [undefined, '', 'postgres', 'angle_billing_lab_test', 'angle_auth_lab_',
    'angle_auth_lab_a;DROP DATABASE postgres', 'angle_auth_lab_' + 'a'.repeat(41)]) {
    assert.throws(() => validateAuthDatabase(name))
  }
})
test('Auth lab refuses nonlocal database transports before creating services', () => {
  const target = 'angle_auth_lab_transport'
  assert.equal(new URL(localDatabaseUri('postgresql://user:fake@supabase_db_kassa:5432/postgres?sslmode=disable', target)).pathname, '/' + target)
  for (const uri of ['postgres://user:fake@remote.example/postgres', 'postgres://supabase_db_kassa/another_db',
    'https://supabase_db_kassa/postgres', 'postgres://supabase_db_kassa.attacker.test/postgres']) {
    assert.throws(() => localDatabaseUri(uri, target))
  }
  assert.throws(() => localDatabaseUri('postgres://supabase_db_kassa/postgres', 'postgres'))
})
test('cancelled startup cannot create a database or containers', async () => {
  const abort = new AbortController()
  abort.abort(new Error('cancelled before Docker'))
  await assert.rejects(() => startAuthLab({ database: 'angle_auth_lab_not_created', signal: abort.signal }), /cancelled before Docker/)
})
test('Auth lab refuses newer schema work but never applies untracked space-suffix copies', () => {
  assert.doesNotThrow(() => validateAuthMigrations(['164_baseline.sql', '165_workspace_onboarding_idempotency.sql',
    '165_workspace_onboarding_idempotency 2.sql', '166_subscription_checkout.sql',
    '167_explicit_drawer_slug_privileges.sql', '168_digital_account_catalog_boundaries.sql']))
  assert.throws(() => validateAuthMigrations(['169_new_feature.sql']), /Review/)
  assert.throws(() => validateAuthMigrations(['168_other_implementation.sql']), /Review/)
})
