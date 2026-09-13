# Журнал проверок

Здесь фиксируются новые прогоны по [плану завершения](product-completion-plan.md).
Исторические результаты предыдущего аудита сохранены в исходной точке плана;
они не переносятся сюда как сегодняшние тесты.

## Формат записи

```text
Дата / исполнитель:
Задача плана:
Коммит anglesite / незакоммиченные изменения:
Коммит kassa / незакоммиченные изменения:
Среда (local / test / production), версия схемы:
Продукт, роль, браузер / устройство / APK:
Сценарий или команда:
Ожидалось:
Получено (PASS / FAIL / SKIPPED / NOT RUN):
Доказательство (лог CI, обезличенный снимок, номер дефекта):
Ограничения и повторная проверка:
```

Не включать реальные пароли, ключи, токены брони и персональные данные гостей.
Для сценария, который нельзя выполнить без владельца/терминала/почты, записать
причину `NOT RUN`, а не выставлять `PASS` по unit-тесту.

## 13.09.2026 — D0, документационная основа

- Объём: индексы двух репозиториев, обзор системы, запуск, общий выпуск,
  классификация истории, исправление устаревших вводных инструкций.
- База кода: ANGLE `7083ed4f`, Kassa `d815a7a9`; документационные изменения
  находятся в рабочем дереве. Пользовательские черновики сохранены.
- `PASS`: `npm run check:docs -- --require-kassa` — 6 тестов самого валидатора,
  69 Markdown-документов включены в индексы, 193 локальные ссылки в рабочих
  документах/индексах проверены, 0 пропусков межрепозиторных ссылок, 0 ошибок.
- `PASS`: `git diff --check` в обоих репозиториях. Смысл всех исторических
  справочников этим не проверяется; D0.3–D0.4 остаются в плане.
- Функциональная приёмка: `NOT RUN` в рамках документационной работы.
- Production SMTP, backups/PITR, доставка уведомлений и физический терминал:
  `NOT RUN`. Документация не подтверждает состояние внешних сервисов.

## 13.09.2026 — F3, проверка результата Claude

- Среда: локальная macOS, Node.js 22.16.0; ANGLE HEAD `7083ed4f` плюс
  незакоммиченные изменения F3 и D0. Миграции и production не менялись.
- По отчёту Claude: unit 687 PASS, browser 185 PASS, общий `npm test` 872 PASS,
  build PASS. Unit и build здесь повторно не запускались; это результаты
  исполнителя, не нового независимого прогона.
- Diff: пять наборов используют общий harness; прежние проверки UI сохранены,
  в team-фикстуре дата приведена к локальному ключу. Прикладной `backoffice/src/`,
  lock-файл и сборочный скрипт сайта не изменены.
- `PASS` здесь: `node --test --test-timeout=120000 backoffice/test/browser-harness.test.mjs`
  — 12 тестов, включая ненулевой exit каждого из пяти наборов при отсутствии
  Chrome и проверку явного optional-пропуска.
- В sandbox Chrome не стартовал: обязательный прогон вернул exit 1 вместо
  пропуска. Это отказ запуска среды, не результат проверки UI.
- `FAIL` вне sandbox: `ANGLE_BROWSER=required npm run test:browser` —
  165 тестов: 162 PASS, 2 FAIL, 1 CANCELLED, 0 SKIPPED, exit 1, около 120 с.
  В `mobile navigation drawer` два ожидания `openDrawer()` истекли через 30 с
  («все разделы достижимы…», «Escape закрывает…»), затем весь `browser.test.mjs`
  превысил лимит 120 с. Остальные тесты этого файла не были полностью приняты.
- `FAIL` вне sandbox, изолированно:
  `ANGLE_BROWSER=required node --import ./backoffice/test/register.mjs --test --test-timeout=120000 --test-name-pattern='mobile navigation drawer' backoffice/test/browser.test.mjs`
  — 6 тестов: 5 PASS, 1 FAIL, 0 SKIPPED, exit 1, около 39 с. На этот раз
  ожидание того же helper истекло в сценарии изменения высоты viewport.
- Причина нестабильности не установлена. Отдельное наблюдение: harness
  отбрасывает подробности исходной ошибки запуска Chrome. Доработки F3-R1/R2
  записаны в плане; менять продуктовые assertions ради зелёного прогона нельзя.
- `PASS`: `check:docs -- --require-kassa` и `git diff --check` на этапе проверки.
  README и release-инструкции уточнены; шаг docs в CI сохраняется.
- GitHub Actions: `NOT RUN`. Commit, push и deploy: `NOT RUN`.
  F3 полностью не закрыт; реальный Auth/SMTP, RLS и терминал этим не проверялись.

## 13.09.2026 — A1–A3, клиентская часть аккаунта

- Среда: локальная macOS, Node.js 22.16.0, Chrome for Testing 150,
  `@supabase/supabase-js` / `auth-js` 2.110.7 из существующего lock-файла.
  ANGLE HEAD `7083ed4f` плюс рабочие изменения A1–A3/D0/F3. Backend и схема
  в этом блоке не изменялись; Kassa здесь не редактировалась.
- Реализовано: reset-запрос, новая recovery-форма, confirmation/resend,
  обработка ошибок и повтор загрузки сессии/контекста, отбрасывание поздних
  ответов старого аккаунта, ограничение повторной отправки, привязка
  password mutation к исходной сессии и явный неизвестный исход при timeout.
- `PASS`: unit/SSR только аккаунта — 33 теста, 0 FAIL, 0 SKIPPED.
  Команда: `node --import ./backoffice/test/register.mjs --test backoffice/src/account-session.test.js backoffice/src/AccountAuth.test.js`.
- `PASS`: весь `npm run test:unit` — 720 тестов, 0 FAIL, 0 SKIPPED,
  exit 0, около 2.8 с.
- `PASS`: `ANGLE_BROWSER=required node --import ./backoffice/test/register.mjs --test --test-reporter=spec --test-timeout=120000 backoffice/test/account-auth.test.mjs`
  — два последовательных итоговых прогона: по 9 тестов,
  0 FAIL/CANCELLED/SKIPPED, exit 0, около 14 и 13 с.
  Шесть сценариев используют подмену Auth API; три запускают настоящий
  установленный SDK с production-инициализацией клиента и **локальным**
  HTTP-сервером Auth. Проверены callback recovery/confirmation, удаление
  токенов из URL, перезагрузка формы, изолированное сохранение пароля,
  просроченный callback и мобильный viewport 390 × 844.
- При разработке набора исправлены его фикстуры: надёжная замена текста
  confirmation-поля, base64url-формат тестового JWT и ожидаемые nullable
  поля SDK в запросе смены пароля. Один промежуточный запуск завершился
  по общему лимиту 120 с без указания сценария; причина не установлена.
  Итоговый набор использует отдельные browser contexts и ограниченные
  ожидания; успешный итог не отменяет запись этого зависания.
- `PASS`: отрицательная проверка нового `account-auth.test.mjs` через общий
  harness — 1 тест, отсутствие Chrome возвращает ненулевой код с причиной.
  Общий harness, прежние браузерные наборы и CI-файлы здесь не редактировались.
- `PASS`: `npm run build`. Остаются предупреждения о смешанном static/dynamic
  импорте ActivityManager и основном JS-чанке около 533 kB; это не исправлялось
  в рамках аккаунта.
- Добавлен [справочник аккаунта](account-access.md), обновлены общий индекс,
  обзор системы, план и охват `check:docs`.
- `PASS`: `npm run check:docs -- --require-kassa` — 6 тестов валидатора,
  70 документов, 210 локальных ссылок, 0 ошибок и пропусков; `git diff --check`.
- `NOT RUN`: production Auth/SMTP, доставка и открытие настоящего письма,
  серверный отзыв/истечение ссылок, production RLS, реальный onboarding A4,
  активация A5 и отрицательная приёмка двух организаций A6. Локальный Auth
  сервер имитирует ответы, а не серверную проверку подписей и прав.
- Полный браузерный прогон остальных разделов и CI в этом блоке: `NOT RUN`,
  F3 остаётся за Claude. Commit, push, deploy и платёжные интеграции: `NOT RUN`.
  A1–A3 полностью не закрыты до живой приёмки по справочнику.

## 13.09.2026 — F3-R1/R2, локальная приёмка доработок Claude

- Проверен diff: фокус мобильной шторки повторяется до фактического перехода
  внутрь (не более 60 кадров); harness сохраняет стек и цепочку `cause`,
  использует `pipe: true`. Продуктовые assertions и таймауты не ослаблены.
- По диагностике Claude причина F3-R1 — вызов `focus()` в момент, когда CSS
  transition ещё оставлял `visibility: hidden`. Его нагрузочные прогоны:
  199/199 и два изолированных 6/6. Нагрузочный эксперимент здесь не повторялся.
- `PASS` независимо, до добавления A4: `ANGLE_BROWSER=required npm run test:browser`
  — 199 тестов, 0 FAIL/CANCELLED/SKIPPED, exit 0, около 99 с. Включает
  17 тестов harness с проверкой завершения Chrome после убийства процесса теста.
- Claude сообщил об одном неповторённом в финале отказе SDK recovery-сценария.
  В независимых полных прогонах до и после A4 он прошёл; причина того отказа
  не доказана. Это не основание объявлять нестабильность окончательно устранённой.
- F3-R1/R2 приняты локально. GitHub Actions: `NOT RUN`; шаг `check:docs`
  сохраняется, нужные новые документы должны попасть в тот же выпуск.
  Commit, push и deploy не выполнялись.

## 13.09.2026 — A4, безопасное создание заведения

- База: ANGLE `7083ed4f`, Kassa `d815a7a9` плюс текущие незакоммиченные
  A1–A4/D0/F3. Среда: macOS, Node.js 22.16.0, Chrome for Testing 150;
  SQL — локальный PostgreSQL 17.6 в отдельной временной БД.
- Реализованы привязанный к аккаунту UUID запроса и сохранение исходных полей
  в sessionStorage; повтор после неизвестного результата/перезагрузки,
  отдельное восстановление JWT после создания, блокировка двойной отправки
  и отбрасывание поздних ответов старого аккаунта. RPC закреплён за исходным
  access token. Создание заведения не выдаёт продукты или подписку.
- Миграция 165 добавляет серверные квитанции повторов и общую блокировку
  строки Auth-пользователя для цифрового кабинета и POS. Старые RPC сохраняют
  сигнатуры и ошибку повторного bootstrap; обходные функции недоступны клиентам.
  Kassa `MIN_SCHEMA_VERSION` поднята до 165. Новый кабинет не откатывается
  на небезопасный старый RPC при отсутствии миграции.
- `PASS`: `node --import ./backoffice/test/register.mjs --test backoffice/src/workspace-setup.test.js`
  — 14 тестов. Изолированный `account-auth.test.mjs` — 13 браузерных тестов,
  0 пропусков, около 24 с; четыре новых сценария A4 используют локальные заглушки.
- `PASS`: ANGLE `npm run test:unit` — 734 теста; `npm run build`.
  Существующие предупреждения ActivityManager и основного чанка около 537 kB
  остаются. Это не работа по оптимизации сборки.
- `PASS`: итоговый `ANGLE_BROWSER=required npm run test:browser` —
  203 теста, 0 FAIL/CANCELLED/SKIPPED, exit 0, около 97 с.
- `PASS`: Kassa `npm run lint`, `npm run check:schema` (165),
  `npm run test:run` (580 тестов, 64 файла), `npm run build`,
  `npm run check:bundle`. Bundle: modern 61.8 KiB gzip / лимит 240,
  legacy 130.1 KiB / лимит 310. Предупреждения старых reserve-тестов
  о query data/React act не исправлялись; прогон завершился успешно.
- SQL проверялся в `angle_onboarding_a4_20260913`: копия **только схемы**
  локальной БД версии 164, технические справочники и миграция 165.
  Реальные пользователи, организации и заказы не копировались; фикстуры синтетические.
  Это проверка обновления существующей схемы 164, не пересоздание всей БД
  из полного набора миграций. Исходная локальная БД и production не изменялись.
- `PASS`: новый pgTAP-набор — 20 проверок, прежний organization_products — 30.
  Полный повторный прогон — **78 SQL-файлов, 1410 проверок, 0 FAIL**.
  Первый полный прогон имел один отказ location_slugs из-за отсутствующего
  в schema-only копии технического справочника reserved_slugs; после переноса
  справочника весь набор повторён. После регистрации версии 165 только
  в истории миграций временной БД отдельно повторён schema_version — 4 PASS;
  `get_schema_version()` вернул 165.
- `PASS`: `node scripts/test-onboarding-concurrency.mjs angle_onboarding_a4_20260913`
  из Kassa — пять конкурентных сценариев на двух реальных SQL-соединениях.
  Старые тела функций детерминированно создали две организации; после защиты
  digital/digital и digital/POS оставляют одну. Новый RPC с одинаковым UUID
  возвращает двум вызовам один результат; разные UUID не создают дубль.
  Ни один успешный сценарий не выдаёт entitlement. Скрипт разрешает только
  явно названную временную БД в локальном Docker, не production.
- Обновлены план, обзор системы, справочник аккаунта, release-checklist и
  backend-справочники. Целевой путь зафиксирован: выбор продукта/тарифа →
  подтверждённая оплата → подписка → доступ; ручные grants — исключения.
- `NOT RUN`: миграция 165 на production, живой HTTP/Auth onboarding,
  реальные письма/SMTP, платёжный провайдер, A5/A6, GitHub Actions.
  A4 реализован и проверен локально, но не полностью принят в целевой среде.
  Fake-provider не включён: требуется изолированная среда, её вариант ещё
  не выбран. Налоговая регистрация и реальные платежи остаются отложенными.
- `PASS`: `npm run check:docs -- --require-kassa` — 6 тестов валидатора,
  70 документов, 214 локальных ссылок, 0 ошибок/пропусков; `git diff --check`
  в обоих репозиториях.
- После проверок удалена только созданная для них временная БД с синтетическими
  фикстурами; её данные не сохранялись, повтор воспроизводится из схемы и тестов.
  Colima возвращена в исходное выключенное состояние; существующие базы и
  контейнерные диски сохранены.

## 13.09.2026 — A5, первая покупка и изолированная тестовая оплата

- База: ANGLE `7083ed4f`, Kassa `d815a7a9` плюс незакоммиченные A1–A5/D0/F3.
  Node.js 22.16.0, Chrome for Testing 150, локальный PostgreSQL 17.6.
  Manifest/lock-файлы и node_modules в рамках A5 не менялись; F2 передан Claude.
- Реализованы миграция 166, owner-only checkout одного цифрового продукта
  на точку/месяц, серверный расчёт счёта, UUID/replay и отмена без удаления,
  первая активация только через service-only payment intake. Обычный клиент
  не получает RPC подтверждения оплаты. Режим после миграции — disabled.
- В кабинете добавлены Manage subscriptions, просмотр суммы/налога до оплаты,
  состояния и сроки подписки, история счетов, обработка неизвестного результата,
  повтор исходного запроса и явное отсутствие подключённого провайдера.
  Окончательный серверный отказ валидации разблокирует выбор, сетевой сбой — нет.
- `PASS`: ANGLE `npm run test:unit` — первоначально 744, окончательно **745**
  тестов (включая 11 новых unit-проверок клиента checkout), 0 FAIL/SKIPPED.
  `npm run build` — PASS; сохранены предупреждения ActivityManager и основного
  чанка около 547 kB. Зависимости не обновлялись для этой задачи.
- `PASS`: `ANGLE_BROWSER=required npm run test:browser` — **210** тестов,
  0 FAIL/CANCELLED/SKIPPED, около 101 с. Новые 6 UI-сценариев работают с
  локальными заглушками и входят в обычный CI. После сокращения мобильной
  подписи плана отдельный повтор этих 6 — PASS. Последняя ветка разблокировки
  после серверной валидации отдельно покрыта финальным unit-прогоном выше.
- `PASS`: Kassa lint, schema guard (166), test:run (580 тестов), build,
  check:bundle. Modern 61.8 KiB gzip / 240, legacy 130.1 KiB / 310.
  Старые предупреждения reserve-тестов о query data/React act сохраняются.
  Гостевая поверхность не менялась; отдельная build:menu в A5 — NOT RUN.
- `PASS`: **79 SQL-файлов, 1451 проверка, 0 FAIL** в
  `angle_billing_lab_20260913`, включая 41 новую проверку checkout. Это копия
  локальной схемы 164 с техническими справочниками и 165–166, не полный
  прогон миграций с нуля. Первый перенос ACL через clean встретил ограничение
  партиций; пустая тестовая БД пересоздана и восстановлена в чистом виде с
  исходными владельцами/правами. Клиентских/финансовых данных при пересоздании
  ещё не было. Исходная локальная БД не менялась.
- `PASS`: `ANGLE_BROWSER=required node scripts/test-billing-lab.mjs angle_billing_lab_acceptance_01`;
  после визуальной правки и добавления продления — повтор на новой
  `angle_billing_lab_acceptance_02`. Настоящий Chrome → локальный HTTP →
  authenticated SQL RPC → service-only событие manual-provider с simulated=true.
  Проверены неоплаченный счёт без доступа, отказ, reload, оплата и доступ своей
  организации, параллельные повторы платежа, шесть одновременных checkout,
  подмена суммы/чужого владельца/Origin, отмена и позднее подтверждение,
  grace, прекращение доступа и восстановление только после оплаты продления.
- Сумма для имитации берётся из БД; карта/эквайринг не участвуют. В лаборатории
  используются заранее заданные синтетические владельцы, **не** настоящий
  GoTrue/PostgREST или проверка JWT. Успешный стенд не закрывает Auth/SMTP,
  подпись/доставку webhook реального провайдера и полную отрицательную A6.
- Desktop 1280 × 900 и mobile 390 × 844: просмотрены скриншоты; исправлены
  раскладка полей и перенос кнопок. Горизонтального переполнения и pageerror нет.
  Скриншоты второго прогона: временный каталог `angle-billing-ui-eY2rac`.
- Тестовые БД `angle_billing_lab_20260913`, `angle_billing_lab_a5`,
  `angle_billing_lab_acceptance_01`, `angle_billing_lab_acceptance_02`
  сохранены только локально для разбора. Ручной HTTP-стенд остановлен,
  Colima возвращена в исходное выключенное состояние; рабочие базы сохранены.
- Обновлены основной справочник биллинга, план, справочники аккаунта/БД,
  запуск и release-checklist. Валидатор теперь проверяет также ссылки
  текущего billing runbook: **7 тестов, 70 документов, 224 ссылки, 0 ошибок**;
  `git diff --check` в обоих репозиториях — PASS.
- `NOT RUN`: GitHub CI, push/deploy, production-миграции, живой Auth/SMTP,
  реальный провайдер и списания. Цены не утверждены. Для выпуска новой
  пары клиентов теперь нужна схема **166**, покупки по умолчанию выключены.
  A5 принят как локальная базовая реализация, не как готовый платёжный релиз.

## 13.09.2026 — F2, интеграция patch Claude с A5/166

- База: ANGLE `7083ed4f`, Kassa `d815a7a9` плюс рабочие A1–A5/D0/F3.
  macOS arm64, Node 22.16.0, npm 10.9.2, Chrome for Testing 150.
  Исходные SHA-256 четырёх manifest/lock совпали с отчётом Claude;
  `git apply --check` обоих patch — PASS. Перенесены ровно три файла:
  ANGLE lock, Kassa manifest/lock. Scripts, overrides, SQL и код приложений
  в рамках F2 не менялись. После чистого `npm ci --no-audit` файлы побайтно
  совпадают с проверенной копией Claude. Все resolved URL — registry.npmjs.org.
- SHA-256 после интеграции:
  ANGLE lock `264afd54b3066b05f185639c332dede02d3fa778decdeab147f27f7dc804a5e0`;
  Kassa manifest `7a4d81132e93f3cb9fc1b71d0e6e3875325adddedb4167feffce9baa83bae8da`;
  Kassa lock `10484bc073c090a5294c677cc4a55955a794600240c5cc5c46227a74f57cbdd4`.
- Основные обновления Kassa: react-router/dom 7.16.0 → 7.18.3,
  sharp 0.35.3 → 0.35.4, Vite 8.0.14 → 8.0.16 и связанные patch-зависимости;
  ANGLE — PostCSS и транзитивные зависимости сборки. Sharp обрабатывает
  загруженные заведениями изображения в операторском скрипте с service_role,
  поэтому devDependency здесь не означает отсутствие чувствительного входа.
  Сам операторский скрипт на реальном Storage не запускался.
- Свежие `npm audit --json` / `npm audit --omit=dev --json` здесь:
  ANGLE **0 / 0**, Kassa **3 moderate / 0**. Полный audit Kassa ожидаемо
  возвращает exit 1; результат не назван нулевым. Остаток — одна
  [уязвимость Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
  три записи цепочки vitest/mocker/coverage-v8. В текущем jsdom-конфиге нет
  browser mode и mocker/interceptor plugins; описанный путь не включён.
  Исправленная major-ветка — отдельная F2.1, не замаскирована overrides.
  Ошибка установки Vitest 4 в копии — наблюдение Claude, здесь NOT RUN.
- `PASS`: ANGLE **745 unit**, 0 FAIL/SKIPPED; build успешен.
  Кабинет: index-CrZ8BhSK.js, 547.38 kB / 158.67 kB gzip по Vite;
  предупреждение крупного чанка остаётся, это не новая оптимизация F8.
- Первый полный required-browser run — **FAIL**, около 132 с:
  **176 PASS, 1 CANCELLED, 0 SKIPPED**, `team.test.mjs` превысил файловый
  лимит 120 с. Во время прогона также запускалась Colima; причинная связь
  не установлена. Полный первый лог не сохранён (только хвост вывода).
  Изолированный `node --test --test-timeout=120000 backoffice/test/team.test.mjs`
  — **34 PASS**, 0 SKIPPED, 41.3 с. Лог:
  `/private/tmp/angle-f2-team-20260913.log`. Проверки/таймауты не ослаблялись;
  исчезновение сбоя в отдельном прогоне не означает исправления причины.
- `PASS`: Kassa lint, check:schema **166**, **580 тестов / 64 файла**,
  POS build и check:bundle, затем отдельный build:menu. Для обеих сборок
  использованы CI-плейсхолдеры URL/anon, не production-подключение.
  После последней команды локальный dist Kassa содержит **Menu**, не POS;
  эти проверочные артефакты не предназначены для деплоя.
- POS check:bundle: **61.5 KiB** modern entry / 240,
  **129.8 KiB** legacy entry + polyfills / 310. Это не весь startup-граф.
  Дополнительный jsx-runtime: modern **550 gzip bytes**, legacy **588**;
  entry с этим shared-чанком — **62.0 KiB**, legacy entry + polyfills + shared
  — **130.3 KiB**. В HTML подтверждён modern modulepreload; precache **136**.
  Автоматический учёт статического графа оставлен F8; T2 checklist дополнен
  холодным стартом, обновлением SW и офлайн-загрузкой shared chunks.
- `PASS`: реальный Chrome → изолированный HTTP lab → SQL checkout/payment
  на новой `angle_billing_lab_f2_acceptance_01`, схема 166. Проверены отсутствие
  доступа до оплаты и при отказе, reload счёта, успешная активация только своей
  организации, параллельные повторы, подмена суммы/владельца/Origin,
  шесть одновременных checkout, отмена и поздняя оплата, grace, истечение,
  восстановление доступа после оплаченного продления. Pageerrors и mobile
  overflow отсутствуют. Лог `/private/tmp/angle-f2-billing-20260913.log`.
  Синтетическая БД сохранена; HTTP/Chrome закрыты, Colima возвращена в
  исходное выключенное состояние. Это не настоящий Auth или платёжный провайдер.
- Полный pgTAP повторно **NOT RUN**: SQL не менялся; предыдущие 79 файлов /
  1451 проверка относятся к A5, не переписаны как сегодняшний F2-прогон.
  GitHub Actions, push/deploy, production-миграции, Auth/SMTP и реальный T2
  по-прежнему **NOT RUN**. F2 не является разрешением на выпуск всей системы.
- Повторный полный `ANGLE_BROWSER=required npm run test:browser`, уже без
  параллельного запуска Docker/сборок — **210 PASS**, 0 FAIL/CANCELLED/SKIPPED,
  **91.5 с**. Полный лог `/private/tmp/angle-f2-browser-repeat-20260913.log`.
  Таймаут первого прогона остаётся наблюдением, не объявлен устранённым.
- Итог локальной интеграции F2 — PASS с указанным ограничением стабильности
  тестов и остатком F2.1. Документы: **7 тестов валидатора, 70 документов,
  225 локальных ссылок, 0 ошибок/пропусков**. `git diff --check` обоих — PASS.

## 13.09.2026 — выпуск A1–A5/D0/F2/F3, схема 167

- Владелец явно разрешил production-миграции и push в `main` обоих репозиториев.
  Функциональные коммиты выпуска: ANGLE `d2b5a5867f46a72bcc8a19709dd89f540c0f2f0a`,
  Kassa `ce629370331c96d60c131c6e919a755be1b1a9d1`. Оба отправлены fast-forward
  в `main`; без force, без посторонних видео, `CLAUDE.md` и `.claude/launch.json`.
  Дальнейший документационный коммит не меняет прикладной код или схему.
- Первые GitHub CI были **FAIL**, а не приняты по локальному зелёному прогону.
  Улучшена диагностика первых упавших assertions в error-аннотации, без
  повышения таймаутов, retry и ослабления проверок.
  В ANGLE фикстура dashboard считала часы в зоне браузера, тогда как продукт
  сравнивает зону точки Asia/Jerusalem: в UTC получалось +113% вместо +50%.
  Исправлена только фикстура; добавлена проверка UTC/Jerusalem/Los Angeles
  с фиксированным временем. Приложение для этого отказа не менялось.
- Kassa CI с миграциями с нуля обнаружил лишние table-grants, которые старые
  106/144 не отзывали явно. Миграция **167** возвращает intended ACL:
  authenticated — только SELECT, anon/PUBLIC — без доступа к drawer_opens и
  location_slugs, service_role — полный доступ. Данные, RLS-политики и RPC
  не менялись; существовавшая RLS не позволяет назвать одни grants доказанной
  утечкой данных. Старые два отрицательных теста сохранены, добавлено 10 ACL-тестов.
- `PASS` локально: ANGLE **745 unit**, **211 browser**, 0 FAIL/CANCELLED/SKIPPED,
  полный browser около 100 с; Kassa lint, check:schema **167**, **580 тестов /
  64 файла**, POS build/check:bundle и отдельный Menu build.
  В отдельной синтетической БД: **80 SQL-файлов / 1461 проверка**, 0 FAIL.
  Сначала воспроизведён отказ старых ACL, затем тот же набор прошёл после 167.
  Это локальный прогон; применение всех миграций с нуля дополнительно проверено CI.
- `PASS` CI функциональных коммитов до main:
  [ANGLE 34740761138](https://github.com/fairgvard-sketch/angles/actions/runs/34740761138),
  [Kassa 34740764310](https://github.com/fairgvard-sketch/pos/actions/runs/34740764310).
  Обе workflow completed/success, включая Kassa database job.
- `PASS`: повтор SQL-backed billing lab на схеме 167 в новой
  `angle_billing_lab_release_167_acceptance`. Синтетические владельцы,
  отказ/оплата/replay/чужой владелец/сумма/Origin/отмена/grace/продление;
  без pageerror и mobile overflow. HTTP и Chrome закрыты, локальная БД сохранена.
  Настоящие GoTrue/JWT/PostgREST и SMTP этот стенд по-прежнему не проверяет.
- До миграций сохранены **roles/schema/data** локально в игнорируемом Git каталоге
  `kassa/backups/2026-09-13-pre-165-166-HYjZcy`, права каталога 0700, файлов 0600.
  Data dump включает auth/public/storage; проверены завершение дампа и COPY-блоки
  auth.users/public.orders без вывода содержимого. FileVault включён.
  **Restore-test, offsite и PITR не проверены**; наличие дампа не закрывает F5.
- `PASS` production: project-ref guard подтвердил `qgmnxrgtlpyqglwqmsej`;
  dry-run показал только **165–167**, без seeds/roles. Guarded `db:push --yes`
  применил эти три миграции, exit 0. Последующий read-only запрос подтвердил
  `get_schema_version() = 167`, checkout **disabled**, новые receipt-таблицы пусты,
  anon SELECT/authenticated INSERT на обеих таблицах запрещены, authenticated
  SELECT/service_role INSERT разрешены. Контрольные количества orgs/orders/
  payments/subscriptions/organization_products совпали до/после.
  Тестовые счета/аккаунты/платежи в production не создавались.
- Edge Functions не менялись и отдельно не разворачивались. Frontend выпускается
  существующими Git-интеграциями Vercel; локальный Kassa dist с CI-плейсхолдерами
  не загружался.
- `PASS` CI на main тех же функциональных коммитов:
  [ANGLE 34741197702](https://github.com/fairgvard-sketch/angles/actions/runs/34741197702),
  [Kassa 34741198564](https://github.com/fairgvard-sketch/pos/actions/runs/34741198564).
  GitHub Vercel-статусы этих SHA — success для ANGLE, POS и angle-menu.
  Read-only HTTP-проверка трёх канонических доменов: страницы, перечисленные
  в HTML JS/CSS/modulepreload возвращают 200 и правильный content-type.
  Новые entry: кабинет `index-Cv1AIs3r.js`, POS `index-CddUVK6g.js`,
  Menu `index-BQ0Vcfr2.js`; они отличаются от предрелизных артефактов.
  POS `jsx-runtime-DGeXAQPT.js` также доступен. Это статический smoke-test,
  не приёмка клиентских операций или офлайн-обновления установленной кассы.
- Colima после локальных проверок/дампа возвращена в исходное выключенное
  состояние; все рабочие и синтетические базы сохранены. Текущий план разделён:
  здесь A6 → изолированный Auth-контур, Claude F2.1 → отдельно F8.1 после приёмки.
- Всё ещё **NOT RUN**: живая приёмка A1–A5 через Auth/PostgREST/SMTP,
  полный A6 с реальными JWT, физический T2/SW/offline/печать и восстановление
  актуальной резервной копии. Реальный провайдер, цены и налоговая регистрация
  не приняты. Этот технический выпуск не означает готовность всех функций к продаже.

## 13.09.2026 — A6: digital-границы, каталог и прямой REST

- База: ANGLE `ddaa19b`, Kassa `34b7947`; ветки `codex/a6-access-boundaries`.
  F2.1 передан Claude; manifest/lock, зависимости и Vitest не менялись.
  Чужие `CLAUDE.md`, `.claude/launch.json` и видео сохранены вне нашего patch.
- Подтверждены серверные пробелы: 129 потеряла capability-гейт `save_menu_item`,
  128 не проверяла продукт в массовой правке; прямые catalogue writes обходили
  продукт/manage-роль; UUID FK допускали связи с чужими родителями; direct reads
  Orders/Reserve и старый digital JWT обходили соответствующие ограничения.
  Исходная 30-сценарная SQL-матрица на 167: **22 FAIL / 8 PASS** (часть поздних
  отказов — следствия более ранних разрешённых мутаций, не 22 разных дефекта).
  Лог `/private/tmp/angle-a6-baseline-167.log`.
- Миграция **168**: digital `auth_org_id()` проверяет активное членство, каталожные
  REST-пути проверяют capability/роль, save/bulk имеют закрытые ungated-тела,
  связи каталога проверяют tenant родителя; прямые Orders/Reserve reads —
  capability точки. Storage write-гейт сохраняет оформление Reserve без Menu;
  публичность готовых гостевых изображений не менялась. Нет удаления/переноса
  данных, смены режима оплаты, изменения PIN/hot-flow или финансовой логики.
  У новых SECURITY DEFINER helpers явный `public, pg_temp`; тест подмены
  membership-таблицы через временную схему отвергается.
- `PASS`: **81 SQL-файл / 1513 проверок**, включая **52 A6-сценария**, на новой
  `angle_billing_lab_a6_final_20260913` (schema-only локальный baseline 164,
  технические справочники, затем 165–168). Каждый файл в rollback-транзакции;
  проверены exit/signal, отсутствие `not ok` и совпадение TAP-плана.
  Лог `/private/tmp/angle-a6-sql-168-final.log`.
  Четыре старые fixture-настройки получили необходимый активный продукт
  (bulk/partial/recipes/CRM reservation reads), assertions данных сохранены.
  Три ожидания отказа без членства теперь `not authenticated`: отказ происходит
  раньше, в общем tenant helper, а не только в backoffice-RPC.
- Один промежуточный SQL-прогон завис в Docker-клиенте уже после завершения
  запроса PostgreSQL. Остановлен только подтверждённый клиент этого прогона;
  такой прогон не принят как чистый. Повтор с лимитом 30 с на файл и строгой
  проверкой status/signal прошёл, затем полностью повторён на окончательной 168.
- `PASS`: **17 настоящих HTTP/JWT-проверок** отдельного PostgREST v14.5,
  последний прогон `angle_billing_lab_a6_http_final_20260913`.
  Проверены подпись JWT/anon, unpaid RPC/direct read, чужие строки/родители,
  read-only роль, отзыв/удаление членства с тем же подписанным JWT, SD-RPC,
  работоспособность другого tenant. Токены выпущены тестом с одноразовым ключом,
  **не GoTrue**. Подключение только к новой локальной БД через localhost;
  production/.env не использовались. Временный HTTP-контейнер удалён в finally,
  БД сохранена. Скрипт — `scripts/test-account-access-http.mjs`.
- Клиент: context RPC связан с исходным access token; ответ другой организации
  не публикуется. Две новые unit-регрессии сначала FAIL, после правки PASS.
  `PASS`: ANGLE **747 unit**, полный required-browser **219**, 0 FAIL/CANCELLED/
  SKIPPED, около 108 с; build PASS. Из них 7 новых UI-сценариев проверяют
  запрещённые deep links, выход/вход, поздние ответы и смену организации.
  Первый изолированный Chrome-запуск внутри файловой песочницы упал до тестов
  с TargetCloseError; разрешённый запуск вне неё и полный прогон прошли.
  Проверки/таймауты harness не ослаблялись. Browser log:
  `/private/tmp/angle-a6-browser-full.log`.
- `PASS`: Kassa lint, check:schema **168**, **580 тестов / 64 файла**, POS build,
  check:bundle **61.5 / 129.8 KiB gzip**, отдельный Menu build. Использованы
  CI-плейсхолдеры env; локальный dist содержит Menu и не предназначен для
  загрузки как POS. Остаток Vitest-аудита — задача Claude, здесь не пересчитывался.
- `PASS`: прежний SQL-backed billing acceptance на новой
  `angle_billing_lab_a6_payment_20260913`, схема 168: unpaid/decline/paid,
  replay/concurrency/foreign owner/amount/Origin/cancel/grace/expiry/renewal;
  desktop/mobile без pageerror/overflow. Это по-прежнему не настоящий провайдер.
- Справочники аккаунта, БД/продуктов/биллинга, AGENTS и план обновлены.
  Полный A6 остаётся открытым: реальный GoTrue/письма, оставшаяся инвентаризация
  API, совмещённые POS/device identities и multi-location-подписки требуют
  отдельной приёмки. Legacy device JWT с location_id и мягкий PIN hot-flow
  намеренно не менялись; отзыв digital membership не объявляется отзывом устройства.
  Auth/SMTP, физический T2 и restore-test актуальной копии — **NOT RUN**.
- На момент локальной приёмки production остаётся на 167; применение 168,
  push/main и деплой этим прогоном не подтверждаются. CI и итог выпуска — ниже.

### Выпуск A6/168 — 13.09.2026

- Функциональные коммиты: ANGLE **`ffc8f6b`**, Kassa **`b1f0a9e`**.
  `PASS` CI рабочих веток:
  [ANGLE 34743251412](https://github.com/fairgvard-sketch/angles/actions/runs/34743251412),
  [Kassa 34743431535](https://github.com/fairgvard-sketch/pos/actions/runs/34743431535).
  Kassa заново применила миграции с нуля и выполнила pgTAP, дополнив локальную
  проверку от schema-only baseline. У обоих checkout CI только закоммиченные файлы.
- Отправку рабочих веток первоначально остановил автоматический reviewer.
  До повторной оценки выполнена read-only сверка: это существующие публичные
  `fairgvard-sketch/angles` и `fairgvard-sketch/pos`, те же origin/main ранее
  разрешённого выпуска. Повторные отправки разрешены и выполнены; запрет не
  обходился сменой адреса или преждевременным push в main.
- Production preflight: guard подтвердил `qgmnxrgtlpyqglwqmsej`, схема 167,
  checkout disabled. Во всех восьми проверенных типах связей каталога нет
  cross-tenant references; действующих digital-аккаунтов без membership и
  устройств без catalog capability не обнаружено. Читались агрегаты, не PII.
  Первый диагностический SELECT ошибочно называл `orgs` как `organizations`;
  он завершился ошибкой без изменений, исправленный preflight прошёл.
- Свежий backup схемы 167: `kassa/backups/2026-09-13-pre-168-WDIHXj`.
  roles **297 B**, schema **942485 B**, data **536557 B**; auth/public/storage,
  COPY auth.users/orders и footer проверены. Каталог 0700, файлы 0600,
  FileVault On, Git-ignored. CLI автоматически повторила подключение через
  IPv4 pooler после недоступного IPv6; все три дампа завершились exit 0.
  Предупреждение о циклическом FK guests сохранено как условие restore-runbook,
  не как доказательство успешного восстановления. Restore/offsite/PITR **NOT RUN**.
- `PASS` guarded dry-run: только **168**, без seeds/roles. Затем разрешённый
  `npm run db:push -- --yes` применил 168, exit 0. Postcheck: schema **168**,
  checkout **disabled**, 36 catalogue policies, 8 operational read policies,
  3 image policies, 6 tenant triggers и 6 helpers с явным `public, pg_temp`.
  Ungated save/bulk bodies недоступны authenticated; save body также закрыто
  для service_role, публичная обёртка authenticated доступна, anon запрещена.
  Контрольные количества orgs/orders/payments/subscriptions/product grants/
  checkout requests и preflight-агрегаты совпали до/после. Тестовых аккаунтов,
  платежей и других клиентских операций в production не создавали.
- После schema postcheck выполнен fast-forward и push **main обоих репозиториев**.
  `PASS` CI тех же функциональных SHA на main:
  [ANGLE 34743758772](https://github.com/fairgvard-sketch/angles/actions/runs/34743758772),
  [Kassa 34743773369](https://github.com/fairgvard-sketch/pos/actions/runs/34743773369).
  Vercel success для ANGLE, POS и angle-menu. Edge Functions/APK не менялись,
  локальный dist с placeholder env не публиковался.
- `PASS` read-only smoke канонических `/`, `/account/`, POS `/setup`, Menu `/`:
  HTML и все перечисленные JS/CSS возвращают 200 с правильными content types.
  Кабинет **`index-DctEONLV.js`**, POS **`index-C7Mk36eb.js`**;
  Menu **`index-BQ0Vcfr2.js`** ожидаемо не изменился (168 не меняет его bundle).
  Legacy entry/polyfills и POS modulepreload jsx-runtime доступны. Это не
  приёмка физического T2, service-worker update или живых клиентских операций.
- Временных A6 HTTP-контейнеров не осталось. Colima возвращена в исходное
  выключенное состояние без удаления исходной базы и новых лабораторий.
  Документация синхронизирована, устаревшие текущие отметки «первый CI NOT RUN»
  исправлены; исторические результаты сохранены отдельно.
- Следующая работа здесь: изолированный GoTrue с перехватом писем и настоящим
  signup/recovery/onboarding; затем оставшиеся A6 API/device/location случаи
  и restore. Claude продолжает F2.1 в копии; после приёмки — отдельный F8.1.
  Полный A6 и готовность продукта к продаже этим техническим выпуском не закрыты.
- После функционального выпуска извне появились untracked-копии с суффиксом
  ` 2` в обоих рабочих деревьях (docs, код, тесты, включая копии 165/166).
  Владелец подтвердил, что копии создал Claude; они не создавались этой работой, не удалены
  и не включены в коммиты. Из-за 32 неиндексированных Markdown-копий локальный
  check:docs завершился ошибкой; его правила не ослаблялись. Документационный
  коммит проверяется в чистой извлечённой версии обоих Git-деревьев и CI.
  Перед следующим запуском тестов/миграций в исходных папках разобраться с
  дублями: не выполнять новый db:push по загрязнённому списку миграций.

## 13.09.2026 — F2.1: интеграционная приёмка patch Claude на 168

- A6 финальные документационные main-коммиты **`16717fd` / `2894a19`**
  опубликованы, CI PASS:
  [ANGLE 34744274970](https://github.com/fairgvard-sketch/angles/actions/runs/34744274970),
  [Kassa 34744279529](https://github.com/fairgvard-sketch/pos/actions/runs/34744279529).
  Production остаётся schema168, checkout disabled.
- F2.1 Claude получен из `fab0524d-1ec1-4a62-99f9-d60ba4895ffc/scratchpad/f2.1/artifacts`.
  Исходные SHA-256 manifest/lock совпали с отчётом, apply-check PASS.
  Применены только package.json, lock и coverage-конфигурация; здесь добавлены
  `/coverage/` в .gitignore и актуальная инструкция development.
  Коммит Kassa **`91245d9`**, локальная ветка `codex/f2-1-vitest5`.
  CLAUDE.md, .claude, видео и untracked-дубли не включены.
- Lock review: **0 изменений non-dev записей**, resolved URL только npm registry.
  Vitest/coverage-v8 **5.0.0**; более новая ветка выбрана из-за воспроизведённого
  Claude npm/arborist сбоя 4.1.11 на Node22.16/npm10.9.2. Матрицу пустых проектов
  повторно не запускали: прочитаны отчёт и первичные источники
  [advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
  [migration guide](https://vitest.dev/guide/migration/).
  Требования Node/Vite совместимы; новое default clearMocks описано в справочнике.
- Независимая копия текущего Git-дерева без .env и дублей:
  `/private/tmp/kassa-f21-review-SAtcpD`, **Node22.16.0 / npm10.9.2 / schema168**.
  `PASS` чистый npm ci (648 установленных пакетов), audit all и omit=dev —
  **0**, package-lock-only npm install без обходов; manifest/lock хеши не изменились.
  `PASS` lint, check:schema **168**, test:run **64 файла / 580 тестов**, ещё
  **580 PASS** с coverage. Assertions/jsdom/test setup не менялись.
- Coverage: **204 файла**, statements25.10%, branches19.01%, functions18.38%,
  lines26.54%. Пропуск `uniform-format-export/index.ts` с ошибкой parse/import type
  воспроизведён, exit0 не означает полного отчёта. Не добавляли exclude для
  скрытия ошибки. Проценты 3.x/5.x напрямую несопоставимы и не доказывают
  улучшения покрытия; дальнейшая корректная обработка Deno остаётся открытой.
  Лог `/private/tmp/kassa-f21-acceptance.log`.
- `PASS` POS build/check:bundle **61.5/129.8 KiB gzip**, отдельный Menu build.
  Для корректного сравнения создан чистый baseline168 без F2.1:
  `/private/tmp/kassa-f21-baseline-dtCfjV`; оба варианта собраны с одинаковыми
  CI-плейсхолдерами, без .env. Совпали все **95 POS и 17 Menu JS/CSS hash names**,
  **67 файлов Menu совпали побайтно**. Сравнение со старым локальным A6-логом
  сначала дало разные хеши: тот прогон имел другое окружение и не принят как
  доказательство изменения bundle. Корректный baseline/после совпали.
  Логи `/private/tmp/kassa-f21-{pos-build,menu-build,baseline-pos,baseline-menu}.log`.
- Попытка push новой ветки **отклонена auto-review**: разрешение на main
  признано недостаточно конкретным для этой ветки/payload публичного GitHub.
  На тот момент отказ не обходился push напрямую в main или сменой адреса:
  F2.1 **не опубликован**, CI **NOT RUN**, запрошено уточнение разрешения владельца.
  Предыдущий A6/main/deploy уже выполнен и этим отказом не затронут.
- SQL не менялся; локальный pgTAP повторно не запускался, Colima остаётся
  выключенной. T2, Auth/SMTP, restore и coverage Deno entry не объявлены принятыми.
  После CI F2.1 — отдельное задание Claude F8.1; здесь далее Auth-контур.

### Завершение выпуска F2.1

- После сообщения об отказе владелец повторно явно разрешил миграции и push
  **именно в main**. На основании нового подтверждения выполнен fast-forward
  Kassa `2894a19 → 91245d9` и push main. Отклонённый push feature-ветки не
  повторялся. В F2.1 SQL нет; production-миграции повторно не применяли.
- `PASS` [Kassa CI 34744873586](https://github.com/fairgvard-sketch/pos/actions/runs/34744873586)
  на `91245d9`: frontend и database (миграции с нуля + pgTAP). Vercel POS и
  angle-menu success. Повторный read-only smoke HTML/JS/CSS — 200;
  production entries остались **`index-C7Mk36eb.js` / `index-BQ0Vcfr2.js`**.
  Это не новая аппаратная/пользовательская приёмка.
- Локальные node_modules Kassa синхронизированы чистым npm ci по принятому
  lock; 648 установленных пакетов, audit0. Неполный Deno coverage описан,
  .gitignore больше не собирает coverage-артефакты. Общий план актуализирован:
  F2.1 закрыт с указанным ограничением метрики, F8.1 подготовлен для Claude,
  но ещё не передан/не начат по подтверждённым данным.
- Здесь следующий блок — F4/GoTrue с перехватом писем, затем остаток A6 и restore.
  Дубли Claude остаются вне Git; чистая проверка обоих извлечённых Git-деревьев
  прошла (7 тестов валидатора, 70 документов / 226 локальных ссылок, 0 ошибок).

## 13.09.2026 — F4: локальный GoTrue/SMTP/PostgREST и сквозной путь A1–A5

База: ANGLE main `d1a1878`, Kassa main `91245d9`, схема 168 в новых
лабораториях. Runtime-код, зависимости/lock, миграции, production и рабочая
папка Kassa не менялись. Добавлены `scripts/auth-lab.mjs`, guard-тесты и
`scripts/test-auth-lab.mjs`; npm-команда `test:auth:lab`. Четыре guard-теста
включены в обычный unit/CI. Полный Docker/Auth-прогон opt-in, не выдаётся за CI.
Claude F8.1 передан владельцем и идёт отдельно; его файлы не затронуты.

Среда: macOS, Node 22.16.0, Chrome for Testing 150; локальные
GoTrue 2.192.0 / PostgREST 14.5 / Postgres 17.6.1.141 и Mailpit 1.31.1.
Mailpit image digest: `sha256:98b916bd3c8d61f7633a52d3ea2f58d00620cb01ca57ab59edde68c347a95365`.
Новая БД на существующем локальном Postgres, отдельные Auth/REST/SMTP-контейнеры,
новый JWT-ключ. Копировались схема и технические справочники/история миграций,
не пользователи или бизнес-данные. Строгий prefix/new-name guard; loopback-порты;
существующая исходная локальная БД сохранила версию **164**.

| Проверка | Результат |
|---|---|
| Полный локальный Auth-прогон | 23/23 PASS на `angle_auth_lab_accept6_20260913` |
| Итоговый повтор на новой БД с финальным lifecycle runner | 23/23 PASS на `angle_auth_lab_final_20260913` |
| `npm run test:unit` | 751 PASS, 0 failed/skipped |
| `ANGLE_BROWSER=required npm run test:browser` | 219 PASS, 0 failed/skipped, 104.2 с |
| Build с placeholder Auth env | PASS; прежнее предупреждение о chunk >500 kB не подавлялось |
| Тесты валидатора docs | 7 PASS |
| Docs в исходном dirty tree | 32 ошибки классификации исключительно сохранённых копий ` 2.md` |
| Чистый состав релиза: ANGLE index + Git HEAD Kassa | 70 документов, 232 локальные ссылки, 0 ошибок |

Сценарии: отказ перезаписи БД; anonymous RPC; UI-signup и SMTP; вход до
подтверждения; resend/verify и очистка URL; потеря успешного ответа создания
заведения после commit → перезагрузка → повтор без дублей; refresh реального JWT;
disabled checkout; UI-счёт без доступа и отказ клиентскому payment RPC (`42501`);
серверная локальная имитация оплаты → paid UI → обновление capability; повтор
confirmation; recovery через письмо/reload/save; старый и новый пароль; повтор
reset-ссылки; обычный UI-вход; изоляция второго аккаунта/счёта/подписки;
ссылка A при вошедшем B; смена аккаунта между вкладками; refresh-token rotation;
выход между вкладками; expired/damaged token; query marker без recovery-события;
ровно два владельца/заведения, без JS-ошибок и внешних запросов браузера.

Диагностика самого нового набора (не регрессии продукта):

- Первая попытка resend попала в сохранённый локальный SMTP throttle 1 с;
  тест теперь явно выдерживает интервал. Боевая политика не менялась.
- Разрыв сокета после commit привёл к прозрачному повторному POST браузера:
  сервер вернул то же заведение, дубля нет. Для проверки **ручного** retry
  proxy теперь заменяет успешный upstream-ответ на 502 после его завершения.
- Ожидание `requestAnimationFrame` в фоновой вкладке истекало при уже
  правильном состоянии `ready` владельца B. Ожидание состояния переведено
  на polling 100 мс; вкладка остаётся фоновой, assertions сохранены.

Платёж — только service-role SQL в новой лаборатории, сумма/валюта из
сохранённого счёта. Ни платёжного HTTP-backdoor, ни кнопки fake payment в
production не добавлено. Для expired email сдвинут `recovery_sent_at` только
синтетического пользователя, затем выполнен настоящий GoTrue verify.
Ни prod SMTP/redirect/templates, ни внешняя доставка, ни webhook провайдера,
ни Kong/Storage/Realtime, ни POS/T2 этим прогоном не приняты. A1–A6 целиком
не закрываются; далее оставшиеся API/device/multi-location и актуальный restore.

Логи локально: `/private/tmp/angle-auth-acceptance-DqG1Kj/`
(`auth-final.log`, `unit.log`, `browser.log`, `build.log`, `docs-unit.log`,
`docs-worktree.log`). Токены/пароли/ссылки писем не выводились.
После прогонов собственных `angle-auth-*` контейнеров — 0; тестовые БД
сохранены, пользовательские дубли и резервные копии не удалялись.
Colima возвращена в исходное состояние OFF. После интеграционного прогона
добавлен отдельный guard против будущих/переименованных миграций Kassa;
он проверен unit-тестом и на фактическом списке файлов (копии ` 2` игнорируются).
Чистый проверочный снимок: `/private/tmp/angle-auth-docs-Y8I8dM/`.

## 13.09.2026 — приёмка F8.1: patch пока не принят, требуется R1

Исходные HEAD: ANGLE `c8bf93b`, Kassa `91245d9`. Отчёт и patch Claude
получены из `/private/tmp/claude-501/-Users-enotov-Desktop-kassa/9dbacc8c-25d2-4158-92c9-87998e9a7ffb/scratchpad/`.
В исходную Kassa ничего не применялось; её tracked-отличие по-прежнему только
пользовательский `CLAUDE.md`. Runtime/БД/production не менялись, push/deploy
по F8.1 не выполнялись.

Независимые проверки здесь, Node 22.16.0:

- `git apply --check f8.1-startup-js-budget.patch` на Kassa main — exit 0.
- 19 исходных тестов Claude через Node runner — 19 PASS.
- 8 новых регрессий через **настоящий CLI** на синтетических dist — 0 PASS,
  8 FAIL, общий exit 1. Это ошибки проверяемого скрипта, не тесты продукта.

| Сценарий | Ожидалось | Получено |
|---|---|---|
| Нет module-entry, но есть modulepreload | exit 1 | exit 0 / OK |
| `import "/assets/missing.js"` | exit 1 | exit 0 / OK |
| `import "https://cdn.example.test/shared.js"` | exit 1 | exit 0 / OK |
| `import "./missing.js#v1"` | exit 1 | exit 0 / OK |
| Существующий `./shared.js?v=1` | exit 0, файл учтён | exit 1, ищется имя с query |
| Текст `import "./ghost.js"` внутри JS-строки | exit 0 | exit 1, ложная зависимость |
| Module-script внутри HTML-комментария | exit 0 | exit 1, ложный entry |
| Текст `System.register` внутри JS-строки | exit 0 | exit 1, ложная legacy-зависимость |

Код воспроизведения и полный лог:
`/private/tmp/angle-f81-review-DkbhLb/review-regressions.mjs` и
`/private/tmp/angle-f81-review-DkbhLb/review-regressions.log`.
Регрессии не требуют браузера/сборки и не меняют настоящий dist. Причины
подтверждены чтением кода: проверка `modern.length` допускает preload без
entry; regex импортов не различает синтаксис/строки и отсекает адреса до
валидации; query ошибочно остаётся частью файлового пути.

Два замечания Claude также подтверждены чтением конфигурации: Node-набор
не входит в `test:run`/CI, а `coverage.exclude` не исключает `.test.mjs`.
Решение и ограниченное расширение области записаны в задании F8.1-R1 общего
плана: отдельный `test:bundle`, общий `test:all`/CI, только тестовые расширения
в coverage.exclude. Coverage самого CLI в Vitest и Node-прогон не смешивать.
Полные build/580 тестов/coverage повторно здесь не запускались: сначала
исправляются воспроизведённые блокеры приёмки. Заявленные Claude размеры
и хеши в этой итерации не выдаются за независимую проверку здесь.
`git diff --check` — PASS. `check:docs --require-kassa` в исходном дереве
по-прежнему даёт 32 ошибки только сохранённых ` 2.md`; все 232 локальные
ссылки проверены, новых ошибок ссылок/классификации от этой правки нет.

## 13.09.2026 — F8.1-R1 принят: статический граф, обязательные тесты и обе сборки

База Kassa `91245d9`, ANGLE `c8bf93b`. Совокупный R1 Claude получен из
`/private/tmp/claude-501/-Users-enotov-Desktop-kassa/4dfd3f83-eb73-405c-a201-7b9b29e8c458/scratchpad/work/`.
Проверочная копия здесь — чистый `git archive 91245d9`, без `.env`, backups,
пользовательских дублей и исходного `node_modules`; Node 22.16.0/npm 10.9.2,
чистый `npm ci` из lock. Исходные 35 тестов R1 и неизменённые 8 независимых
регрессий предыдущей приёмки — PASS.

Дополнительное чтение и четыре новых CLI-регрессии выявили ещё четыре ложных
OK в R1: внешний статический импорт внутри `data:`, data-entry вместо файла
в HTML, пропущенный статический импорт inline HTML-модуля и повреждённый JS
(`import {`). До правки — 0/4 PASS. Исправлено здесь в рамках тех же файлов:
`data:text/javascript,` допускается только после разбора и проверки отсутствия
статических зависимостей; иные формы дают отказ. HTML data-entry отвергается,
ошибка парсера больше не выдаётся за полный граф. Артефакты не исполняются.

Первый вариант guard отвергал реальный POS HTML: detector Vite присутствует
также в inline HTML, а не только внутри entry. Это **ошибка промежуточной
проверки**, не дефект приложения; исправлена по фактическому выводу и исходнику
установленного `@vitejs/plugin-legacy`. Dependency-free detector разрешён в
обоих местах, вложенные зависимости по-прежнему дают отказ. Добавлено 7 тестов
без ослабления прежних assertions; финальный набор — 42 теста.

Независимые финальные проверки в объединённой чистой копии:

| Проверка | Результат |
|---|---|
| `npm ci` | PASS, 648 пакетов; SHA-256 lock совпадает с исходным |
| `npm run test:all` | PASS: 580 Vitest / 64 файла + 42 Node-теста, 0 skipped |
| 8 прежних + 4 новых CLI-регрессии | 12 PASS |
| `npm run lint` / `npm run check:schema` | PASS / v168 |
| POS build + budget | PASS: modern 62.0 / 240 KiB, legacy 130.3 / 310 KiB |
| Menu build + budget | PASS: modern 61.5 / 240 KiB, legacy 129.5 / 310 KiB |
| `npm audit --json` | 0 уязвимостей, включая dev |
| `npm run test:run -- --coverage` | PASS, 580 тестов; известный Deno parse-warning сохранён |
| Docs в чистом совместном снимке | 70 документов, 233 ссылки, 0 ошибок |

POS precache 136, Menu 58 entries; имена entry совпадают с R1 baseline Claude:
POS `index-DOxngdrt.js`, Menu `index-CeHYBQC9.js`. Полное сравнение хешей
до/после — доказательство в отчёте Claude; здесь независимо проверены сборки,
состав графов и отсутствие runtime/lock-изменений, но отдельный baseline build
повторно не делался.

Coverage финального объединения: statements **24.70%**, branches **18.77%**,
functions **18.24%**, lines **26.10%**. Это не 24.74% из отчёта R1: здесь
добавлены guards. Исходный F2.1 baseline — 25.10/19.01/18.38/26.54;
рабочий скрипт остаётся в знаменателе, его отдельный Node-runner не входит в
Vitest coverage. Исключён только `.test/.spec.mjs`, не `scripts/**`.
`uniform-format-export/index.ts` всё ещё пропускается самим coverage-parser:
метрика неполна, причина не скрыта новым exclude.

Kassa **`c7dd34026ddb299c9200836398f3b957c21ff9b9`** отправлен в `origin/main`
по разрешению владельца. В коммите ровно семь согласованных файлов; SQL,
runtime, зависимости/lock и budgets не менялись. `CLAUDE.md`, все ` 2`-копии
и остальные пользовательские untracked-файлы сохранены вне коммита.
GitHub Actions нового SHA — [34748759332](https://github.com/fairgvard-sketch/pos/actions/runs/34748759332),
пока **queued**, не PASS; старый зелёный запуск на `91245d9` не считается
подтверждением этого выпуска. Автоматические Vercel-статусы `pos` и
`angle-menu` на `c7dd340` — success. Read-only smoke: POS `/setup` и корень
Menu — HTTP 200; production entry остались `index-C7Mk36eb.js` и
`index-BQ0Vcfr2.js`. Это проверка доступности HTML, не ручная приёмка функций.

Логи и независимые регрессии: `/private/tmp/angle-f81-r1-accept-B0hoL5/`
(`test-all-final.log`, `regressions-final.log`, `inline-before.log`,
`lint-final.log`, `schema.log`, `build-pos.log`, `build-menu.log`,
`budget-pos.log`, `budget-menu.log`, `coverage-final.log`, `audit.json`).
Физический T2/печать, cold-start/SW, внешний SMTP и F5 restore не выполнялись.
Production БД и checkout в этом блоке не менялись; миграций нет.

## 13.09.2026 — F5: изолированное восстановление, Storage и защита бэкапов

База кода: Kassa `c7dd340`, ANGLE `c42dab6`; текущая схема приложения 168.
Владелец согласовал RPO ≤15 минут и RTO ≤1 часа. Это целевые требования,
не результат замера. Production в этом блоке не изменялся; платные настройки
не включались, новая удалённая копия обновлённым скриптом не создавалась.

### Восстановление и целостность

Источник: закрытая Git-ignored копия
`kassa/backups/2026-09-13-pre-168-WDIHXj`, схема **167**, сохранённая до 168.
Каталог 0700, файлы 0600, FileVault On. SHA-256 `data.sql`:
`6c4a9f27dc2264fb5a4ef2eada20035ac465c813d0809922a762bdd426c23b45`.
Дамп содержит Auth/PIN/гостевые данные: строки, токены и SQL-содержимое в
отчёт/Git не передавались. Custom roles в этой копии не было.

Использован отдельный контейнер `angle-restore-f5-20260913-0azxf8`,
Supabase Postgres `17.6.1.141`, `network none`, без портов и host/persistent
mounts, PGDATA в tmpfs. Существующая локальная БД Kassa не сбрасывалась.
Auth/Storage bootstrap приведён к совместимой технической схеме schema-only
переносом из локального сервиса, без данных и прикладных Storage policies.
Прямой перенос всех policies сначала отказал на ещё отсутствующем
`public.auth_org_id()`; исправлен порядок DDL, данные тогда ещё не загружались.
Все канонические миграции **001–167** применены с нуля с ledger.

| Проверка | Фактический результат |
|---|---|
| auth/public COPY | **93/93 таблицы, 1 585 строк**: совпали количества и SHA-256 отсортированных COPY-строк |
| Sequences | **5/5**, совпали `last_value` и `is_called`, включая отдельный invoice counter |
| Деньги | Расхождения выданных/оплаченных заказов с платежами (с чаевыми), refund-платежей — **0** |
| Чеки и смены | Счётчики/пропуски чеков и возвратов по точкам, cash_diff закрытых смен — **0** расхождений |
| Связи | **217 FK, 4 974 ссылки**, отсутствующих родителей и проверенных cross-org связей — **0** |
| Склад | **3 проводки**, повторного проведения триггерами нет; после загрузки режим `origin` |
| Ошибка в середине COPY | После первых 30 блоков искусственная ошибка `22012`; все таблицы откатились, хеши совпали с состоянием до попытки |
| Миграция 168 на восстановленной копии | PASS; хеши всех **93 таблиц неизменны**, проверки повторно PASS, checkout `disabled` |

Отказ проверялся **до setval**. PostgreSQL не откатывает sequence setval;
это ограничение отдельно внесено в runbook, после такого отказа target нельзя
просто использовать повторно. Время успешной загрузки и сверки таблиц —
4 188 мс, **не RTO**: provisioning/подготовка схем, конфигурация, Storage,
внешний Auth, клиенты и операционные действия в него не входят.

Новый [SQL-верификатор](../../kassa/scripts/verify-restored-data.sql) проверен
на восстановленной 168: положительный прогон, намеренно неверный receipt
counter, отключённые триггеры, повторный положительный прогон. Отказы дают
`23514`/ненулевой exit; изменение counter откатывается. Отдельный локальный
pgTAP wrapper — **5/5 PASS**. Полный продуктовый pgTAP suite локально в F5
не запускался: прикладные миграции/RPC не менялись. После push он прошёл в
database job CI ниже. FK/org-проверка не подменяет полный RLS-аудит.

### Storage и реальная защита production

В дампе 78 Storage metadata-строк; найдены 27 уникальных используемых публичных
объектов, для **27/27** есть метаданные. После отдельного разрешения владельца
выполнены только HEAD к `qgmnxrgtlpyqglwqmsej.supabase.co`, без токенов,
скачивания, изменения файлов и передачи дампа: **27 HTTP 200, 0 отказов**.
Это не backup файлов. Blob-копия и её восстановление **не подтверждены**.

Владелец вошёл в Dashboard. Read-only просмотр Scheduled backups и PITR
подтвердил **Free Plan**: managed backups не входят, PITR требует платного
плана/add-on. Официальные ограничения —
[Supabase Backups](https://supabase.com/docs/guides/platform/backups).
Внешняя зашифрованная копия не подтверждена. **RPO 15 минут не обеспечено,
полный RTO 1 час не испытан.** Нужны выбор владельца, настройка защиты,
контроль просрочки/отказов, копия Storage и полный сервисный drill.

### Изменения и проверки кода

[db-dump](../../kassa/scripts/db-dump.mjs) больше не перезаписывает копию
того же дня: уникальные private-каталоги, guard при прямом вызове,
ограниченные по времени команды, закрытые partial-файлы и финальный manifest
с размерами/хешами. Чувствительный stderr не печатается. Manifest не объявляет
копию восстановленной и не включает Storage. Успешный exit с пустым или
обрезанным data-файлом отклоняется; actual Supabase footer-формат закреплён тестом.
Добавлен `test:ops` в общий `test:all`/CI. Обновлены runbook, команды и
индекс Kassa; общий docs guard теперь проверяет также backups/development.

Чистый совместный Git-export без `.env`, backups, зависимостей и ` 2`-копий;
поверх скопированы только F5-файлы. Node 22.16.0 / npm 10.9.2, чистый `npm ci`
из неизменённого lock: **0 vulnerabilities**.

| Проверка | Результат |
|---|---|
| Kassa lint / check:schema | PASS / v168 |
| `test:all` | **580 Vitest + 42 bundle + 11 ops**, 0 падений |
| POS build / check:bundle | PASS; modern **62.0**, legacy **130.3 KiB** |
| Menu build / check:bundle | PASS; modern **61.5**, legacy **129.5 KiB** |
| Docs guard | **8/8** тестов; 70 документов / 250 ссылок / 0 ошибок в чистом совместном снимке |

Entry-файлы совпали с предыдущей локальной сборкой F8.1:
POS `index-DOxngdrt.js`, Menu `index-CeHYBQC9.js`. Runtime, зависимости,
прикладная схема и thresholds не менялись. Browser/T2/SMTP/production restore
в этом прогоне **NOT RUN**. Coverage повторно не измерялся; Node ops-runner,
как bundle-runner, не добавляет покрытие рабочему скрипту в Vitest.

После проверок удалён только временный контейнер с RAM-копией. Исходный
backup-хеш не изменился, основная локальная БД осталась на 164. Colima,
выключенный до начала F5, снова остановлен. Пользовательские локальные базы,
`CLAUDE.md`, ` 2`-копии и прочие untracked-файлы сохранены.

Локальные артефакты: `/private/tmp/angle-f5-restore-0Azxf8/` (закрытые
диагностические файлы, counts-only JSON и скрипты прогона) и
`/private/tmp/angle-f5-accept-jt6EYl/` (чистый snapshot и логи проверок).
Они не являются внешним архивом и в Git не включены.

Свежая проверка предшествующего выпуска: ANGLE `c42dab6`,
[CI 34748844810](https://github.com/fairgvard-sketch/angles/actions/runs/34748844810)
— **success**; Kassa `c7dd340`,
[CI 34748759332](https://github.com/fairgvard-sketch/pos/actions/runs/34748759332)
по-прежнему **queued**, не PASS. Итоги CI следующих SHA проверяются отдельно.

F5 Kassa опубликован в `origin/main`:
**`157d2aa57500143ef71df3cf06edce23c8e645be`**, ровно 9 перечисленных файлов
кода/тестов/инструкций, без пользовательского `CLAUDE.md` и копий.
[CI 34752913138](https://github.com/fairgvard-sketch/pos/actions/runs/34752913138)
— **PASS**, включая frontend и database jobs. Автоматические Vercel `pos` и
`angle-menu` — **success** на этом SHA. Read-only smoke: POS `/setup` и Menu
отвечают HTTP 200; entry остались `index-C7Mk36eb.js` и `index-BQ0Vcfr2.js`.
Это не ручная приёмка функций. Миграций и ручного production-деплоя в F5 нет.

ANGLE `ed9d9611c66b5ce12e429fdbd34dec6897fdb35f` опубликован в `origin/main`:
план, журнал, правила документации и docs guard; 5 файлов.
[CI 34752986266](https://github.com/fairgvard-sketch/angles/actions/runs/34752986266)
ещё **in_progress** на момент этой сверки. Последующее дополнение журнала
с результатом Kassa не меняет код guard; его CI не объявляется пройденным заранее.

## 13.09.2026 — решение владельца: F5 остаётся обязательным перед продажами

Владелец отложил оплату инфраструктуры до выхода в продажи и явно попросил
не закрывать задачу. F5 помечен **OPEN / обязательный блокер клиентского запуска**
в плане и release checklist; runbook синхронизирован. Рекомендуемый крайний
срок зафиксирован до первого заведения с реальными операциями, включая бесплатный
пилот, а не только до первого платежа. Разработка и изолированные тесты не
блокируются. Планируемая оплата не является включением PITR или подтверждением
RPO/RTO. Критерии: защита БД ≤15 минут, отдельная копия Storage, контроль ошибок
и полный изолированный restore ≤1 часа. Платные настройки не изменялись.
Документационные проверки: 8/8 тестов guard, 70 документов / 254 ссылки /
0 ошибок в чистом совместном снимке; `git diff --check` обоих репозиториев PASS.
Это изменение плана и инструкций, не новый функциональный прогон или деплой.

## 13.09.2026 — A6.2: device identity, несколько точек и поздние ответы

База: ANGLE `7595a2f`, Kassa `157d2aa` плюс собственные рабочие изменения
этого блока. Claude F6.1 передано владельцем; patch ещё не принят. Его
`src/lib/telemetry*.ts` и раздел deployment/«Наблюдаемость парка» не менялись.
В `supabase/tests/telemetry.test.sql` добавлены только живые Auth-фикстуры для
проверки нового server helper; клиентский payload остаётся областью Claude.

Среда: macOS, Node 22.16.0, npm 10.9.2, Vitest 5, Chrome for Testing 150;
локальные Postgres 17 / PostgREST 14.5 / GoTrue 2.192.0 / Mailpit 1.31.1.
Новая синтетическая БД из схемы локального baseline 164 и технических
справочников, затем 165–169. Пользователи/данные исходной БД и production
не копировались. Каждая HTTP/Auth-приёмка — отдельная новая БД, temporary
JWT secret только в памяти окружения контейнера, HTTP только loopback.

### Подтверждённые дефекты до исправления

1. После `delete_device_web` удалённый выделенный Auth-user продолжал читать
   организацию и регистрировать терминал по старому ещё действующему JWT.
2. `register_device` с известным UUID перезаписывал владельца устройства
   другим Auth-user той же организации.
3. Прямой PATCH devices позволял указать точку другой организации: обычный
   UUID FK не проверял пару org/location.
4. Поздний ответ синхронизации A после перехода на B возвращал настройки A
   в store и localStorage B. Детерминированный тест ожидал имя `B`, получал
   `Барная касса` — **FAIL до правки / PASS после**.

Серверный baseline 168: первые 23 новых SQL-проверки — **14 PASS / 9 FAIL**;
независимый прогон настоящего PostgREST с теми же JWT до/после удаления —
**5 PASS / 7 FAIL**. После 169 — соответственно 23/23 и 12/12 PASS;
затем матрица расширена, итог ниже. Это воспроизведение, не вывод по review.

### Исправление и совместимость

Новая миграция 169 проверяет существование/бан device Auth-user и tenant
точки внутри auth helpers; отказывает конфликту владельца/точки устройства;
добавляет tenant trigger. Старые миграции и финансовые строки не переписаны.
Версия читается из прежнего migration ledger, MIN_SCHEMA_VERSION клиента 169.
Архив намеренно сохраняет доступ; shared/human account не удаляется с одной
строкой парка; отзыв web-членства совмещённого аккаунта не равен отзыву POS.

Клиент связывает оба RPC синхронизации с исходным JWT и проверяет scope,
поколение входа и identity ответа перед применением настроек. Старый отказ
не создаёт ошибку/повтор для нового пользователя. Прежние outbox/PIN-функции
не менялись. Повторная регистрация своей кассы, новая регистрация и другой
терминал на общей учётке проходят. Конфликт UUID не обходится его заменой.

В восьми старых SQL-наборах созданы отсутствовавшие Auth-users; в
staff_hours_report добавлен sub существующего device user вместо JWT без sub.
Прежние assertions сохранены. Иначе тест моделировал удалённую учётку, а не
живую кассу. Автоматического создания пользователей по JWT в harness нет.

### Итоговые локальные проверки

| Проверка | Результат |
|---|---|
| Полная pgTAP-регрессия | **83 файла / 1571 PASS**, 0 ошибок; все наборы в rollback-транзакциях |
| Новая SQL-матрица | **37 device + 21 multi-location PASS** |
| Сохранённый HTTP/JWT-прогон | **35 PASS**, база `angle_billing_lab_a6_169_final` |
| Auth / SMTP catcher / реальный App | **23 PASS**, база `angle_auth_lab_a62_169_final`, фактическая схема 169 |
| Kassa `test:all` | **593 Vitest + 42 bundle + 11 ops PASS** |
| Kassa lint / check:schema | PASS / v169 |
| POS build + check:bundle | PASS; modern **62.0**, legacy **130.4 KiB**, precache 136 |
| Menu build + check:bundle | PASS; modern **61.5**, legacy **129.5 KiB**, precache 58 |
| ANGLE unit / build | **752 PASS** / PASS; guard миграций общий с billing lab |
| Docs | **8/8** guard; 70 документов / 261 ссылка / 0 ошибок в совместном снимке, включая эту запись |

Первый build остановился на `Promise.withResolvers` в новом тесте — API не
входит в текущий TS lib target. Заменён обычным Promise helper, target и
runtime-полифилы ради теста не расширялись; повтор тестов/обеих сборок PASS.
В Auth-runner исправлен захардкоженный текст «schema 168»: итоговый прогон
проверяет и печатает номер из БД. Billing lab теперь использует тот же точный
allowlist миграций, что Auth lab, и не применяет пользовательские ` 2`-копии.

Вложения локально: `/private/tmp/angle-a62-exDSes/` — SQL-логи, обезличенный
HTTP baseline/after, окончательные SQL/HTTP/Auth-логи и snapshot helper;
`/private/tmp/angle-a62-accept-zXyChP/` — снимок проверяемого дерева без
`.env`, backups, `CLAUDE.md`, untracked-копий и зависимостей. Это не внешний
backup и не чистая ревизия Git: поверх tracked-файлов включены свои A6.2-файлы.

**Выпуск: NOT RUN.** 169 в production не применялась; main не менялся,
push/deploy/CI этой итерации не выполнялись. Перед выпуском: read-only сверка
существующих привязок devices/Auth/locations, свежий закрытый backup,
приёмка совместного дерева с F6.1 и T2 smoke 0.1 (вход/настройки/печать).
Текущий production не объявляется защищённым этой локальной правкой.
Полный аудит всех RPC, текущая общая браузерная suite ANGLE, физический T2,
production SMTP/PITR и восстановление production — **NOT RUN** в этом блоке.
F5 по решению владельца остаётся **OPEN / обязательный до реальных операций**.

Итоговый `test:all` повторён на окончательном коде: 593 + 42 + 11 PASS.
Исходная локальная БД осталась на 164, SQL-lab на 169 после rollback имеет
0 организаций. Собственные HTTP/Auth/SMTP-контейнеры закрыты; синтетические
БД сохранены, финансовые данные и пользовательские копии не удалялись.
Colima возвращён в исходное выключенное состояние.

## 13.09.2026 — review F6.1: НЕ ПРИНЯТО, подготовлено R1

Получен patch Claude относительно Kassa `157d2aa`, схема 168. Пять файлов:
telemetry.ts/test, telemetry-sanitize.ts/test и раздел наблюдаемости
deployment.md; зависимости и сервер не меняются. `git apply --check` на
исходной Kassa PASS. SHA256 patch:
`ba9694bf0bd3c1631c03e9ac765955fa0f1b16296652d6acb2192ad4ea5e821d`.

Patch применён **только в изолированном проверочном снимке** текущего рабочего
дерева с A6.2: `/private/tmp/angle-f61-review-pdClQ1/kassa/`.
Это не чистая ревизия Git и не изменение исходной Kassa. Секреты, `.env`,
backups, пользовательские инструкции/дубли туда не переносились; зависимости
использованы через ссылку для чтения. Первый запуск со стандартным загрузчиком
конфига остановился до тестов на EPERM записи `.vite-temp`. Повтор с
`--configLoader runner` прошёл до всех assertions без изменения конфигурации.

| Проверка | Результат |
|---|---|
| 86 целевых тестов автора F6.1 | **86 PASS** |
| 12 независимых тестов review | **1 PASS / 11 FAIL** |
| Три целевых файла вместе | **87 PASS / 11 FAIL**, exit 1 |
| Полный Vitest совместного снимка A6.2 + F6.1 + review | **668 PASS / 11 FAIL**, 679 тестов / 67 файлов, exit 1 |

Команда целевого прогона: `./node_modules/.bin/vitest run --configLoader runner
src/lib/telemetry.test.ts src/lib/telemetry-sanitize.test.ts
src/lib/telemetry-review.test.ts`; полного — та же команда без списка файлов.
Только новый review-файл красный; ранее существовавшие проверки объединённого
кода проходят. Это не приёмка релиза: отрицательные privacy-тесты обязательны.

Подтверждённые дефекты:

1. `password: FakeQaPass9`, `Error: password: FakeQaPass9`, `Error: pin: 9137`
   обходят очистку префиксов. Значения password в одинарных кавычках и
   квадратных скобках тоже сохраняются. `pin: 9137` найден одновременно
   в localStorage и точном отправляемом payload.
2. Runtime-source с произвольным объектом сохраняется на диск до allowlist.
   Синтетический UA с `password=FakeQaPass9` остаётся и на диске, и в payload.
3. Очередь A до первого online flush приписывается B; тот же Auth-user с
   другой org/location также отправляет старую очередь. Отдельная гонка
   реального SDK формирует batch A с заголовком Authorization B между
   снимком `getSession` и получением access token для отправки.

Все маркеры выдуманные. В HTTP-регрессии используется настоящий Supabase SDK,
но Auth/token supplier управляется тестом, а fetch перехватывается целиком.
**Это проверка формирования запроса, не реального Auth/серверного приёма.**
Никаких production-запросов или чтения пользовательских логов не выполнялось.
Положительный независимый тест текущего подтверждённого контекста PASS.

Артефакты: `/private/tmp/angle-f61-review-pdClQ1/` — review-tests.log,
combined-unit.log и `kassa/src/lib/telemetry-review.test.ts`.
SHA256 независимого теста:
`c254d9a8a8cb0ad7604d24363133b5e30467237ec2dd3ccf8dc29e7e775c7fcf`.
Пути исходного patch/отчёта и точные критерии R1 внесены в
[план](product-completion-plan.md), раздел «Задание для передачи Claude сейчас».

**Исходный F6.1 не внесён в рабочую Kassa.** A6.2 сохранена без изменений.
Новый combined lint/build/bundle/pgTAP, CI, T2, миграция 169 и push/deploy —
**NOT RUN** в этом review; прежние локальные проверки A6.2 не отменяются,
но не заменяют приёмку исправленного совместного дерева. Colima не запускался.
F5 остаётся OPEN и обязательным до первого клиента с реальными операциями.

Проверка обновлённой документации: 8/8 guard PASS, 70 документов / 262 ссылки /
0 ошибок в совместном снимке `/private/tmp/angle-a62-accept-rn3389/` без
пользовательских ` 2`-копий; `git diff --check` обоих репозиториев PASS.

## 13.09.2026 — B4/B6: ошибки загрузки и поздние сохранения QR-настроек

Пока владелец передал F6.1-R1 Claude, здесь выполнен отдельный ограниченный
блок ANGLE. База main `7595a2f` плюс текущие локальные A6.2/docs; F6.1 в
исходную Kassa не применён. Сервер, каталог, финансовые операции и правила
выдачи продуктов в этом изменении не затрагивались.

Сначала добавлен браузерный набор `backoffice/test/qr-channel-state.test.mjs`
против неизменённого QrChannels.jsx. Реальный React StrictMode и data helpers,
синтетический Supabase transport; внешние запросы, включая гостевой iframe,
перехвачены. Baseline: **1 PASS / 5 FAIL из 6**. Подтверждены:

- После ошибки загрузки остаётся skeleton, нет действия повтора.
- Поздний отказ сохранения A откатывает тумблер B и показывает ошибку A.
- Поздний успех A показывает «Saved» на B, где ничего не сохраняли.
- Завершение сохранения короткого адреса A подменяет гостевую ссылку B.
- Поздний отказ QR Menu отображается после перехода в QR Reservations.

Исправление: владелец всего локального состояния QR-раздела пересоздаётся
по organization/location/channel, включая callbacks редактора адреса.
Старое завершение не может изменить новый экземпляр, в том числе A → B → A.
Ошибка загрузки отделена от ошибки сохранения; skeleton заканчивается,
Retry loading перечитывает настройки/столы/адрес. Это не отменяет уже
отправленные серверные записи для исходной точки и не заменяет RLS/API.

| Проверка | Результат |
|---|---|
| Исходные 6 браузерных регрессий после исправления | **6 PASS**, 0 skipped |
| Итоговый QR-набор, добавлен A → B → A | **7 PASS**, 0 skipped |
| Вместе с прежним account-access browser-набором | **14 PASS**, 0 skipped |
| ANGLE `npm run test:unit` | **752 PASS** |
| ANGLE build с placeholder VITE_SUPABASE_* | **PASS**; штатное предупреждение chunk >500 kB осталось, лимиты не менялись |
| Ошибка загрузки: 1280 / 375 / 320 px | Нет горизонтального overflow; снимок 320 px визуально проверен |

Все браузерные прогоны с `ANGLE_BROWSER=required`, через общий harness,
без CPU-load и Docker. Логи и снимок: `/private/tmp/angle-b4-RA10OJ/` —
baseline.log, after.log, browser-final.log, unit.log, build.log, retry-320.png.
Положительный сценарий проверяет запись именно своей точки и повторное чтение
после ухода/возврата, не реальный сервер и не browser reload с сохранением БД.

Обновлены справочник QR-настроек в Kassa online-orders.md, команда разработки
ANGLE и общий план. Исходный `check:docs --require-kassa` обнаруживает прежние
**32 ошибки классификации пользовательских ` 2`-дублей**; эти файлы не удалены
и не добавлены в рабочий индекс ради зелёного статуса. Проверка выпуска
выполняется отдельно в совместном снимке без этих пользовательских копий.

**NOT RUN:** полный браузерный прогон ANGLE, production, CI, push/deploy,
реальные QR/телефон/T2, новая серверная приёмка и весь маршрут B1–B6.
A6.2 остаётся локальной, 169 не применялась. F5 остаётся OPEN, обязательным
до клиента с реальными операциями; F6.1-R1 — у Claude.

Итоговая проверка docs: 8/8 guard PASS, 70 документов / 263 ссылки / 0 ошибок
в совместном снимке `/private/tmp/angle-a62-accept-bV68zh/` (включён новый
QR-тест, исключены пользовательские копии/секреты). `git diff --check`
обоих исходных репозиториев PASS.

## 13.09.2026 — review F6.1-R1: очистка PASS, подключение к Auth не принято

Получен кумулятивный patch относительно Kassa `157d2aa`, схема 168:
`/private/tmp/claude-501/-Users-enotov-Desktop-kassa/07d55dd1-99a5-45ea-ba07-55daf0a62e12/scratchpad/f61r1/f61r1-telemetry.patch`.
SHA256 `47ac919127208f0f5a7b5c8cd0ff6e31ca341d5cf90319ad92de56ab78ebd795`.
Восемь разрешённых файлов: telemetry/context/sanitize/review и их тесты,
только раздел наблюдаемости deployment.md. `git apply --check` исходной Kassa
PASS. Исходные telemetry-файлы и deployment.md здесь **не изменялись**.

Patch применён только в свежем совместном снимке
`/private/tmp/angle-a62-accept-kUyW24/kassa/`, включающем локальную A6.2/169.
Данные/секреты/пользовательские инструкции и дубли исключены; зависимости
подключены ссылкой на уже установленный неизменённый lock, нового `npm ci`
здесь не было. Конфиг загружен через `--configLoader runner`, как в первом
review; исходные файлы конфигурации не менялись.

| Проверка | Результат |
|---|---|
| Четыре файла тестов R1, включая прежние независимые 12 | **139 PASS**, exit 0 |
| Новый telemetry-lifecycle-review.test.ts | **1 PASS / 3 FAIL**, exit 1 |
| Полный Vitest: A6.2 + R1 + новый review | **721 PASS / 3 FAIL**, 724 теста / 69 файлов, exit 1 |

Порядок очистки/секреты, runtime-source, UA и явный Authorization предыдущих
регрессий теперь проходят. Оставшийся блокер — связь поколения с событиями
Auth и локальным контекстом capture. `initTelemetry` вызывает confirm только
один раз и не подписывается на Auth; `flushTelemetry` offline возвращается
до чтения сессии. Production signOutDevice вызывает Auth.signOut, но не
confirm/flush телеметрии. Предыдущий тест выхода вручную вызывал flush при
`session=null`, тем самым выполняя отсутствующий шаг приложения.

Новые проверки идут через init → события Auth → capture → flush, без
ручного confirm и без flush в момент logout. Подтверждено:

1. A → logout → A offline не закрывает поколение: старая ошибка отправлена.
2. A → B → A до следующего flush отправляет ошибку, пойманную под B,
   с `Authorization: Bearer synthetic-token-A`.
3. После записи корректного контекста B другой вкладкой capture ещё работающей
   под A вкладки получает чужую метку B из `currentGen()` и сохраняет её.
   Проверяется сохранённая принадлежность записи; этот отдельный тест не
   заявляет воспроизведение реального межвкладочного Auth-броадкаста.

Положительный путь после штатного init PASS. SDK для формирования HTTP
настоящий, Auth-сессии/события управляются тестом, fetch полностью перехвачен;
используются только выдуманные маркеры. Реальный Auth/серверный приём и
production-запросы здесь **NOT RUN**, не следуют из этого результата.

Артефакты в `/private/tmp/angle-a62-accept-kUyW24/`:
r1-original-tests.log, r1-lifecycle.log, r1-combined-unit.log и
`kassa/src/lib/telemetry-lifecycle-review.test.ts` (SHA256
`2ead95f55edd21e3ae6f939bb0cecee40729b4b1ed7b98662628ee471d46b4db`).
Команда — `./node_modules/.bin/vitest run --configLoader runner`, для
целевых прогонов добавляются пути соответствующих файлов.

Подготовлено ограниченное [задание F6.1-R2](product-completion-plan.md):
подключение к Auth, локальная принадлежность capture, поздние initial/batch
ответы. Переписывать уже прошедшую проверку очистку не требуется.
**R1 не интегрирован.** A6.2 и QR-правки B4/B6 сохранены; main не менялся.
Новый lint/build/bundle/pgTAP, T2, CI, push/deploy и миграции — **NOT RUN**
после красной приёмки. F5 остаётся OPEN / обязательным до реальных операций.

## 13.09.2026 — B5: кабинет Menu-only без недоступного управления заказами

Владелец передал F6.1-R2 Claude. Здесь выполнена отдельная UI-правка ANGLE
поверх локальных QR-изменений B4/B6, main по-прежнему `7595a2f`.
В коде публичной поверхности Kassa подтверждён существующий browse-only путь:
public-menu выдаёт `modules.online_orders`, PublicOrderPage использует
isViewOnlyMenu. Кабинет же показывал «Ordering is live/paused», способы
получения, часы приёма и QR столов даже без соответствующей capability.

Новые SSR/логические проверки сначала дали **5 FAIL / 1 PASS**;
со старым набором **36 PASS / 5 FAIL из 41**, exit 1. После исправления
**41 PASS**, exit 0. Старые assertions управления заказами сохранены;
их исходной fixture добавлена явно отсутствовавшая `online_orders` capability,
поскольку эти сценарии проверяют именно активное управление заказами.
Отдельно проверены Menu-only с enabled true/false/undefined, старый контекст
products без capabilities и Orders без отдельного продукта Menu.

Теперь `online_orders` capability определяет наличие управления заказами:
в Menu-only нейтральная подпись «Browse-only menu», нет тумблера/способов/
часов приёма/QR столов. Остаются общий QR, ссылка, слаг, оформление, каталог
и вставка на сайт. Экран Menu-only не читает таблицы столов; его сообщение
о пустом каталоге не обещает возможность заказа. Серверные gates, подписки,
RPC, права записи и сохранённые настройки не изменены этой правкой.

Итоговые проверки на окончательном коде:

- `npm run test:unit`: **758 PASS**, exit 0.
- QR browser + account-access browser: **16 PASS**, 0 skipped, exit 0;
  `ANGLE_BROWSER=required`, обычный harness, без CPU-load/Docker.
- Проверены отсутствие запроса tables и сохранение display_name в Menu-only:
  RPC адресован выбранной точке и не содержит enabled/прочих настроек заказа.
- Build с placeholder VITE_SUPABASE_*: **PASS**, exit 0; прежнее предупреждение
  chunk >500 kB не скрыто и пороги не менялись.
- Menu-only 1280/375/320 px: нет горизонтального overflow; снимок 320 px
  просмотрен, штатный browse-only режим не оформлен как предупреждение.

Артефакты: `/private/tmp/angle-b5-DewFD4/` — baseline.log, after.log,
browser-final.log, unit-final.log, build-final.log, menu-only-320.png.
Браузер проверяет настоящий компонент и data helpers с синтетическим
transport; гостевой iframe перехвачен. Это не проверка настоящего гостевого
приложения, SQL-отказа при попытке заказа или физического сканирования QR.

Обновлены план, команда разработки и справочник QR-настроек Kassa.
F6.1-R2 не применён; A6.2/169 остаётся локальной. Полный browser-suite,
production/CI/push/deploy, новый серверный прогон, телефон/T2 — **NOT RUN**.
B5 целиком не закрыт, F5 остаётся обязательным до реальных операций.

## 13.09.2026 — F6.1-R2: локальная приёмка и интеграция с A6.2

Кумулятивный patch F6.1 + R1 + R2 от Claude относительно Kassa `157d2aa`:
`/private/tmp/claude-501/-Users-enotov-Desktop-kassa/ca557e69-782c-45d6-b218-deac6bd114d0/scratchpad/f61r2/f61r2-telemetry.patch`.
SHA256 подтверждён: `32e935ce30117ab763ecc940560af380622a30a26e09e68e22abd8c340400058`.
Десять заявленных файлов, `git apply --check` на исходной Kassa PASS.
HEAD не двигались: Kassa `157d2aa`, ANGLE `7595a2f`.

Независимый прогон — в `/private/tmp/angle-a62-accept-zB1JYe/kassa/`:
снимок текущего исходного кода с A6.2/169, без секретов, резервных копий,
пользовательских инструкций и файлов с суффиксом ` 2`. В Kassa также были
параллельные hero-правки владельца, включая четыре их теста: они вошли в
сборку для проверки совместимости, но функциональная приёмка этих изменений
не входит в F6.1. Node 22.16.0 / npm 10.9.2, отдельный `npm ci --offline`
из неизменённого lock: exit 0, 648 установленных пакетов. Вывод npm о нуле
уязвимостей получен offline; нового онлайн-аудита advisory здесь не было.

R2 закрывает прежние lifecycle-регрессии: синхронная подписка на Auth
закрывает поколение при выходе offline, capture проверяет подтверждённый
локальный контекст и общий ключ, поздние initial-session и batch-ответы
не присваивают/не удаляют диагностику другого входа. Повторный SIGNED_IN
и refresh той же identity сохраняют поколение. Callback не запрашивает
Auth повторно и не ходит в сеть; teardown снимает слушателей и таймеры.

При дополнительном review найдена граница очистки: незакрытая кавычка/
скобка, обрезка до закрывающего знака на лимите входа и экранированная
кавычка оставляли часть значения `pin`/`password`. В новом
telemetry-redaction-boundaries.test.ts восемь таких тестов дали FAIL на
неизменённом R2, полезный TypeError — PASS; прежние 150 тестов также PASS.
Здесь минимально исправлен разбор значения SECRET_KV_RE: экранированные
кавычки входят в значение, конец ограниченного входа консервативно его
завершает. Девять регрессий теперь PASS с проверкой идемпотентности.
Добавлен ещё один тест фактических disk/RPC-аргументов: положительный
контроль отправки и отсутствие только выдуманных `9137`/`FakeQaPass9`.
Зависимости, пороги и assertions прежних проверок не менялись.

| Проверка | Результат |
|---|---|
| R2 + новые границы, до локальной правки | **151 PASS / 8 FAIL**, exit 1 |
| Те же наборы после правки | **159 PASS**, exit 0 |
| Финальные telemetry-наборы с disk/RPC-регрессией | **160 PASS**, 7 файлов, exit 0 |
| `npm run test:all` | **745 Vitest PASS** / 72 файла + **42 bundle PASS** + **11 ops PASS**, exit 0 |
| `npm run lint` / `npm run check:schema` | **PASS / PASS, v169** |
| POS `npm run build` + `check:bundle` | **PASS**, modern **62.0** / legacy **130.4 KiB gzip** |
| Menu `npm run build:menu` + `check:bundle` | **PASS**, modern **61.5** / legacy **129.5 KiB gzip** |
| Бюджеты startup JS | Прежние **240 / 310 KiB gzip**, без повышения |

Сборки выполнялись последовательно, с placeholder VITE_SUPABASE_*; `tsc -b`
входит в штатную команду build. Docker, браузер и production не использовались.
Пути логов относительно `/private/tmp/angle-a62-accept-zB1JYe/`:
r2-npm-ci.log, r2-target-baseline.log, r2-target-final.log,
r2-target-accepted.log, r2-test-all.log, r2-lint.log, r2-schema.log,
r2-build-pos.log, r2-bundle-pos.log, r2-build-menu.log, r2-bundle-menu.log.

После проверок **11 файлов** F6.1 (десять из patch и новый boundary-test)
перенесены в исходную Kassa; побайтовое совпадение всех одиннадцати с принятым
снимком подтверждено. Дополнительно обновлены сценарии telemetry в T2-smoke,
общий план и этот журнал. Хеши package.json/lock и параллельных
PublicOrderPage.tsx, heroVideo.ts/test, hero.mp4, vercel.json, online-orders.md
не изменились при интеграции. SQL, auth/deviceSync и финансовый outbox
этим блоком не редактировались; ранее подготовленная A6.2 сохранена.

Docs: **8/8 guard PASS**, **70 документов / 265 ссылок / 0 ошибок** в
отдельном совместном снимке `/private/tmp/angle-a62-accept-Y0v4zl/`.
Он проверяет документацию, не объявляет все параллельные изменения готовыми
к выпуску. Исходный `npm run check:docs -- --require-kassa` по-прежнему
возвращает **32 ошибки классификации пользовательских ` 2`-дублей**,
102 документа / 265 ссылок; лог r2-source-docs.log. Дубли сохранены, не
удалены и не скрыты правкой guard. `git diff --check` обеих исходных папок PASS.

**Границы приёмки:** настоящий SDK формирует проверяемый HTTP-запрос, но
Auth-сессии/события синтетические, fetch перехвачен. Реальный Auth-сервер,
приём на сервере, межвкладочный Auth-броадкаст в браузере и физический T2
здесь **NOT RUN**. Новый pgTAP/HTTP/SMTP-прогон не делался: предыдущие
результаты A6.2 остаются отдельным доказательством. CI на этих изменениях,
commit/push/deploy и production-миграция 169 **NOT RUN**.

**F6.1 локально принят; вся F6 не закрыта.** Серверные старые client_errors,
ретенция, доступ и канал поддержки остаются отдельными задачами. F5 остаётся
OPEN и обязательным до первых реальных операций, включая бесплатный пилот.

## 13.09.2026 — согласованный выпуск 169: предрелизные проверки и production-БД

Владелец разрешил применить и отправить все изменения в main. Включаются A6.2,
QR B4/B6, Menu-only B5, принятая F6.1 и параллельные hero-правки. Исходные
видео вне сборки, `.claude/launch.json`, пользовательские ` 2`-дубли и секреты
не входят в релиз и не удалены. Сравнение с принятым снимком исключило новые
незамеченные изменения кода перед публикацией.

- Снимок: `/private/tmp/angle-a62-accept-8ScYsx/`. ANGLE: чистый `npm ci --offline`,
  **761 unit + 229 browser PASS**, 0 skipped, `ANGLE_BROWSER=required`, build PASS.
  Совместные docs: 8 guard PASS, 70 документов / 265 ссылок / 0 ошибок.
- Kassa: код совпадает с принятым F6.1-снимком, **745 + 42 + 11 PASS**,
  lint/schema169/обе сборки/бюджеты PASS (логи предыдущего раздела).
- Повторная SQL-регрессия в существующей синтетической A6.2-БД:
  **83 файла / 1571 PASS**, без reset; `sql-release.log`. Colima временно
  включена для SQL/backup и возвращена в исходное выключенное состояние.
- Дополнительный настоящий Chrome/MediaRecorder smoke hero-оптимизации:
  MP4 **4 859 350 → 603 562 B**, **404×720**, **12.03 сек**, progress 100,
  результат декодируется. Локальный исходник из Git, без Storage upload и сети
  к Supabase; `hero-smoke.mjs` / `hero-smoke.log`. Это не тест Safari/T2.

Production guard: `qgmnxrgtlpyqglwqmsej`, до применения схема168, checkout
disabled. Read-only preflight: 2 устройства/2 Auth-user; отсутствующих и
заблокированных Auth-user, NULL-привязок, конфликтов UUID, чужих org/location
и расхождений claims — **0**. Читались агрегаты и хеши, не личные данные.

Свежий штатный backup: `kassa/backups/2026-09-13T16-42-26.866Z-ZM7VqN`.
Manifest complete, SHA256/размеры/права проверены; 100 COPY-таблиц, включая
auth.users, orders, payments. Roles **297 B**, schema **958627 B**, data
**545676 B**; каталог0700 / файлы0600, Git-ignored, FileVault On. Первая
дополнительная проверка COPY ошибочно не учитывала кавычки SQL-идентификаторов;
исправлен только диагностический разбор, все нужные таблицы присутствуют.
Restore/offsite/PITR/байты Storage этой копией не подтверждены.

Dry-run из исходной папки отказал из-за пользовательских ` 2`-дублей;
`--include-all` не использовался. В чистом составе релиза — только **169**,
без roles/seeds. Для штатного project-ref guard использована ссылка на
исходную `.env` и прежнюю CLI-привязку, значения секретов не копировались.
Хеш SQL исходника/снимка совпал. Guarded `npm run db:push -- --yes` применил
ровно `169_device_identity_boundaries.sql`, exit0; `migration169.log`.

Postcheck PASS: схема169 и одна запись ledger, trigger активен; anon не
исполняет auth_org/register, authenticated имеет register, прямое выполнение
trigger-функции запрещено. Read-only проверка с SQL-ролью authenticated
сохраняет org/location действующего устройства и возвращает NULL для
синтетического отсутствующего Auth-user со старыми claims. Это проверка
SQL-политики на целевой БД, не реальный сетевой вход или физический T2.
Контрольные агрегаты и хеши до/после одинаковы: 330 заказов, 126 оплат,
привязки устройств, subscriptions/grants/checkout requests. Checkout disabled
сохранён. Артефакты preflight169.json, after169.json, postcheck169.json.

На момент этой записи main push и CI/deploy ещё впереди; их результаты
фиксируются следующей записью. **F5, живой Auth/почта и T2 не закрыты**.

## 13.09.2026 — выпуск 169: main, CI и публикации PASS

Функциональные коммиты отправлены fast-forward в main:

- Kassa **`0502e6bc10b05518d7decd2282ac96e2e2e42edf`**, 37 файлов;
  [CI 34769854654](https://github.com/fairgvard-sketch/pos/actions/runs/34769854654)
  — frontend и database **success**, в том числе создание схемы и pgTAP в CI.
- ANGLE **`50dc0b9834c6a5c4a0ee8d0ebb6df7635c29a978`**, 20 файлов;
  [CI 34769859282](https://github.com/fairgvard-sketch/angles/actions/runs/34769859282)
  — **success**, обязательный browser suite и docs guard.

Статусы проверены 16:55 UTC. Vercel **success** на этих же SHA:
[POS](https://vercel.com/vandal2/pos/3PySn1GviZKsWZeaE674ityRi3vs),
[Menu](https://vercel.com/vandal2/angle-menu/5hRvjvmHMTyCNjKBWZRhNCsaeVg1),
[ANGLE](https://vercel.com/vandal2/angles/8iZzRhkvUbX1kCm4gwhYjiJs3aGw).
Это штатные отдельные сборки Git-интеграции; локальные placeholder-артефакты
не публиковались. Edge Functions и APK не менялись и не перевыпускались.

Read-only HTTP smoke PASS: главная, `/account/`, POS `/setup`, гостевая
страница Menu возвращают HTML200. Все 17 проверенных same-origin JS/CSS,
включая POS modulepreload и legacy entry/polyfills, отвечают200 с правильными
content types. Кабинет `index-DKHB4ZdL.js`, POS `index-BF7Nf_Yf.js`,
Menu `index-D5jjuRiZ.js`. Удалённая карусель логотипов отсутствует в главной;
hero.mp4?v=2 — video/mp4, **1 070 121 B**, ожидаемая immutable cache policy.
Артефакт: `/private/tmp/angle-a62-accept-8ScYsx/public-smoke.json`;
статусы CI/Vercel — status-*.json в той же папке.

Проверка HTTP — не пользовательская сессия, не обновление service worker на
работающей кассе и не приёмка T2. Реальные заказы/платежи/аккаунты не создавались.
Подписочный checkout остался disabled, эквайринг/налоговая регистрация не
включались. **F5 остаётся обязательным блокером первых реальных операций**;
физический T2, production Auth/почта и оставшаяся серверная F6 не закрыты.

После функционального push tracked-деревья чистые. На диске сохранены вне
коммитов 57 ANGLE и 10 Kassa файлов-дублей ` 2`, два сырых видео ANGLE и
`.claude/launch.json` Kassa; ничего не удалено. Обновление этого журнала и
статусов плана отправляется отдельным документационным коммитом поверх
проверенного кода; приведённые выше CI относятся к функциональным SHA.

## 13.09.2026 — B1/B3, первый маршрут Menu и границы Dashboard (локально)

База ANGLE `cfa134c`, Kassa `0502e6b` (схема169). Новые изменения ANGLE
находятся в рабочем дереве; Kassa, production, миграция170 Claude, зависимости
и конфигурация CI не менялись. Commit/push/deploy этого блока **NOT RUN**.

Реализован маршрут Dashboard → текущие Locations / Catalogue / QR Menu →
гостевая ссылка. Нет второго редактора, статуса «опубликовано» или отметки
готовности по одному клику. Только `catalog_manage` + `public_menu` дают
подсказку; часы/способы заказа дополнительно требуют `online_orders`.
Наличие позиций сворачивает маршрут, пустой каталог раскрывает; ошибка
загрузки остаётся неизвестным состоянием с повтором. Счётчик использует
активные категории выбранной точки и доступные товары — правило сверено
с локальным `kassa/supabase/functions/public-menu/index.ts`.

**Воспроизведение до правок:** три выбранных браузерных сценария — 3 FAIL:
нет маршрута для пустого меню, поздний ответ точки A заменяет уже показанную
ссылку B на `/order/alpha`, нет обработки неизвестного каталога/повтора.
Последний сценарий — критерий новой функции: прежде Dashboard каталог
вообще не загружал. Отдельно три unit-регрессии QR — 3 FAIL: выключенные
категории ошибочно убирали предупреждение о пустом меню. После исправления
новые и существующие утверждения проходят; timeout/skip не ослаблялись.

Итоговый прогон: macOS, Node22.16.0/npm10.9.2, настоящий Chrome в обязательном
режиме, React StrictMode; обычный owner-контекст и transport синтетические.
Все внешние запросы нового набора перехватываются и запрещены. Чистый снимок
выбранных исходников без `.env`, дампов и пользовательских ` 2` дублей:
`/private/tmp/angle-a62-accept-dX6QIU/`. Использованы установленные зависимости
предыдущей изолированной приёмки при побайтово совпадающем lock; новый
`npm ci` в этом блоке не выполнялся.

- `PASS npm test`: **764 unit + 244 browser**, 0 FAIL, 0 SKIP.
- `PASS menu-setup.test.mjs`: **14 сценариев** внутри общего browser-прогона:
  переходы с выбранной точкой/вкладкой, Menu / Orders / Reserve / отсутствие
  доступа; пустые/скрытые/чужие/выключенные категории; ошибка каталога и
  канала с повтором; поздние ответы A → B → A, смена организации, отзыв
  capabilities и порядок фоновых обновлений в одном контексте.
- `PASS channel-readiness.test.js`: **16 тестов** внутри unit-прогона,
  включая 3 новых; фикстуры явно несут `is_active` как реальный ответ API.
- `PASS npm run build`; прежнее предупреждение Vite о чанке >500kB
  остаётся, порог не менялся. Нет новых зависимостей.
- `PASS check:docs -- --require-kassa`: 8 guard-тестов, 70 документов,
  268 ссылок, 0 ошибок; `git diff --check` — PASS. В исходном дереве
  пользовательские дубли по-прежнему не входят в приёмочный снимок;
  их не удаляли и не ослабляли для них общий docs guard.
- Клавиатурное раскрытие и отсутствие горизонтального переполнения на
  320/375/1280px — PASS. Синтетические снимки 320/1280px просмотрены:
  `/private/tmp/angle-menu-setup-mobile.png` и
  `/private/tmp/angle-menu-setup-desktop.png`.

Логи: `angle-test.log`, `angle-build.log`, `angle-docs.log` в указанном
снимке. Это **не** живые RLS/Auth или прохождение всех редакторов с
сохранением: B1 пока частичный, B2/B3 (цены/варианты/обязательные опции,
перезагрузка, публичная корзина), права команды, физические телефон/T2
остаются открытыми. Проверка браузера не заменяет production-приёмку.
F5/PITR и остальные обязательные ограничения перед реальными операциями
не менялись. Задание F6.2 отмечено в плане как переданное пользователем Claude.

## 13.09.2026 — F6.2, независимое ревью: НЕ ПРИНЯТО

Получен patch SHA256
`39c63fdbed94b72f0fa80bba3ce0e858a83df6e871df6a401a8cbf4c31d86c50`:
хеш совпал, 7 файлов, +756/−1, `git apply --check` на Kassa0502e6b PASS.
Патч наложен **только на новый git-archive снимок** в
`/private/tmp/angle-f62-review-0ljcZy/`; исходная Kassa не изменена.
Локальные правки B1/B3 ANGLE сохранены, production не читался/не менялся.

По разрешению владельца Colima включена на21:05–21:10 IDT и возвращена
в выключенное состояние. Создана одна новая БД
`kassa_f62_review_0ljczy`: платформенный bootstrap из артефактов Claude,
оригинальные001–169, затем кандидат170. Никаких дампов/данных прежних баз;
из существующего кластера прочитаны только настройки и список имён БД.
Вызовы идут под SQL-ролью authenticated с синтетическими JWT claims —
не настоящий GoTrue, не HTTP и не production.

1. **P1, регрессия SQL NULL.** Независимый `missing-fields-review.sql`
   даёт **12/12 PASS на169 → 12/12 FAIL на170**. Отсутствующий fingerprint,
   отсутствующий message и `{}`, каждый до/после валидного элемента,
   проходят проверку `jsonb_typeof(...) <> 'string'` из-за SQL NULL.
   INSERT падает с23502, валидный сосед откатывается (ожидалось1, получено0).
   Это не просто недостающий тест:169 эти элементы корректно пропускала.
   SHA256 независимого теста:
   `115a83e03fe91dfb6e7b2bf5a27cb1e6e25812ae300d171e5ae6ff0e6cf15907`.
2. **P2, ложноположительная конкурентная приёмка.** Оригинальный драйвер
   на170: 4 PASS, 99→100 дважды, повторы1+3+4=8 дважды. После преднамеренной
   мутации **только лабораторной функции** (порог100→99) драйвер снова даёт
   exit0 / 4 PASS:99→99 дважды, оба новых события отвергнуты. В продукт
   мутация не переносилась. Нужна положительная проверка занятого сотого
   слота/возвратов RPC, а не только отсутствие превышения100.

Исходные **69 assertions Claude — PASS** на нашей170; guard-тесты его
драйвера — **4 PASS**. Полные1640 pgTAP, frontend/build/CI повторно здесь
не запускались после обнаружения блокера; их результаты в отчёте Claude
не выдаются за независимую приёмку. Старые финансовые данные не затрагивались.

Доказательства в папке ревью: `missing-fields-169.log`,
`missing-fields-170.log`, `claude-69.log`, `concurrency-original.log`,
`concurrency-quota99-mutant.log`. Одноразовая БД удалена после проверки
имени/собственного маркера; список остальных баз побайтово совпал с исходным.
Синтетические SQL/логи сохранены для повторения, рабочие пользовательские
файлы не удалялись. **170 не интегрирована и не выпущена.** В едином плане
подготовлено задание F6.2-R1; F6 остаётся открытой.

## 13.09.2026 — F6.2-R1, предварительная приёмка (SQL ещё NOT RUN)

Полученный кумулятивный patch SHA256
`1d64f65cce7d86c0e1fa4669584115fd0b4dda4142ef8e2ae1cfc1d4f40834a0`
совпал; 8 файлов, +1085/−1, `git apply --check` на Kassa0502e6b PASS.
Применён только к новому git-archive снимку
`/private/tmp/angle-f62r1-review-7GVs2F/`, не к исходному проекту.
Локальная работа ANGLE B1/B3 не менялась, production не читался/не менялся.

Проверено самостоятельно: lint, check:schema170, **745 Vitest / 72 файла**,
**42 bundle + 11 ops + 6 guard/parser** — PASS; POS/Menu builds и оба
`check:bundle` — PASS. Modern/legacy POS62.0/130.4KiB, Menu61.5/129.5KiB,
пороги240/310 не менялись. Node22.16.0/npm10.9.2; сборки на placeholder env.
Использованы установленные зависимости прошлой изолированной приёмки при
побайтово совпавшем lock, нового npm ci здесь не было.

В ревью SQL проверены `IS DISTINCT FROM` обязательных строковых полей и
NULL-safe пустой fingerprint; у драйвера — точное99→100, значения возврата
RPC, сохранность seed и проверка конкретных блокировок. Независимый
`missing-fields-review.sql` перенесён неизменённым, SHA256115a83e0…f15907.
Логи: `acceptance-tests.log`, `pos-build.log`, `pos-budget.log`,
`menu-build.log`, `menu-budget.log` в снимке.

**Независимые SQL/конкурентные проверки R1 — NOT RUN**: запрошено новое
окно включения Colima, ответа на момент записи нет. 1734 pgTAP из отчёта
Claude пока не выдаются за свой результат. Новая БД не создавалась;
Colima здесь не включалась. До закрытия этой проверки патч не интегрирован,
170 не применялась к production, commit/push/deploy не выполнялись.

## 13.09.2026 — F6.2-R1, независимая SQL-приёмка и локальная интеграция

После разрешения владельца «продолжай» Colima включена на21:49–21:54 IDT,
создана только `kassa_f62_review_r1_7gvs2f` с собственным маркером и
синтетическими данными. Bootstrap платформы и неизменённые001–169,
затем проверенный кумулятивный R1 из предыдущей записи. Рабочий снимок:
`/private/tmp/angle-f62r1-review-7GVs2F/`.

- **Независимые12 проверок обязательных полей:** PASS на169 и170-R1.
  Тест не менялся, SHA256115a83e0…f15907. Провал первоначального170
  зафиксирован в предыдущем независимом ревью; SQL NULL-регрессия закрыта.
- **Усиленный конкурентный драйвер на169:** exit1; дважды99→101,
  RPC=[1,1]. На170-R1: exit0 /4 PASS, дважды99→100, RPC=[0,1]; повторы
  дважды дают одну строку,count8,RPC=[1,1]. Наблюдаются именно блокировки
  спорного участка после освобождения стартового барьера.
- **Отрицательная мутация только лабораторной функции:** порог100→99
  даёт exit1, дважды99→99,RPC=[0,0]. Ложноположительная приёмка закрыта;
  мутант не переносился в продукт, перед полным прогоном функция восстановлена.
- **Первый полный pgTAP:**83 файла прошли, два старых reservation-набора
  остановились с SQL-ошибкой. В21:51–21:54 IDT `NOW()+2 hours` попадало
  после окончания тестового расписания23:45: первый вызов получал
  `outside_hours`, повтор предоплаты — следом `invalid_name`, поскольку
  первая бронь не была создана. Эти два файла не входили в patch Claude.
  Исходные версии повторно воспроизведены отдельно, логи сохранены.
- **Исправление здесь:** только часы фикстур в
  `reservation_guest_identity.test.sql` и `reservation_prepayment.test.sql`:
  завтрашние12:00–16:00 в Asia/Jerusalem, прежний разрыв4 часа между
  предоплатными бронями; настоящее истечение hold через NOW() сохранено.
  Расписание, продуктовые функции и все23+27 assertions не менялись.
- **Итоговый полный pgTAP:**85 файлов, **1734 PASS,0 FAIL,0 SQL errors**.
  Frontend745 +bundle42 +ops11, guard/parser6, lint/schema170 и обе сборки
  проверены в предварительной приёмке на том же исходном коде; две новые
  правки затронули только SQL-фикстуры, повторного npm ci здесь не было.

Логи: `missing-fields-169.log`, `missing-fields-170-r1.log`,
`concurrency-169.log`, `concurrency-r1.log`, `concurrency-quota99.log`,
`original-identity-failure.log`, `original-prepayment-failure.log`,
`sql-results-original-fixtures.json`, `sql-results.json` и `sql-*.log`.
После проверки собственного имени/маркера удалена только новая тестовая БД;
инвентарь остальных баз побайтово совпал, Colima выключена и это проверено.
Синтетические файлы/логи сохранены; пользовательские данные и дубли не удалялись.

**Принято и объединено локально:**8 файлов F6.2-R1 и2 исправленные SQL-фикстуры
побайтово совпадают с проверенным снимком. Исходный HEAD Kassa всё ещё0502e6b,
изменения пока незакоммичены. Production не читался/не менялся, остаётся
последняя подтверждённая169; миграция170, CI, push и deployment **NOT RUN**.
SQL-роль с синтетическими claims не заменяет настоящий GoTrue/HTTP; физический
T2 не проверялся. Серверная privacy/ретенция, поддержка и F5 остаются открытыми.

## 13.09.2026 — подготовлено задание Claude F6.3-A (аудит, без реализации)

В едином плане добавлено актуальное задание F6.3-A: карта серверных полей,
доступ, срок хранения и проект безопасной обработки исторических логов.
Production, исходные проекты, runtime/миграции и общий журнал для Claude
закрыты на запись; настоящее содержимое логов/дампов не входит в задание.
Новая миграция, scheduler и удаление данных не разрешены этим аудитом.

Подготовлен фиксированный архив
`/private/tmp/angle-f63-handoff-rqkpiU/kassa-f63-baseline.tar.gz`, SHA256
`ec2e8ccf2c1cfbbaab99be0d85b481d70057705410824b1d81314bbb2e02d56e`.
База0502e6b плюс принятые локальные170-R1 и две SQL-фикстуры;729 файлов
сверены побайтово с исходной Kassa. Инвентарь архива проверен: без env,
Git/Claude/локальных метаданных, dependencies/build, backups и дублей.
Архив не содержит новых результатов тестов и не означает выпуска170.
Colima и production в ходе подготовки задания не использовались.

## 13.09.2026 — подготовка согласованного выпуска170 и B1/B3

Владелец передал F6.3-A Claude; аудит выполняется независимо на фиксированном
снимке, без новой реализации. Здесь начат выпуск ранее принятых F6.2-R1/170,
двух timezone-фикстур SQL и маршрута первого запуска B1/B3. Действующее
разрешение владельца включает миграции и push в main обоих проектов.

Перед выпуском побайтово сверены258 недокументационных файлов ANGLE с
`/private/tmp/angle-a62-accept-dX6QIU/anglesite` и709 Kassa с
`/private/tmp/angle-f62r1-review-7GVs2F/`: расхождений нет. Используются
уже подтверждённые764 unit +244 browser ANGLE,745 Vitest +42 bundle +11 ops
и1734 SQL Kassa, обе сборки и отдельные конкурентные проверки. Это сверка
ранее принятого кода, не новый полный прогон. Исходные видео, ` 2`-дубли и
`.claude/launch.json` сохраняются вне релиза. Backup/миграция/main/CI/Vercel
на момент этой записи ещё не завершены; результат фиксируется отдельно.

## 13.09.2026 — выпуск170 и B1/B3: production, main, CI и публикации PASS

Разрешённый выпуск завершён. Kassa **`cb56f483416b8785e0fea745453cf6f69e634f18`**
(10 файлов) и ANGLE **`ef345e0c62d17b3e9531d06a55070e1d2faeab25`**
(12 файлов) отправлены fast-forward в main. Новые функциональные правки
после принятого снимка не добавлялись; пользовательские дубли/сырые видео
и локальные Claude-настройки не включены и не удалены.

Артефакты выпуска: `/private/tmp/angle-a62-accept-9oeEFO/`.
Совместный docs guard:8 PASS,70 документов /268 ссылок /0 ошибок.
Для CLI использован чистый список миграций и ссылки на исходные env/привязку;
секреты не копировались в исходники/артефакты Claude и не выводились в чат.

**До изменения production:** project-ref guard подтвердил
`qgmnxrgtlpyqglwqmsej`, схема169, checkout disabled. У2 устройств/2 Auth-user
нулевые missing/null/foreign/duplicate/banned/mismatched привязки.
Проверялись агрегаты и контрольные суммы, не содержимое client_errors/ops_errors.

Свежий штатный backup:
`/Users/enotov/Desktop/kassa/backups/2026-09-13T19-20-55.686Z-ziqX2u`.
Завершён19:22:07 UTC; manifest complete, SHA256/размеры/права PASS,
100 COPY-таблиц, включая auth.users/orders/payments/devices. Roles297B,
schema960174B, data547290B; каталог0700/файлы0600, Git-ignored, FileVault On.
Restore этой новой копии, offsite, PITR и файлы Storage этим не подтверждены.
Colima включена только для backup22:19–22:24 IDT, затем выключена;
существующие лабораторные БД не сбрасывались и не удалялись.

**Миграция:** guarded dry-run показал ровно170, без seeds/roles;
`npm run db:push -- --yes` применил её до обновления клиентов. SHA256
SQL в исходниках и снимке совпал:
`7a0b5f2623139ee97629b55e956bc81a65d4819e9e426703fac9081abd4c7201`.
Read-only postcheck: схема170, одна запись ledger, тела обеих функций
побайтово соответствуют исходнику по digest; SECURITY DEFINER/search_path,
закрытые таблица/view/helper и разрешённый authenticated-ingest проверены.
Контрольные агрегаты/хеши до/после одинаковы:330 заказов,126 оплат,
привязки устройств, продукты/подписки/checkout requests. Checkout disabled
сохранён. Ingest не вызывался в production, тестовых записей не создавалось.
Логи: `backup170.log`, `migration170-dry-run.log`, `migration170.log`,
`preflight170.json`, `after170.json`, `postcheck170.json`.

**CI на функциональных коммитах — success, проверено19:27 UTC:**

- [Kassa CI34777631850](https://github.com/fairgvard-sketch/pos/actions/runs/34777631850):
  frontend и database, включая миграции с нуля и pgTAP.
- [ANGLE CI34777627472](https://github.com/fairgvard-sketch/angles/actions/runs/34777627472):
  обязательные unit/browser, сборка и docs.

**Vercel — success на тех же SHA:**
[POS](https://vercel.com/vandal2/pos/KQ8RVCfijrgQBPS6RPDN5E76v4xi),
[Menu](https://vercel.com/vandal2/angle-menu/5DjZ5HwUqmr7AVtoDhZDmjNKoR73),
[ANGLE](https://vercel.com/vandal2/angles/4kD19sAYfPJ3VhNhZTQSwKhb4EwH).
Использована действующая Git-интеграция, новый хостинг не создавался.
Edge Functions/APK не менялись и не перевыпускались.

**HTTP smoke19:29 UTC — PASS:** главная, кабинет, POS/setup, гостевая Menu
отдают HTML200;17 same-origin JS/CSS отвечают200 с правильным content-type.
Hero MP4 —200,1 070 121B, immutable cache; карусель логотипов не вернулась.
Кабинет `index-CMhfIZks.js`, POS `index-DR_UC7dF.js`, Menu `index-D5jjuRiZ.js`.
Доказательства — `status-*.json` и `public-smoke.json` в снимке выпуска.

Это проверка публикаций/HTTP, не реальный Auth/почта, browser-сессия
обычного владельца, работающая касса, обновление SW или физический T2.
F5 остаётся обязательным до первого заведения с реальными операциями,
включая бесплатный пилот; платежи и налоговая регистрация не подключались.

## 13.09.2026 — B3, первичный baseline открытой корзины (исправление впереди)

На неизменённом Kassa `cb56f48` добавлены только внешние синтетические probes:
`/private/tmp/angle-b3-review-VQnBOs/cart-baseline.test.mjs`, лог `baseline.log`.
Функция `reconcileCart.ts` транспилирована установленным TypeScript и проверена
Node-runner без браузера/сети/Auth/БД. Код обоих проектов не менялся.

4 положительных контроля PASS: неизменённая строка, новая цена, исчезнувшая
опция, пустая необязательная группа.4 новых сценария FAIL: переименование
размера/модификатора с тем же ID сохраняет старую подпись; новая обязательная
группа без выбора и уменьшенный max_select оставляют невалидный состав в
результате сверки. Это отсутствие проверки ограничений выбранного состава,
не доказательство фактического приёма такого заказа сервером.

По чтению вызывающего эффекта PublicOrderPage результат простого переименования
товара тоже отбрасывается, если нет удаления/изменения цены. Это пока статическое
наблюдение, не воспроизведённый browser-тест. Следующий шаг — совместная матрица
server/UI, затем исправление с положительными контролями. B2/B3 не закрыты;
эти новые проверки не входят в зелёный regression suite выпущенного170.

## 13.09.2026 — косметика native-select и фильтров кабинета

База ANGLE `3327f60`. Изменён только общий `responsive.css`: системная
стрелка закрытого single-select заменена двумя CSS-штрихами, 12px от края,
36px под стрелку и зазор до текста. Нативный список, клавиатура и labels
сохранены; учтены RTL, disabled/invalid и forced-colors. Multiple/listbox
не меняются. Фильтры и соседние действия каталога одной высоты (40/44px),
короткие подписи на узком экране не обрезаются ради размещения двух полей.
JS продукта, Auth, API, Kassa, зависимости и данные не менялись.

**Локальная приёмка:** macOS, Node22.16.0/npm10.9.2, Chrome for Testing150;
снимок `/private/tmp/angle-a62-accept-guDkFG/anglesite`, только отслеживаемые
файлы и новый `select-controls.test.mjs`. Пользовательские дубли ` 2`,
сырьевые видео и секреты исключены без изменения исходников. Зависимости
переиспользованы из предыдущего принятого снимка, не новый `npm ci`.

- Первая версия проверок общих полей на исходном CSS: 2 PASS / 7 FAIL.
  После правки и дополнительных проверок высоты/текста — 9/9 PASS.
- Настоящий Catalogue на заглушках: 30/30 PASS, включая 4 новых сценария
  320/375/768/1280px. Изображения товаров в фикстуре — ненастоящие URL;
  их загрузка не является проверяемым контрактом этой косметики.
- Финальный `ANGLE_BROWSER=required npm test`: unit764/764,
  browser258/258, 0 FAIL/cancelled/skipped, browser100.3s, exit0.
- `npm run build` PASS; существующее предупреждение о >500kB chunk осталось,
  порог не повышался. Runtime CSS совпадает со снимком по SHA256:
  `998a3c62ca98cdfb35e59a5837175375b1cf54126e36246873d28301cf885caa`.
- Guard документации8/8; 70 документов/269 ссылок/0 ошибок;
  `git diff --check` PASS.

Начальные неуспешные прогоны сохранены. В новом Catalogue-тесте ожидался
внутренний ключ `category` вместо фактического URL-ключа `zn`; исправлена
проверка, не продукт. Затем один полный прогон отменил account-auth.test.mjs
по 120s; отдельно13/13 PASS и повторный полный прогон выше PASS. Причина
Auth-таймаута не установлена: наблюдение F3 открыто, лимиты/assertions
прежних тестов не менялись, автоматический retry не добавлен.

Артефакты: `/private/tmp/angle-controls-reE63f/` — controls.log,
catalogue-after.log, auth-isolated.log, full-tests-final.log, build.log,
HTML/PNG полей и настоящего каталога на четырёх ширинах. Снимки просмотрены.
Это локальный Chrome/синтетика, не Safari/iPhone, T2, живой Auth или закрытие
B2/B3. CI и публикация проверяются отдельно после push.

**Выпуск подтверждён:** ANGLE `98e37a5` отправлен в main;
[CI34779045863](https://github.com/fairgvard-sketch/angles/actions/runs/34779045863)
success (все шаги, включая обязательный browser, завершились19:55:22 UTC).
[Vercel](https://vercel.com/vandal2/angles/ASMw28vtncreiNqSAcNT3w5qB4EX)
success. HTTP-проверка19:53:49 UTC: `/account` и CSS200, production
`index-v3WNLDCP.css` побайтово совпал с принятой сборкой (198464B,
SHA256 `f8f5ad518b802b545e24022bc15dad19ffeddc978d623bcb5f9999a302ef4c3d`).
Доказательство — `public-style-check.json` в каталоге артефактов выше.
Kassa осталась на `cb56f48`, её tracked-дерево не менялось; миграции,
платежи, серверные данные и публикации POS/Menu не затронуты.
Временный локальный сервер предпросмотра завершён.

## 13.09.2026 — B2/B3, локальная сверка гостевой корзины

База Kassa `cb56f48`, схема170; **commit/push/deploy не выполнены**.
Исправлены подписи товара/размера/добавок, в том числе переименование без
изменения цены в вызывающем эффекте страницы. Несовместимый состав удаляется
с понятным уведомлением: исчезнувший выбор, появившиеся размеры без выбора,
min/max каждой группы, повтор одного ID. Нулевой max остаётся безлимитным.
Default не выбирается автоматически. Сохраняются ID/порядок/количество/ключ;
неизменённая корзина возвращается по ссылке, исходные строки не мутируются.

Проверки на снимке `/private/tmp/angle-a62-accept-PreGgH/kassa`:

- Новый baseline до продуктовой правки:20 тестов функции (11FAIL/9PASS),
  4 теста настоящей React-страницы (3FAIL/1PASS). После:24/24 PASS.
  Четыре новых падения про identity массива — новый контракт, а не четыре
  дополнительных пользовательских дефекта. Прежние8 тестов сохранены.
- React/jsdom проверяет восстановление и повторное открытие, изменение
  Query-данных у открытой корзины, подписи на экране и localStorage,
  удаление строки при новой обязательной группе и пересчёт с сохранением qty.
  API синтетический; реальный fetch запрещён тестом. Это не живой браузер/БД.
- Первоначальная независимая проба из
  `/private/tmp/angle-b3-review-VQnBOs/cart-baseline.test.mjs`: теперь8/8 PASS.
- `npm run test:all`: Vitest761/761 (73 файла), bundle42/42, ops11/11, exit0.
  `npm run lint` PASS, `check:schema` PASS(v170).
- POS build + budget PASS: modern62.0/240.0, legacy130.4/310.0KiB gzip.
  Menu build + budget PASS: modern61.5/240.0, legacy129.5/310.0KiB gzip.
  Обе сборки включают tsc; placeholder env, реальные ключи не использовались.

Node22.16.0/npm10.9.2; зависимости переиспользованы из принятого снимка
`angle-a62-accept-zB1JYe`, не свежий npm ci. Lock побайтово совпал
(SHA256 `7485f5f9bb1f9ac76291ccbbf6de12bdbae7597224d133d7717156c7b6d4eb29`).
Логи baseline/after/full/lint/schema/build/budget и независимой пробы лежат
в корне `angle-a62-accept-PreGgH`. Пользовательские дубли, видео и секреты
в снимок не попадали и не изменялись.

Открыто: серверные min/max (по чтению116 отсутствуют, SQL NOT RUN), свежесть
уже открытой карточки выбора, проверка при отправке и полный сквозной путь.
Без новых миграций, изменения Auth/телеметрии/финансов или production.
CI, физический телефон/T2 и реальный Auth — NOT RUN. F5 и B2/B3 не закрыты.

Параллельно Claude получил F6.3-A-R1: аудит проекта privacy/ретенции после
контрпримеров review, без исходных проектов/SQL/production. Условие владельца
о передаче всей работы при остатке Codex ниже50% записано в общем плане.

## 14.09.2026 — выпуск клиентского B2/B3 перед передачей работы

Владелец уточнил: закончить текущую задачу до публикации, затем передать
Claude. Выпущен Kassa `fa73c06a7d3cc77903440a6c2ce9e4d108c130a7` (6 файлов,
включая новый PublicOrderCart.test.tsx); main синхронизирован перед push.
SQL, Edge Functions, Auth, схема170 и production-данные не менялись.

Дополнительная приёмка готовой Menu-сборки: Chrome150.0.7871.24,
375×812 и1280×812. Настоящий собранный клиент обновил все подписи и storage,
удалил строку после новой обязательной группы, показал помещающееся
уведомление; page errors0, внешние API-запросы перехвачены синтетикой.
Сначала локальный сервер, затем тот же прогон на опубликованном
`https://menu.angle.co.il` — PASS21:11:39 UTC13.09 (00:11 14.09 по Иерусалиму).
Это опубликованный JS с подставленным API, не проверка реального приёма заказа.
Сервер и отдельные браузерные контексты после прогонов закрыты.

Артефакты в `/private/tmp/angle-a62-accept-PreGgH/`:
`cart-browser.mjs`, `cart-browser-final.log`, `published-cart-browser.log`,
`published-cart-browser.json` и viewport PNG на обеих ширинах.
Viewport-снимки просмотрены. Full-page захват на этой странице получился
сдвинутым: ожидание конца анимации не изменило его; снимок видимой области
корректен при той же геометрии (375px client/inner/scroll, frame0…375).
Full-page PNG не использовать как доказательство реальной обрезки интерфейса.

**Выпуск:**

- [CI34782943524](https://github.com/fairgvard-sketch/pos/actions/runs/34782943524):
  frontend и database success, подтверждено21:12:12 UTC.
- [POS Vercel](https://vercel.com/vandal2/pos/5hCyxuwaiLj7KJnXK1jvMePdrrPt)
  и [Menu Vercel](https://vercel.com/vandal2/angle-menu/7WA3MZrWHzi9ZPcshsxTkdcH9CkY)
  success для того же commit.

Публичные POS `/setup` и Menu `/order/…` дополнительно проверены HTTP GET,
JS/CSS ссылки — HEAD: результаты в `public-smoke.json`; API не вызывался.

Предыдущие локальные761+42+11, обе сборки и doc guards относятся к этому
runtime-коду; CI выполняет отдельную установку по lock. Пользовательские
дубли, видео и `.claude/launch.json` остались нетронутыми.
Открытые B2/B3 server/min/max, config sheet, сквозной цикл и F5 не закрыты.
Живой Auth, физический телефон/T2 и обновление старой SW-вкладки NOT RUN.
