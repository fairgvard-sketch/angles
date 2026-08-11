import { visibleReportTabs } from './navigation'
import { PageHeader } from './ui/Layout'
import Tabs from './ui/Tabs'
import SalesOverview from './SalesOverview'
import FiscalExport from './FiscalExport'

/**
 * «Reports» — что произошло и что надо выгрузить.
 *
 * Раздел собран из двух уже существующих экранов и не переписывает ни
 * один из них: Sales остаётся утверждённым отчётом целиком, Fiscal —
 * прежней выгрузкой Единого формата. Появился он потому, что владелец
 * искал набор для бухгалтера в настройках точки: выгрузка стояла пятой
 * вкладкой рядом с быстрыми суммами и порогом наличных.
 *
 * Отдельного пункта Sales в меню больше нет — это была та же страница под
 * другим именем. Прежний адрес `view=sales` открывает эту вкладку
 * (`canonicalRoute` в routing.js).
 */
export default function ReportsSection({
  context, tab: tabFromUrl, onTabChange, locationId, onLocationChange, onNavigate,
}) {
  const tabs = visibleReportTabs(context)
  const tab = tabs.some((t) => t.key === tabFromUrl) ? tabFromUrl : 'sales'

  const strip = tabs.length > 1 ? (
    <Tabs
      className="location-tabs settings-topic-tabs report-tabs"
      label="Report"
      items={tabs.map((t) => ({ key: t.key, label: t.label }))}
      value={tab}
      onChange={onTabChange}
    />
  ) : null

  if (tab === 'fiscal') {
    return (
      <>
        <PageHeader title="Reports" />
        {strip}
        <FiscalExport
          locations={context?.locations || []}
          locationId={locationId}
          onLocationChange={onLocationChange}
          /* Незаполненный ח.פ правится в реквизитах той же точки */
          onOpenReceiptSettings={(id) => onNavigate?.('locations', id, 'receipts')}
        />
      </>
    )
  }

  /*
   * Sales рисует собственную шапку вместе с выгрузкой CSV. Отдавать ему
   * заголовок раздела и полосу вкладок
   * дешевле, чем дублировать его действия здесь: экран не переписан, у
   * него лишь сменилось название строки.
   */
  return <SalesOverview context={context} heading="Reports" tabs={strip} />
}
