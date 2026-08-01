# Back office — Phase 0 baseline

Базовая точка для `docs/claude-backoffice-improvement-plan.md`. Здесь
зафиксировано состояние ДО правок Phase 1, команды проверки и то, что
именно воспроизводилось.

## Состояние репозиториев

| | `anglesite` | `kassa` |
|---|---|---|
| branch | `main` | `main` |
| HEAD | `e66b823` Reservations: готовность к запуску и тестовая бронь | `b48c7fe` Бронь: чеклист запуска, предпросмотр и тестовая бронь (126) |
| untracked (не трогать) | `IMG_3617-hero.mp4`, `IMG_3617.mov`, `docs/` | `.claude/launch.json` |
| modified (не трогать) | — | `CLAUDE.md` |

## Команды проверки

```bash
cd /Users/enotov/Desktop/anglesite
npm run build     # сборка сайта + кабинета
npm test          # node --test backoffice/src/*.test.js
```

Базовая сборка до правок: `dist/account/index-C8GpGAOA.js` 648.87 kB
(gzip 181.80 kB), `index-CwQHeL8A.css` 53.10 kB — прошла.

Тестовая обвязка — встроенный `node:test` (Node ≥ 20), без новых
зависимостей: проверяется чистая логика (`timeline.js`, `navigation.js`).
Компонентных тестов пока нет намеренно — сначала логика, которая ломается
молча.

## Карта «форма аккаунта → разделы»

Считается из эффективных capabilities контекста (`get_backoffice_context`,
Kassa 105). Закреплена в `backoffice/src/navigation.test.js`.

| Форма аккаунта | Видимые разделы |
|---|---|
| POS only | Home, Overview, Activity, Locations, Menu & catalogue, Team, Customers, Devices, Reports, Integrations |
| Menu only | Home, Locations, Menu & catalogue, QR menu |
| Orders standalone | Home, Orders, Locations, Menu & catalogue, QR menu |
| Reserve standalone | Home, Reservations, Locations, QR menu |
| Developer | все разделы |
| Организация без продуктов | Home, Locations (плюс экран ожидания активации) |
| Контекст без `capabilities`/`products` (сервер до 105) | все разделы |

После Phase 1 Reports и Integrations помечены `planned` и остаются только
в developer-аккаунте — в таблице выше они относятся к состоянию «до».

Видимость — не авторизация: запреты живут в RLS и гейтах RPC
(`module_disabled`).

## Воспроизведение дефектов (до правок)

### 1. Таймлайн затягивает вчерашние брони

Вход: дата `2026-08-01`, зона `Asia/Jerusalem`, бронь 31 июля 14:00 в
буфере запроса (`fetchTimelineReservations` берёт `−24ч`).

| Набор броней | Окно | Часов | Ширина полотна | Метки |
|---|---|---:|---:|---|
| пусто | 01.08 08:00 → 02.08 00:00 | 16 | 2048px | 17 уникальных |
| только бронь 1 августа | 01.08 08:00 → 02.08 00:00 | 16 | 2048px | 17 уникальных |
| + бронь 31 июля 14:00 | **31.07 14:00** → 02.08 00:00 | **34** | **4208px** | 35 меток, 24 уникальные — **дубли React-ключей** |

Совпадает с наблюдением на проде (~35 часов / 4223px). Дубли ключей
`hourTicks` подтверждены предупреждением React в браузере.

### 2. Превью гостевого меню — «menu.angle.co.il refused to connect»

Заголовки проверены read-only запросами:

| Путь | `Content-Security-Policy` |
|---|---|
| `/order/<ref>` | `frame-ancestors *` |
| `/reserve/<ref>` | `frame-ancestors *` |
| `/` , `/index.html`, `/sw.js`, `/install-manifest.js` | `frame-ancestors 'self'` |

Сами по себе заголовки встраивание разрешают. Причина — service worker
публичного меню: `navigateFallback: '/index.html'` (kassa
`vite.config.ts`), а закешированный ответ `/index.html` несёт
`frame-ancestors 'self'`. В браузере, где SW уже установлен (то есть у
любого, кто хоть раз открывал гостевую страницу), навигация iframe
обслуживается из precache и Chrome блокирует кадр.

Проверено в Chrome с общим профилем:

```
[1. без service worker]   served-by=network         csp=frame-ancestors *
                          frame: /order/test — страница отрисована
[2. с установленным SW]   served-by=service-worker  csp=frame-ancestors 'self'
                          Framing 'https://menu.angle.co.il/' violates … frame-ancestors 'self'
                          frame: chrome-error://chromewebdata/ — "menu.angle.co.il refused to connect."
```

Тем же механизмом ломается и обещанный клиенту embed на его сайте:
у возвращающегося гостя (SW установлен) iframe с меню не откроется.

### 3. Help — мёртвая кнопка

`backoffice/src/App.jsx`: кнопки Help в `sidebar-top-actions` и
`sidebar-bottom` без `onClick`.

### 4. Reports и Integrations — витринные заглушки

Оба пункта ведут в `SectionPage` с текстом «This workspace is connected to
the same organisation as your ANGLE POS», хотя названия обещают модуль.

## Скриншоты

`screenshots/backoffice/` (каталог в `.gitignore`), пары `before-*` /
`after-*` в двух вьюпортах: 1440×900 и 390×844.

Снимались на локальном стенде с фикстурами вместо Supabase (подмена
`./supabase` плагином Vite; стенд лежит вне репозитория, рабочее дерево не
менялось). Живой прод под owner-сессией снять нельзя — нужен вход
владельца; там остаётся ручной прогон смоук-чеклиста.

## Смоук-чеклист (ручной, оба вьюпорта)

Десктоп 1440×900 и мобильный 390×844, Chrome и iOS Safari.

1. **Навигация.** Открыть каждый видимый раздел; на мобильном — открыть и
   закрыть шторку, проверить что фон под ней не скроллится.
2. **Reservations → Timeline.** Сегодня, «вчера», «завтра», выбор даты в
   поле. Полотно не шире суток выбранного дня; вчерашние визиты не видны;
   ночной визит, начавшийся до полуночи, виден обрезанным слева.
3. **Reservations → List / Waitlist / Floor plan / Analytics.** Каждый
   таб открывается без ошибок.
4. **QR menu.** Превью показывает страницу гостя либо явное состояние
   «не удалось показать» с рабочей ссылкой «Open full page». Кнопка
   Refresh перезагружает кадр.
5. **Help.** Открывается панель, org id / location id копируются.
6. **Reports / Integrations.** У обычного аккаунта в меню отсутствуют; у
   developer — открываются с честной пометкой «планируется».
7. **Меню и каталог, Team, Devices, Customers, Activity, Overview.**
   Открываются, данные грузятся, пустые состояния читаемы.
8. **Клавиатура.** Tab по сайдбару и по действиям открытой панели; Escape
   закрывает панель; фокус виден.

## Phase 1 — что стало

Измерено на том же стенде, вьюпорты 1440×900 и 390×844.

| Дефект | Было | Стало |
|---|---|---|
| 1. Таймлайн | 34 ч / 4208px, вчерашняя бронь в строках, 11 дублей React-ключей | 24,5 ч / 2940px (сутки + запас расписания), вчерашней брони нет, ночной визит виден обрезанным, дублей ключей 0 |
| 2. Превью меню | «menu.angle.co.il refused to connect» без объяснения | навигация iframe не подменяется precache (`navigateFallbackDenylist`); состояния loading / ready / не подтверждено / заблокировано с рабочей ссылкой |
| 3. Help | кнопка без действия в двух местах | панель: шаги настройки по capabilities, диагностика с копированием, фокус на закрытии, Escape |
| 4. Reports / Integrations | видны всем, открывают текст про POS | скрыты у клиентов, у developer — «Not built yet» и переход в Overview |

Проверка исправления дефекта 2 без деплоя: локальный сервер повторяет
правила `vercel.json` и отдаёт собранный `dist`. С прежним `sw.js` кадр
блокируется (`chrome-error://chromewebdata/`), с новым — открывается из
сети с `frame-ancestors *`.
