// Reviewed local synthetic-lab schema only. Never infer trust from a filename number.
export const LAB_SCHEMA_VERSION = 169
export const LAB_MIGRATIONS = Object.freeze([
  '165_workspace_onboarding_idempotency.sql',
  '166_subscription_checkout.sql',
  '167_explicit_drawer_slug_privileges.sql',
  '168_digital_account_catalog_boundaries.sql',
  '169_device_identity_boundaries.sql',
])
export function validateLabMigrations(names) {
  const unknown = names.filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)
    && Number(name.split('_')[0]) >= 165 && !LAB_MIGRATIONS.includes(name))
  if (unknown.length) throw new Error('Review changed/new Kassa migrations before extending local labs')
}
