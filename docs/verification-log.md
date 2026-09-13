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
