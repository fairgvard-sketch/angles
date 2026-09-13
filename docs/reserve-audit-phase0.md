# ANGLE Reserve — Phase 0: аудит и измеримый baseline

Дата: 2026-07-31. Кода не менялось: единственный новый файл — эта заметка
(в untracked-каталоге `anglesite/docs/`, рядом с планом).

Источники: `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/database.md`,
`docs/reservations.md`, `docs/standalone-products.md`, миграции `053…116`,
Edge Function `public-reserve`, фронтенд `src/features/reservations/`,
бэкофис `anglesite/backoffice/src/{ReservationsDesk.jsx,reservations.js,QrChannels.jsx,online.js}`.

---

## 1. Состояние репозиториев

| Репо | Ветка | HEAD | Рабочее дерево |
|---|---|---|---|
| `kassa` | `main` | `9c3b560` refresh pos navigation icons | ` M CLAUDE.md`, `?? .claude/launch.json` — не трогались |
| `anglesite` | `main` | `2bc91b1` Раздел «Customers» | `?? IMG_3617-hero.mp4`, `?? IMG_3617.mov`, `?? docs/` — сохранены |

## 2. Baseline проверок (до правок)

Прогон с отключённой песочницей Bash (в песочнице npm на этой машине виснет).

| Команда | Результат |
|---|---|
| `npm run lint` | exit 0 |
| `npm run test:run` | exit 0 — **46 файлов, 314 тестов, все зелёные**, 8.25s |
| `npm run build` | exit 0, 12.13s |
| `npm run check:bundle` | exit 0 — modern 61.8 KiB gzip / лимит 240; legacy 127.7 / 310 |
| `npm run check:schema` | ok (v116) |
| `anglesite: npm run build` | exit 0 (`dist/account/…index.js` 594 kB / 167 kB gzip) |

Размер гостевой страницы брони в бандле: `PublicReservePage` 35.09 kB / 10.32 kB gzip.

БД-тесты (`supabase db reset && supabase test db`) в этом прогоне **не запускались** —
требуют локального Docker-стека; Phase 1 их обязана прогнать.

Замер latency продового `public-reserve` (3 прогона, текущий объём данных —
одна точка, 3 зоны):

| Эндпоинт | Время |
|---|---|
| `?loc` (профиль точки) | 0.29–0.37 с |
| `?loc&date&party` (сетка дня, 49 слотов) | 0.24 с |
| `?loc&date&party&zone` × 3 зоны | 0.15 / 0.23 / 0.26 с |

Сейчас укладывается, но движок стоит O(слоты × столы × брони) с вызовом
функции на каждый слот — целевой замер «50 столов / 200 броней в день»
(acceptance Phase 3) ещё не делался.

## 3. Путь данных (call graph)

```
Гость  /reserve/:locId  (PublicReservePage.tsx, he-only, 3 экрана)
  │  publicReserveApi.ts  → anon key, только Edge Function
  ├─ GET  ?loc                    → locations SELECT (service_role, allow-list)
  │                                  + table_zones + tables (живые зоны)
  ├─ GET  ?loc&date&party[&zone]  → rpc reservation_availability  (SECURITY DEFINER)
  │                                  → _pick_tables → _table_free → reservations
  ├─ POST {action:'submit'}       → rpc submit_reservation        (SECURITY DEFINER)
  │                                  → capability-гейт → тумблер → валидации →
  │                                    (instant) _pick_tables → INSERT reservations
  │                                    ← EXCLUDE reservations_no_overlap → full_slot
  ├─ GET  ?id=<client_uuid>       → rpc get_reservation_status  (поллинг 5 с)
  └─ POST {action:'cancel'}       → rpc cancel_reservation

POS  /reservations (ReservationsPage.tsx)         ANGLE  раздел Reservations
  ├─ SELECT reservations (RLS org)                 ├─ SELECT reservations (RLS org)
  ├─ realtime postgres_changes → звонок+бейдж      ├─ realtime + поллинг 60 с
  ├─ create_reservation (ручная, сразу confirmed)  └─ set_reservation_status_web
  ├─ accept / reject / set_reservation_table          (new→confirmed|rejected|cancelled,
  ├─ seat_reservation → открывает POS-заказ            confirmed→completed|no_show|cancelled;
  └─ guest_history (CRM-бейдж по телефону)             брони с order_id — pos_mode, read-only)

План зала /hall → fetchUpcomingTableReservations (окно now−30м…now+2ч, подсветка)
```

## 4. Схема

`reservations` (053 + 057 + 063 + 072 + 102):

| Поле | Источник | Заметка |
|---|---|---|
| `id, org_id, location_id, client_uuid` | 053 | `client_uuid` UNIQUE — и идемпотентность, и **секрет доступа гостя** |
| `customer_name, customer_phone, party_size, reserved_at, note` | 053 | телефон — только цифры; `party_size` CHECK 1..200 (063 снял потолок 20) |
| `table_id, status, reject_reason, decided_by, decided_at, cancelled_at, created_at` | 053 | |
| `order_id` | 057 | посадка в POS-заказ |
| `duration_min, auto, hold_table_ids, deposit_amount, deposit_status, occupancy` | 063 | `occupancy` — `tstzrange`, синхронизируется триггером `trg_reservation_occupancy` |
| `zone_id` | 072 | составной FK на `table_zones(id, org_id, location_id)` |
| `decided_by_member` | 102 | атрибуция веб-решений |

Статусы: `new → confirmed | rejected | cancelled`; `confirmed → rejected |
cancelled | completed | no_show`. Активных `arrived/seated` **нет сознательно**
(102): предикаты движка доступности считают занятость по `new`/`confirmed`.

Ограничения и индексы:

- `EXCLUDE reservations_no_overlap USING gist (table_id =, occupancy &&)
  WHERE table_id IS NOT NULL AND status IN ('new','confirmed')` — гонка инстант-броней;
- `idx_reservations_occupancy` (gist, location_id + occupancy, частичный);
- `idx_reservations_loc_status`, `idx_reservations_loc_time`, `idx_reservations_phone`;
- `tables.seats` (CHECK 1..100, дефолт **2**), `tables.combinable` (063).

Таблица в `supabase_realtime`. RLS: `reservations_select` — `org_id = auth_org_id()`;
INSERT/UPDATE/DELETE у `authenticated` отозваны, всё через RPC; у `anon` — ничего.

## 5. RPC: актуальная версия и гейт

| Функция | Последнее определение | Гейт | EXECUTE |
|---|---|---|---|
| `submit_reservation(…, p_zone_id)` | **105** | capability `public_reservations` → тумблер `enabled` | `service_role` |
| `reservation_availability(loc,date,party,zone)` | **105** | то же | `service_role` |
| `get_reservation_status(client_uuid)` | **105** | capability | `service_role` |
| `cancel_reservation(client_uuid)` | 053 | — (гейта capability нет) | `service_role` |
| `_pick_tables`, `_table_free` | 072 / 063 | — | `authenticated`, `service_role` |
| `create_reservation` | 060 | `auth_org_id()` + активный staff | не-anon |
| `accept_reservation` | 063 | `auth_org_id()` + staff | не-anon |
| `reject_reservation`, `set_reservation_table` | 053 | `auth_org_id()` + staff | не-anon |
| `seat_reservation` | 057 | | не-anon |
| `set_reservation_status_web` | **105** | членство owner/manager + capability `reservations_desk` | `authenticated` |
| `guest_history(phone)` | 063 | `auth_org_id()` | не-anon |

Границы безопасности: гость не имеет доступа к таблицам вообще — только
Edge Function под `service_role`, отдающая allow-listed поля. Ключ доступа
гостя к своей брони — `client_uuid` в `localStorage`. Ни один кассовый RPC
брони **не требует `p_staff_session`** — они доверяют JWT устройства
(`auth_org_id()` + проверка `staff.is_active`), то есть находятся в той же
«мягкой» зоне, что горячий поток; `require_staff_perm` здесь не участвует.

## 6. Как считаются часы — корень проблемы №1

Существуют **два независимых источника**, и они не связаны ничем:

| Что | Ключ | Кто читает | Формат |
|---|---|---|---|
| То, что гость **видит** | `settings.reservations.hours` | только UI (`HoursRows`) | свободный текст, строка на день |
| То, что **бронируется** | `settings.reservations.open` / `close` | `reservation_availability`, `submit_reservation`, `slotsFor` в браузере | одна пара `HH:MM` на **все семь дней** |

Дня недели в enforcement-модели нет вообще. Исключений, праздников, разрыва
на обед/ужин, lead time и окна предварительной записи — тоже нет
(единственные границы `NOW()+30 мин … NOW()+30 дней`, зашитые в код).

**Воспроизведено на проде** (`menu.angle.co.il/reserve/bulochka`,
`fe2eebf0-65e3-45b4-a81f-331359d71955`), только публичные GET:

```
профиль точки:  "open": "08:00", "close": "20:00", "instant": true
                "hours": "א׳ – ה׳ · 08:00 – 20:00
                          שישי · 08:00 – 15:00
                          שבת · סגור"

?date=2026-08-01 (суббота): slots 49, free 49 — с 08:00 до 20:00
?date=2026-08-07 (пятница): slots 49, free 49 — с 08:00 до 20:00
```

То есть страница пишет гостю «шабат закрыто / пятница до 15:00» и одновременно
предлагает 49 слотов в субботу и 20 слотов после закрытия в пятницу. При
`instant: true` такая бронь **подтверждается сервером автоматически**, её никто
из персонала не видит до самого визита. Это release-blocker в чистом виде.

Попутно там же: `"address": "כתובת העסק"` — плейсхолдер («адрес бизнеса»),
`"phone": null` — кнопка звонка не рендерится. Это подтверждает слабость №8.

### Готовый образец для Phase 1

Онлайн-заказы **уже решили** ровно эту задачу и решение можно переиспользовать,
а не изобретать:

- формат `settings.online_orders.hours` = `{"0": [["08:00","20:00"]], "6": []}`
  (ключ — `EXTRACT(DOW)`, массив окон, пустой = закрыт, `["20:00","02:00"]` =
  через полночь);
- ядро `online_hours_open_at(settings, tz, at)` (112) + обёртка «сейчас»;
- enforcement и «принимаем сейчас», и «на выбранное время» (`pickup_outside_hours`);
- редактор в ANGLE уже есть: `OpeningHours` в `QrChannels.jsx` + хелперы
  `WEEK_DAYS/dayWindow/withDay/defaultHours/hoursSummary` в `online.js`;
- pgTAP `order_hours.test.sql`.

Чего в этой модели всё равно не хватает под ресторан и придётся добавить:
несколько окон в день в редакторе (формат-то массив уже позволяет),
датовые исключения, lead time / горизонт записи, единый источник для
отображаемых часов.

## 7. Существующие тесты

| Уровень | Что покрыто | Чего нет |
|---|---|---|
| pgTAP | `reservations_web_desk.test.sql` — переходы 102, `pos_mode`; упоминания брони в `entitlement_matrix`, `product_capability_model`, `secure_provisioning`, `organization_products`, `billing_subscriptions` — только гейты | **движок доступности не покрыт вообще**: `reservation_availability`, `_pick_tables`, `_table_free`, `submit_reservation`, EXCLUDE-гонка, буфер, объединение, зоны, DST |
| vitest | 314 тестов, из них про бронь — **ни одного** | `slotsFor`, `hmToMin`, состояние шагов, обработка `full_slot` |
| E2E | нет | Playwright в проекте **не установлен** (в `package.json` нет); визуальные и мобильные прогоны плана требуют решения об инструменте |

## 8. Подтверждённые пробелы

Слабости из плана — все подтверждены кодом, плюс найдено сверх списка.

| № | Слабость плана | Статус | Где |
|---|---|---|---|
| 1 | Часы — не единый источник истины | **подтверждено на проде** | см. §6 |
| 2 | Нет расписания по дням/исключений | подтверждено | одна пара `open/close`, 105/072 |
| 3 | Стол хостес — список, не таймлайн | подтверждено | `ReservationsPage.tsx` (карточки), `ReservationsDesk.jsx` (2 списка) |
| 4 | Нет переноса и календаря | подтверждено | `StatusScreen` умеет только отмену; `.ics` нет; адреса/навигации на экране статуса нет |
| 5 | Нет листа ожидания | подтверждено | ни таблицы, ни RPC |
| 6 | История гостя бедная | подтверждено | `guest_history` = 5 агрегатов по телефону, не связана с `guests` (114) |
| 7 | Нет аналитики | подтверждено | нет источника/UTM у брони, нет воронки, нет отчёта |
| 8 | Метаданные и контент страницы | **подтверждено на проде** | `address` — плейсхолдер, `phone` пуст; `<title>` = «Angle — Digital Menu», description/OG нет; `/reserve/*` получает общий `menu.webmanifest` (в `install-manifest.js` спец-обработка только `/order/*`) |

Сверх списка плана:

1. **Часовой пояс гостя вместо часового пояса точки.** `slotsFor` и отправка
   (`PublicReservePage.tsx:1099-1115`) строят время через `new Date(...)`/
   `setHours` — это TZ **устройства гостя**, а не `locations.timezone`. Турист
   или телефон со сбитой зоной увидит одну сетку, а забронирует другое время.
   Сервер честно пересчитывает по своей зоне, поэтому расхождение молчаливое.
2. **`create_reservation` (060) отстала от 063**: жёсткий потолок
   `party_size > 20` (в таблице 200, лимит точки — настройка `max_party`) и
   **нет проверки занятости стола** — ручная бронь на занятый стол падает
   сырой ошибкой exclusion. Та же сырая ошибка у `set_reservation_table`
   (известное ограничение 063).
3. **`cancel_reservation` — единственный публичный RPC брони без
   capability-гейта** (105 добавила его в submit/availability/status).
   Отключение продукта не запрещает гостю отменить бронь. Практический риск
   низкий, но модель гейтов дырявая.
4. **Поллинг статуса вечный**: `setInterval` 5 с без остановки, в том числе
   для подтверждённой брони на две недели вперёд и для вкладки в фоне.
5. **Доступ к брони привязан к устройству**: `client_uuid` живёт только в
   `localStorage` этого браузера. Сменил телефон / почистил данные — доступа к
   своей брони нет и восстановить его нечем (Phase 2 «стабильный URL с
   непрозрачным токеном» это и закрывает).
6. **Дефолт `tables.seats = 2`**: точка, не проставившая места, получает
   расчёт вместимости по 2 на стол молча. Задокументировано, но в UI ничем не
   сигнализируется.
7. **Дрейф документации**: `docs/database.md` называет baseline «001…071»,
   `README.md` — «001–105», `docs/reservations.md` — «последняя миграция 072»,
   фактически в дереве **116**. Правится вместе с Phase 1.
8. **Депозит-плейсхолдер живёт в проде**: поля `deposit_*` и UI в ANGLE есть,
   оплаты нет. План запрещает депозиты — на Phase 1/2 надо решить явно:
   спрятать переключатель или оставить как есть с честной подписью.

## 9. Уточнение оценок после Phase 0

План просил уточнить. С учётом того, что модель недельных часов, редактор и
pgTAP-образец уже существуют в контуре онлайн-заказов и переиспользуемы:

| Фаза | План | Уточнение | Почему |
|---|---|---|---|
| 1 — часы и доступность | 4–6 дн. | **4–5 дн.** | формат/ядро/редактор частично готовы; но добавляются исключения, lead time, TZ-фикс, backfill и полный pgTAP по движку, которого нет |
| 2 — гостевой UX | 5–7 дн. | **6–8 дн.** | сверх плана: перевод расчёта времени на TZ точки, токен доступа вместо localStorage, метаданные/manifest для `/reserve/*` |
| 3 — таймлайн хостес | 7–10 дн. | **8–11 дн.** | два контура (POS и ANGLE) вместо одного; ANGLE-бэкофис — vanilla JSX без дизайн-системы POS |
| 4 — CRM гостя | 4–6 дн. | **4–6 дн.** | есть `guests` (114) и `get_guest_card` — сшивать, а не строить с нуля |
| 5 — outbox и waitlist | 5–7 дн. | **5–7 дн.** | без изменений; провайдера e-mail в проекте нет → адаптер остаётся выключенным |
| 6 — аналитика и упаковка | 4–6 дн. | **5–7 дн.** | атрибуции источника у брони сейчас нет вообще — колонка + протаскивание через весь флоу |

Итого v1 (Phases 0–3 + отмена/перенос/календарь/минимальный профиль):
**≈ 4–5 недель** одного разработчика. Полный объём — **7–9 недель**.
Это планирование, не обязательство.

## 10. Что Phase 1 обязана сделать

1. Единая каноническая конфигурация расписания брони (недельные окна +
   исключения + lead time + горизонт), формат — расширение уже работающего
   `hours` онлайн-заказов, не третий диалект.
2. Отображаемые часы и генерация слотов читают **одну** структуру; свободный
   текст `reservations.hours` либо выводится из неё, либо помечается как
   устаревший с миграцией данных.
3. `reservation_availability` и `submit_reservation` — один общий предикат
   «эта минута бронируема», плюс серверная реперепроверка при создании.
4. Перевод клиентской генерации слотов на часовой пояс точки.
5. Forward-only миграция **117** с backfill: текущая пара `open/close`
   разворачивается в семь одинаковых окон, поведение существующих точек не
   меняется; `MIN_SCHEMA_VERSION` → 117 (гейт `check:schema`).
6. pgTAP на движок: закрытый день, разрыв смен, исключение, DST
   Asia/Jerusalem, полночь, буфер, объединение, одновременные брони.
7. Редактор недельных часов и исключений в ANGLE с превью семи дней.

Открытый вопрос к владельцу перед стартом Phase 1: **что считать правдой**
для уже работающих точек — enforced `open/close` (08:00–20:00 всю неделю) или
текст `hours` (пятница до 15:00, суббота закрыто). Backfill из `open/close`
безопаснее технически, но у «Булочки» он оставит субботу открытой, то есть
сохранит ровно тот баг, ради которого фаза делается.
