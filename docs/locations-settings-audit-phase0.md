# Phase 0 — фактическая архитектура перед Release A

Аудит по `docs/claude-locations-settings-rearchitecture-plan.md`, раздел
«Phase 0 — mandatory audit and stop report». Снимок на 08.08.2026.

Проверялись два репозитория: кабинет (`anglesite/backoffice`) и касса
(`~/Desktop/kassa` — схема, RPC, Edge Function, рендер чека).

## 1. Поля точки и их настоящий скоуп

Всё, что сегодня правит раздел Locations, лежит на **строке `locations`**,
то есть скоупится точкой, а не организацией и не юрлицом.

| Поле формы | Хранилище | RPC записи | Реальный скоуп |
|---|---|---|---|
| Location name | `locations.name` | `update_location_config_web` | точка |
| Display name | `locations.settings.display_name` | `patch_location_settings_web` | точка |
| Service mode | `locations.service_mode` | `update_location_config_web` | точка |
| VAT rate | `locations.vat_rate` | `update_location_config_web` | точка |
| Business name (чек) | `locations.receipt_business_name` | `update_location_config_web` | точка |
| Tax ID | `locations.receipt_tax_id` | `update_location_config_web` | точка |
| Business address | `locations.receipt_address` | `update_location_config_web` | точка |
| Phone | `locations.receipt_phone` | `update_location_config_web` | точка |
| Receipt footer | `locations.receipt_footer` | `update_location_config_web` | точка |
| Print modifiers | `locations.settings.receipt.print_modifiers` | `patch_location_settings_web` | точка |
| Receipt copies | `locations.settings.receipt.copies` | `patch_location_settings_web` | точка |
| Loyalty mode/goal/percent/min redeem | `locations.loyalty_*` | `update_location_config_web` | **точка** |
| Категории, дающие штампы | `menu_categories.loyalty_stamps` | прямой UPDATE через RLS | категория (у категории есть `location_id`) |
| Opening float / close reminder / day cutoff / cash warn | `locations.settings.shift.*` | `patch_location_settings_web` | точка |
| All items tab / Inventory | `locations.settings.interface.*` | `patch_location_settings_web` | точка |

Читается всё одним `fetchLocation` (`settings.js`) напрямую из таблицы под RLS.

Организационных полей, которые можно было бы поднять в Settings, в схеме
**нет**: `get_backoffice_context` отдаёт про организацию только `id`, `name`
и `account_type`, а RPC записи в `organizations` не существует ни одного
(`grep 'UPDATE organizations'` по всем миграциям — пусто).

Валюта и часовой пояс точки (`locations.currency`, `locations.timezone`)
читаются, но `update_location_config_web` их не принимает — они
редактируемыми быть не могут.

## 2. Авторизация правки и выгрузки

Единый гейт — `require_backoffice_or_staff(session, perm)` (091, ужесточён 096).

| Действие | RPC | Право |
|---|---|---|
| Колонки точки (в т.ч. Tax ID и лояльность) | `update_location_config_web` | `manage` |
| JSONB-настройки точки | `patch_location_settings_web` | `manage` |
| УФ 1.31: реквизиты | `uf_export_info_web` | `manage` |
| УФ 1.31: лента документов | `uf_export_documents_web` | `manage` |
| Категории лояльности | `menu_categories` UPDATE | RLS по org |

`manage` по умолчанию имеет уровень `manager`: **owner и manager правят Tax ID
уже сегодня**, accountant — нет. Скоуп точки проверяется явно
(`org_id = auth_org_id()` в каждом web-варианте), не только RLS.

Вывод для Release A: фискальная выгрузка и правка реквизитов защищены **одним
и тем же** правом. Отдельного «строгого» права под выгрузку нет — при переносе
Fiscal в Reports гейт остаётся прежним (`pos_operate` в навигации, `manage` на
сервере).

## 3. Снапшот реквизитов в выпущенных документах — ЕГО НЕТ

Проверено по коду, а не по документации.

**Снапшотится в документе:** `orders.subtotal`, `vat_rate`, `vat_amount`,
`total`, `discount_amount`, `loyalty_discount`, `receipt_number`, `doc_type`,
`buyer_name`, `buyer_tax_id`, имена и цены позиций (`order_items`), платежи.
Возврат берёт ставку НДС из своего заказа (`o.vat_rate`), состав — из
`refunds.items`.

**НЕ снапшотится:** личность эмитента — название бизнеса, Tax ID, адрес.
Колонки `receipt_*` появились в 019 только на `locations` и живут там до сих
пор; ни одна миграция не кладёт их копию в заказ, возврат или отдельную
таблицу документов.

## 4. Печать и повторная печать читают живую строку точки

`src/features/receipt/printCanvas.ts:154,356,536` и
`src/features/receipt/ReceiptSheet.tsx:183`:

```js
const businessName = location?.receipt_business_name || location?.name || ''
```

`location` — текущая строка точки, не сохранённый в заказе слепок. Значит
повторная печать вчерашнего чека после смены названия напечатает **новое**
название.

## 5. Выгрузка Единого формата читает живую конфигурацию точки

`uf_export_info_for(location)` (миграция 107, ядро для 073):

```sql
SELECT jsonb_build_object(
  'business_name', COALESCE(l.receipt_business_name, l.name),
  'address',       l.receipt_address,
  'tax_id',        l.receipt_tax_id, ...)
FROM locations l WHERE l.id = p_location;
```

Edge Function `uniform-format-export` кладёт это в `ExportConfig` как `taxId`,
`businessName`, `businessStreet`, `vendorTaxId`, `vendorName`. То есть **набор
за прошлый год будет выгружен с сегодняшними реквизитами**. Суммы, НДС и
номера документов при этом историчны — они из снапшотов заказа.

### Release-blocking риск (по правилу 3 плана)

> Выпущенные документы читают изменяемые поля точки в момент рендера и
> экспорта.

Последствия: смена `receipt_tax_id`/`receipt_business_name`/`receipt_address`
задним числом меняет содержимое уже выпущенных חשבונית и уже сданных наборов
מבנה אחיד. Для израильского требования неизменности выпущенного документа это
дефект, и он существует **сегодня, до всякой перестройки**.

Что это значит для Release A:

- Release A **не переносит и не расширяет** правку легальных полей: Tax ID,
  legal name и адрес остаются ровно там же (точка), с тем же RPC и тем же
  правом. Запрет плана «stop before moving/editing legal fields» не нарушается.
- Формулировку «изменения влияют только на будущие чеки» добавлять **нельзя** —
  она была бы ложью. Вместо неё в разделе стоит честное предупреждение.
- Снапшот эмитента и Legal entities — предмет Release B, и без него заявлять
  соответствие нельзя (`docs/israel-compliance.md`, подтверждение
  רואה חשבון/יועץ מס).

## 6. Лояльность: скоуп баланса и правил

- **Правила** — на точке: `locations.loyalty_mode`, `loyalty_stamps_goal`,
  `loyalty_points_percent`, `loyalty_points_min_redeem`.
- **Категории, дающие штампы** — на категории (`menu_categories.loyalty_stamps`),
  а у категории есть своя `location_id`; форма и фильтрует их по точке.
- **Балансы гостя** — на `guests` по организации; `get_guest_card` (115)
  отдаёт `loyalty_mode` первой/связанной точки, а кабинет запоминает его из
  первой открытой карточки.
- Начисление и списание живут на кассе (`pay_order`/`apply_loyalty`, 046/113);
  онлайн-заказ только привязывает гостя.

Следствие: программа **пер-локационная при организационном балансе**. Называть
её единой организационной программой в Release A нельзя — раздел обязан
показывать выбранную точку и говорить «Applies to … only».

## 7. Текущий контракт адресов

Адрес — `?view=…&loc=…&tab=…&d=…` плюс фильтры (`st zn sr rg so ch fl`),
разбор в `routing.js`.

| Сегодня | Что открывает |
|---|---|
| `view=sales` | отдельный раздел Sales |
| `view=locations&tab=general` | Locations → General |
| `view=locations&tab=receipt` | Locations → Receipt & tax |
| `view=locations&tab=loyalty` | Locations → Loyalty |
| `view=locations&tab=register` | Locations → Register defaults |
| `view=locations&tab=export` | Locations → Fiscal export |
| `view=guests` | Customers, список |
| `view=guests&tab=duplicates` | Customers, экран дублей |
| `view=settings` | экран аккаунта (в меню аватара) |
| `view=reports` | заглушка «Not built yet», только developer |

Раздела `view=account` в коде **нет** — план называет его так, фактический ключ
`settings`. Ключа `mode` в адресе тоже нет.

## 8. Видимость по capabilities

`visibleNavigation` (navigation.js): `sales` → `pos_reports`; `guests`,
`activity`, `team`, `devices` → `pos_operate`; `locations` и `overview` — всем;
`reports`/`integrations` — `planned`, только developer.

`visibleLocationTabs`: `general` — всем, остальные четыре (`receipt`,
`loyalty`, `register`, `export`) — по `pos_operate`. Menu/Orders/Reserve-аккаунт
видит в Locations только General.

## 9. Грязные файлы, которые нельзя трогать

`git status` в anglesite на момент старта: изменённых отслеживаемых файлов
нет. Неотслеживаемое (не трогать): `IMG_3617.mov`, `IMG_3617-hero.mp4`,
`docs/design-references/`, все `docs/claude-*-plan.md`,
`docs/orders-acceptance-checklist.md`, `docs/orders-audit-phase0.md`,
`docs/reserve-audit-phase0.md`.

## 10. Базовый прогон до правок

```
npm test   → tests 723 · pass 723 · fail 0   (~65 s)
npm run build → ok, account/index-*.js 517.40 kB (gzip 149.54 kB)
```

Первый прогон дал одно падение в браузерном наборе сразу после `pkill` по
процессам Chrome; два последующих прогона зелёные — это известная флака
брошенных процессов Puppeteer, а не регресс.
