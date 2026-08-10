import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import QrChannels, { GuestPreview, OnlineTab, ReserveTab } from './QrChannels.jsx'

/**
 * QR-каналы: ровно два канала и ни одной потерянной настройки.
 *
 * Редизайн раздела (`docs/claude-qr-menu-reservations-approved-redesign-plan.md`)
 * переставлял всё: шапку канала, строки настроек, превью. Опасность у
 * такой работы одна — тихо потерять поле. Владелец узнаёт об этом не в
 * день релиза, а тогда, когда ему понадобилось выключить приём заказов
 * или поправить адрес на странице брони.
 *
 * Поэтому тест проверяет не вёрстку, а наличие: вкладок ровно две,
 * тумблер канала — тумблер, а каждая группа настроек на месте и
 * показывает СВОЁ значение, а не пример из макета.
 */

const context = {
  organization: { name: 'Test cafe' },
  locations: [{ id: 'loc-1', name: 'Main', timezone: 'Asia/Jerusalem' }],
  capabilities: ['pos_operate', 'catalog_manage', 'public_menu'],
}

const noop = () => {}

const onlineSettings = {
  online_orders: {
    enabled: true,
    order_types: ['here', 'takeaway'],
    hours: { 0: [['08:00', '20:00']], 1: [['08:00', '20:00']] },
    display_name: 'Bulochka',
    background_url: null,
  },
}

const reserveSettings = {
  reservations: {
    enabled: true,
    slot_min: 30,
    max_party: 12,
    cancel_cutoff_min: 120,
    waitlist: true,
    instant: true,
    combine: true,
    display_name: 'Bulochka',
    schedule: { 0: [['08:00', '20:00']], lead_min: 30, horizon_days: 60 },
  },
}

/** Подписи вкладок в отрендеренной разметке */
function tabLabels(html) {
  return [...html.matchAll(/role="tab"[^>]*>([^<]*)/g)].map((m) => m[1].trim())
}

function renderOnline(props = {}) {
  return renderToStaticMarkup(h(OnlineTab, {
    context,
    locationId: 'loc-1',
    settings: onlineSettings,
    tables: [{ id: 't-1', label: '1', zone: 'Hall', public_token: 'tok-1' }],
    patch: noop,
    slug: 'bulochka',
    onSlugSaved: noop,
    url: 'https://menu.angle.co.il/order/bulochka?source=counter_qr',
    openGroup: null,
    onOpenGroup: noop,
    onManageCatalogue: noop,
    ...props,
  }))
}

function renderReserve(props = {}) {
  return renderToStaticMarkup(h(ReserveTab, {
    locationId: 'loc-1',
    settings: reserveSettings,
    patch: noop,
    slug: 'bulochka',
    tz: 'Asia/Jerusalem',
    businessAddress: 'Allenby 23, Tel Aviv',
    url: 'https://menu.angle.co.il/reserve/bulochka',
    openGroup: null,
    onOpenGroup: noop,
    ...props,
  }))
}

describe('QR-каналы: навигация', () => {
  it('вкладок ровно две, и они те самые', () => {
    const html = renderToStaticMarkup(
      h(QrChannels, { context, locationId: 'loc-1', tab: null, onTabChange: noop })
    )
    assert.deepEqual(tabLabels(html), ['QR menu &amp; ordering', 'Reservations'])
  })

  it('вкладка приходит из адреса, мусор в ней открывает первую', () => {
    const reserve = renderToStaticMarkup(
      h(QrChannels, { context, locationId: 'loc-1', tab: 'reserve', onTabChange: noop })
    )
    assert.match(reserve, /aria-selected="true"[^>]*>Reservations/)

    for (const tab of [null, undefined, 'nope']) {
      const html = renderToStaticMarkup(
        h(QrChannels, { context, locationId: 'loc-1', tab, onTabChange: noop })
      )
      assert.match(
        html,
        /aria-selected="true"[^>]*>QR menu &amp; ordering/,
        `tab=${String(tab)}`
      )
    }
  })

  it('вкладки — настоящий tablist с одной точкой входа с клавиатуры', () => {
    const html = renderToStaticMarkup(
      h(QrChannels, { context, locationId: 'loc-1', tab: 'online', onTabChange: noop })
    )
    assert.match(html, /role="tablist"/)
    // Активная вкладка в обходе табом, соседняя — нет (roving tabindex)
    assert.match(html, /aria-selected="true" tabindex="0"/)
    assert.match(html, /aria-selected="false" tabindex="-1"/)
  })
})

describe('QR-меню: настройки на месте', () => {
  it('канал выключается тумблером, а не только подписью', () => {
    const html = renderOnline()
    assert.match(html, /aria-pressed="true"[^>]*channel-switch|channel-switch[^>]*aria-pressed="true"/)
    assert.match(html, /Ordering is live/)

    const off = renderOnline({ settings: { online_orders: { enabled: false } } })
    assert.match(off, /aria-pressed="false"/)
    assert.match(off, /Ordering is paused/)
    // Выключенный канал честно объясняет, что увидит гость
    assert.match(off, /guests who scan the code see the menu but cannot order/)
  })

  it('ссылка гостя, копирование, QR и открытие страницы доступны сразу', () => {
    const html = renderOnline()
    assert.match(html, /menu\.angle\.co\.il\/order\/bulochka/)
    assert.match(html, /Copy link/)
    assert.match(html, /Download QR/)
    assert.match(html, /Open page/)
    // Автосохранение названо вслух — кнопки «опубликовать» здесь нет
    assert.match(html, /Changes save automatically/)
    assert.doesNotMatch(html, /Publish changes/)
  })

  it('все шесть групп настроек существуют и раскрываются', () => {
    const html = renderOnline()
    for (const title of [
      'Link &amp; address', 'How guests order', 'Opening hours',
      'Look of the guest page', 'Table QR codes', 'Put the menu on your website',
    ]) {
      assert.match(html, new RegExp(title), title)
    }
    assert.equal((html.match(/aria-expanded="false"/g) || []).length, 6)
  })

  it('значение в свёрнутой строке — своё, а не пример из макета', () => {
    const html = renderOnline()
    assert.match(html, /Sun–Mon 08:00–20:00/)      // hours из настроек
    assert.match(html, /Dine in · Takeaway/)        // выбранные типы заказа
    assert.match(html, /1 tables/)                  // столы точки
    assert.doesNotMatch(html, /48 items/)           // цифры из макета
  })

  it('открыта ровно одна группа, и в ней настоящие поля', () => {
    const html = renderOnline({ openGroup: 'look' })
    assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1)
    assert.match(html, /Display name/)
    assert.match(html, /Google review link/)
    assert.match(html, /Instagram/)
    assert.match(html, /Facebook/)
    assert.match(html, /Hero video/)
    assert.match(html, /Menu background/)
  })

  it('ярлык в каталог ведёт в каталог и не редактирует его здесь', () => {
    const html = renderOnline()
    assert.match(html, /Manage catalogue/)
    // Раздела без доступа к каталогу не обещаем
    assert.doesNotMatch(renderOnline({ onManageCatalogue: null }), /Manage catalogue/)
  })
})

describe('Брони: настройки на месте', () => {
  it('канал брони выключается тумблером', () => {
    assert.match(renderReserve(), /Reservations are open/)
    assert.match(renderReserve({ blockerCount: 2 }), /Enabled — setup incomplete/)
    assert.doesNotMatch(renderReserve({ blockerCount: 2 }), /Reservations are open/)
    const off = renderReserve({ settings: { reservations: { enabled: false } } })
    assert.match(off, /Reservations are paused/)
    assert.match(off, /the guest page tells visitors reservations are closed/)
  })

  it('ссылка и QR канала брони помечены источником', () => {
    const html = renderReserve()
    assert.match(html, /menu\.angle\.co\.il\/reserve\/bulochka/)
    assert.match(html, /Download QR/)
  })

  it('пять групп настроек и их собственные значения', () => {
    const html = renderReserve()
    for (const title of [
      'Booking hours', 'Slots &amp; booking window', 'Cancellation &amp; changes',
      'What the guest must know', 'Confirmation', 'Look of the booking page',
    ]) {
      assert.match(html, new RegExp(title), title)
    }
    assert.equal((html.match(/aria-expanded="false"/g) || []).length, 6)
    assert.match(html, /30 min slots · up to 12 guests · 60 days ahead/)
    assert.match(html, /2 hours before · waitlist on/)
    assert.match(html, /Instant/)
  })

  it('правила отмены, лист ожидания и текст политики редактируются', () => {
    const html = renderReserve({ openGroup: 'cutoff' })
    assert.match(html, /Guests can cancel/)
    assert.match(html, /Guests can move the booking/)
    assert.match(html, /Keep a waitlist/)
    assert.match(html, /Cancellation policy shown to the guest/)
  })

  it('правила брони: сводка в свёрнутой строке, список — внутри (Kassa 145)', () => {
    const withRules = {
      reservations: {
        ...reserveSettings.reservations,
        rules: [
          { id: 'a', text: 'Стоимость 289 ₪ с человека', level: 'important' },
          { id: 'b', text: 'Посадка общая', ack: true },
        ],
      },
    }
    const collapsed = renderReserve({ settings: withRules })
    assert.match(collapsed, /2 rules · 1 to confirm/)

    const open = renderReserve({ settings: withRules, openGroup: 'rules' })
    assert.match(open, /Стоимость 289 ₪ с человека/)
    assert.match(open, /Посадка общая/)
    assert.match(open, /Requires a tick/)
    assert.match(open, /Add rule/)
  })

  it('без правил шаг гостю не показывается, и об этом сказано прямо', () => {
    const html = renderReserve({ openGroup: 'rules' })
    assert.match(html, /No rules/)
    assert.match(html, /straight from the time to the contact form/)
  })

  it('мгновенное подтверждение открывает свои условия', () => {
    const html = renderReserve({ openGroup: 'confirm' })
    assert.match(html, /Confirm instantly/)
    assert.match(html, /Combine tables/)
    assert.match(html, /Visit length, minutes/)
    assert.match(html, /Buffer between guests, minutes/)
  })

  it('адрес показывает факт: что увидит гость и чем это задано', () => {
    const html = renderReserve({ openGroup: 'page' })
    assert.match(html, /Allenby 23, Tel Aviv/)
    assert.match(html, /business address/)

    const overridden = renderReserve({
      openGroup: 'page',
      settings: { reservations: { ...reserveSettings.reservations, address: 'Dizengoff 1' } },
    })
    assert.match(overridden, /Dizengoff 1/)
    assert.match(overridden, /override/)
  })

  it('депозита и оплаты в интерфейсе нет', () => {
    for (const group of ['hours', 'window', 'cutoff', 'rules', 'confirm', 'page']) {
      const html = renderReserve({ openGroup: group })
      assert.doesNotMatch(html, /[Dd]eposit/, group)
      assert.doesNotMatch(html, /card|payment/i, group)
    }
  })
})

describe('Превью гостевой страницы', () => {
  it('кадр не грузится, пока раздел не показался, и вне обхода табом', () => {
    const html = renderToStaticMarkup(h(GuestPreview, { url: 'https://menu.angle.co.il/order/x' }))
    // До появления в поле зрения iframe не монтируется вовсе
    assert.doesNotMatch(html, /<iframe/)
    assert.match(html, /Enter preview/)
    assert.match(html, /Refresh preview/)
    assert.match(html, /Open full page/)
  })

  it('оба канала получают своё превью — без второй копии логики кадра', () => {
    const booking = renderToStaticMarkup(h(GuestPreview, {
      url: 'https://menu.angle.co.il/reserve/x',
      title: 'Booking page preview',
      description: 'The page guests open from the booking link.',
      iframeTitle: 'Guest booking page preview',
      openLabel: 'Open booking page',
    }))
    assert.match(booking, /Booking page preview/)
    assert.match(booking, /Open booking page/)
    assert.match(booking, /Enter preview/)
  })
})
