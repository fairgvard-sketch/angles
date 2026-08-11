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
 * настройках точки. Теперь у раздела три вопроса: что за рабочее
 * пространство (Workspace), что ему подключено (Plans & products) и
 * кто я в нём (Account).
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
 * Всё, что показано в Workspace, — read-only, и это сказано прямо: RPC на
 * запись в `organizations` в схеме нет ни одного (Phase 0).
 */

const ACCOUNT_TYPE_LABEL = {
  developer: 'Developer workspace',
  demo: 'Demo workspace',
  customer: 'Customer workspace',
}

/** Рабочее пространство: ровно то, что отдаёт get_backoffice_context. */
function WorkspaceTab({ context }) {
  const org = context?.organization
  const counts = context?.counts || {}

  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>Workspace</h2>
          <p>The organisation your ANGLE products and team belong to.</p>
        </div>
      </div>
      <dl className="settings-facts">
        <div>
          <dt>Business name</dt>
          <dd>{org?.name || '—'}</dd>
        </div>
        <div>
          <dt>Workspace type</dt>
          <dd>{ACCOUNT_TYPE_LABEL[context?.account_type] || 'Customer workspace'}</dd>
        </div>
        <div>
          <dt>Team members</dt>
          <dd>{counts.staff ?? '—'}</dd>
        </div>
      </dl>
      {/* Честность вместо кнопки «Save»: поля правда не редактируются,
          и владелец должен знать, к кому идти, а не искать карандаш. */}
      <p className="form-hint">
        Workspace identity is read-only. Location names, receipt details and
        register defaults are managed in Locations.
      </p>
    </section>
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
  email, context, tab: tabFromUrl, onTabChange, onSignOut, onReloadContext,
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

      {tab === 'business' && <WorkspaceTab context={context} />}
      {tab === 'products' && (
        <ProductsCard context={context} onReloadContext={onReloadContext} />
      )}
      {tab === 'account' && (
        <AccountTab email={email} context={context} onSignOut={onSignOut} />
      )}
    </>
  )
}
