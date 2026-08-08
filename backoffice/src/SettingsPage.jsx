import { LogOut } from 'lucide-react'
import { visibleSettingsTabs } from './navigation'
import ProductsCard from './ProductsCard'
import { PageHeader } from './ui/Layout'
import Tabs from './ui/Tabs'

/**
 * «Settings» — как устроены организация и мой аккаунт.
 *
 * Раньше это был один экран с почтой, кнопкой выхода и карточкой
 * продуктов, и всё, что относилось к бизнесу, приходилось искать в
 * настройках точки. Теперь у раздела три вопроса: что за организация
 * (Business), что ей подключено (Products) и кто я в ней (Account).
 *
 * Чего здесь нет и почему:
 *   • Tax ID — он хранится на точке, а не на организации; показать его
 *     здесь значило бы соврать про скоуп (Locations → Receipts & tax);
 *   • Legal & tax — модели юрлиц не существует, пустая вкладка обещала
 *     бы её наличие;
 *   • фискальная выгрузка — это отчёт, её место в Reports;
 *   • смена пароля, MFA, список сессий — таких потоков в кабинете нет, а
 *     нерабочее поле в настройках хуже, чем его отсутствие.
 *
 * Всё, что показано в Business, — read-only, и это сказано прямо: RPC на
 * запись в `organizations` в схеме нет ни одного (Phase 0).
 */

const ACCOUNT_TYPE_LABEL = {
  developer: 'Developer workspace',
  demo: 'Demo workspace',
  customer: 'Customer workspace',
}

/** Организация: чем её знает сервер. Ровно то, что отдаёт get_backoffice_context. */
function BusinessTab({ context, onNavigate }) {
  const org = context?.organization
  const locations = context?.locations || []
  const counts = context?.counts || {}

  return (
    <>
      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <h2>Organisation</h2>
            <p>How ANGLE identifies your business across every product.</p>
          </div>
        </div>
        <dl className="settings-facts">
          <div>
            <dt>Business name</dt>
            <dd>{org?.name || '—'}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>{ACCOUNT_TYPE_LABEL[context?.account_type] || 'Customer workspace'}</dd>
          </div>
          <div>
            <dt>Locations</dt>
            <dd>{counts.locations ?? locations.length}</dd>
          </div>
          <div>
            <dt>Team members</dt>
            <dd>{counts.staff ?? '—'}</dd>
          </div>
        </dl>
        {/* Честность вместо кнопки «Save»: поля правда не редактируются,
            и владелец должен знать, к кому идти, а не искать карандаш. */}
        <p className="form-hint">
          These are read-only. Ask your ANGLE contact to change the business
          name or add a location.
        </p>
      </section>

      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <h2>Locations</h2>
            <p>
              Each location is configured on its own — name, receipts, tax
              details and register defaults.
            </p>
          </div>
        </div>
        {locations.length === 0 ? (
          <p className="empty-state">No locations are linked to this account.</p>
        ) : (
          <div className="product-list">
            {locations.map((l) => (
              <div className="product-row" key={l.id}>
                <span>
                  <strong>{l.name}</strong>
                  <small>{[l.currency, l.timezone].filter(Boolean).join(' · ')}</small>
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onNavigate?.('locations', l.id, 'details')}
                >
                  Open settings
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

/** Кто вошёл и как выйти. Ничего, за чем не стоит рабочий поток. */
function AccountTab({ email, context, onSignOut }) {
  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>Signed in</h2>
          <p>This account opens the back office for your organisation.</p>
        </div>
      </div>
      <dl className="settings-facts">
        <div>
          <dt>Email</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{context?.member?.role || '—'}</dd>
        </div>
      </dl>
      <p className="form-hint">
        Roles and access for the rest of your team are managed in Team.
        Register PINs are separate and never leave the terminal.
      </p>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onSignOut}>
          <LogOut aria-hidden /> Sign out
        </button>
      </div>
    </section>
  )
}

export default function SettingsPage({
  email, context, tab: tabFromUrl, onTabChange, onSignOut, onReloadContext, onNavigate,
}) {
  const tabs = visibleSettingsTabs(context)
  const tab = tabs.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'business'

  return (
    <>
      <PageHeader title="Settings" />
      <Tabs
        className="location-tabs settings-topic-tabs"
        label="Settings topic"
        items={tabs.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={onTabChange}
      />

      {tab === 'business' && <BusinessTab context={context} onNavigate={onNavigate} />}
      {tab === 'products' && (
        <ProductsCard context={context} onReloadContext={onReloadContext} />
      )}
      {tab === 'account' && (
        <AccountTab email={email} context={context} onSignOut={onSignOut} />
      )}
    </>
  )
}
