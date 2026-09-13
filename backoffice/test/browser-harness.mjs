import puppeteer from 'puppeteer'

/**
 * Общий запуск и остановка браузера для наборов `backoffice/test/*.test.mjs`.
 *
 * Зачем. Раньше каждый набор ловил ошибку запуска Chrome сам и переводил
 * свои suites в `skip`. Прогон при этом заканчивался кодом 0: «зелёный»
 * результат означал только то, что браузера не было. Выпускать по такому
 * результату нельзя, поэтому режим по умолчанию — обязательный: нет
 * браузера — ошибка с причиной и ненулевой код возврата.
 *
 * Пропуск остаётся, но только как ЯВНО выбранный режим разработчика:
 *
 *   ANGLE_BROWSER=optional npm test
 *
 * В CI переменная задаётся как `required`, и пропуск невозможен.
 */

const MODE_VAR = 'ANGLE_BROWSER'
const HINT = 'установите браузер: npx puppeteer browsers install chrome'

/** Запуск не должен висеть бессрочно: лучше внятный таймаут, чем зависший job. */
const LAUNCH_TIMEOUT_MS = Number(process.env.ANGLE_BROWSER_LAUNCH_TIMEOUT_MS || 60_000)
const CLOSE_TIMEOUT_MS = 15_000

/** Аргументы одни на все наборы: см. комментарий про reduced-motion ниже. */
const DEFAULT_ARGS = [
  '--no-sandbox',
  /*
   * `--force-prefers-reduced-motion` — не про доступность, а про
   * надёжность набора: слои приезжают и уезжают, и клик по кнопке внутри
   * ещё не доехавшей панели уходит мимо (puppeteer честно отвечает «node
   * is not clickable»). Здесь проверяется поведение, а само движение —
   * отдельным набором, где анимация включена обратно.
   */
  '--force-prefers-reduced-motion',
]

export function browserMode(env = process.env) {
  const raw = env[MODE_VAR]
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === '' || value === 'required') return 'required'
  if (value === 'optional') return 'optional'
  throw new Error(`${MODE_VAR}: ожидается "required" или "optional", получено ${JSON.stringify(raw)}`)
}

/** Короткая причина одной строкой: ею помечается осознанный пропуск. */
export function launchFailureReason(error) {
  const first = String(error?.message ?? error).split('\n')[0]
  return `no browser for puppeteer (${first}); ${HINT}`
}

/**
 * Полная диагностика запуска: puppeteer кладёт в сообщение вывод самого
 * Chrome, а разбираться по одной первой строке нельзя — «Failed to launch
 * the browser process: Code: null» не говорит вообще ничего.
 */
export function launchFailureDetails(error) {
  const seen = new Set()
  const parts = []
  for (let current = error; current && !seen.has(current) && parts.length < 5; current = current.cause) {
    seen.add(current)
    parts.push(String(current.stack || current.message || current))
  }
  return parts.join('\nПричина ниже: ')
}

/**
 * Ошибка обязательного режима: полный текст отказа остаётся в сообщении,
 * а исходная ошибка — в `cause`, чтобы её видел и обработчик, и человек.
 */
export function requiredModeError(error) {
  return new Error(
    `no browser for puppeteer — браузерные наборы обязательны.\n` +
    `${launchFailureDetails(error)}\n` +
    `Что делать: ${HINT}.\n` +
    `Осознанный пропуск: ${MODE_VAR}=optional (в CI не используется).`,
    { cause: error },
  )
}

/**
 * Chrome, запущенный набором, не должен пережить прогон: осиротевший
 * процесс тянет память и роняет следующий запуск чужой сессией профиля.
 */
const running = new Set()
let exitHookInstalled = false

function installExitHook() {
  if (exitHookInstalled) return
  exitHookInstalled = true
  const killAll = () => {
    for (const browser of running) {
      try {
        browser.process()?.kill('SIGKILL')
      } catch {
        /* процесс уже умер — это и требовалось */
      }
    }
    running.clear()
  }
  process.on('exit', killAll)
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      killAll()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
}

/**
 * Запускает браузер по выбранному режиму.
 *
 * @returns {Promise<{browser: import('puppeteer').Browser|null, skip: false|string}>}
 *   `skip` — строка-причина для `describe(..., { skip })`; в обязательном
 *   режиме сюда не возвращаются: там запуск бросает ошибку.
 */
export async function launchBrowser(options = {}) {
  const mode = browserMode()
  try {
    const browser = await puppeteer.launch({
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
      /*
       * Связь по stdio, а не по TCP: когда прогон убивают жёстко (node
       * снимает файл теста по `--test-timeout`, и наш обработчик выхода уже
       * не отработает), закрытая труба сама гасит Chrome. По websocket он
       * в этом случае остаётся сиротой и висит до перезагрузки.
       */
      pipe: true,
      ...options,
      args: [...DEFAULT_ARGS, ...(options.args ?? [])],
    })
    installExitHook()
    running.add(browser)
    return { browser, skip: false }
  } catch (error) {
    if (mode === 'required') throw requiredModeError(error)
    // Пропуск помечается короткой причиной: подробности здесь не нужны,
    // решение «работаем без браузера» уже принято осознанно.
    console.log(`SKIP ${launchFailureReason(error)} [${MODE_VAR}=optional]`)
    return { browser: null, skip: launchFailureReason(error) }
  }
}

function withTimeout(promise, ms, message) {
  let timer
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref?.()
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

/** Закрыть браузер; зависшее закрытие не должно держать прогон. */
export async function closeBrowser(browser) {
  if (!browser) return
  running.delete(browser)
  const child = browser.process()
  try {
    await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, 'browser.close() не ответил вовремя')
  } catch (error) {
    console.error(`browser: ${error.message}; процесс снимается принудительно`)
    try {
      child?.kill('SIGKILL')
    } catch {
      /* уже умер */
    }
  }
}

/**
 * Закрыть тестовый HTTP-сервер вместе с keep-alive соединениями: иначе
 * сокет страницы удерживает порт и прогон завершается не сразу.
 */
export function closeServer(server) {
  if (!server) return Promise.resolve()
  server.closeAllConnections?.()
  return new Promise((resolve) => server.close(() => resolve()))
}
