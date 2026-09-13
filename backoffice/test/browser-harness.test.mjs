import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { browserMode, launchFailureDetails, launchFailureReason, requiredModeError } from './browser-harness.mjs'

/**
 * Проверки самого запуска браузера.
 *
 * Главное здесь — отрицательный тест: когда Chrome недоступен, прогон
 * обязан упасть с причиной, а не «пройти» с пропущенными suites. Это
 * проверяется настоящим запуском наборов в дочернем процессе с заведомо
 * несуществующим браузером, а не наличием переменной в YAML.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TEST_DIR = fileURLToPath(new URL('.', import.meta.url))
const SELF = 'browser-harness.test.mjs'
const NO_CHROME = join(tmpdir(), 'angle-no-such-chrome')

/** Наборы, которым нужен браузер: их определяет импорт общего harness. */
const browserSuites = readdirSync(TEST_DIR)
  .filter((file) => file.endsWith('.test.mjs') && file !== SELF)
  .filter((file) => readFileSync(join(TEST_DIR, file), 'utf8').includes("from './browser-harness.mjs'"))

const children = new Set()

after(() => {
  for (const child of children) child.kill('SIGKILL')
})

/**
 * Запустить один набор отдельным процессом. Без браузера набор обязан
 * завершиться быстро, поэтому ожидание ограничено: зависание — тоже отказ.
 */
function runSuite(file, env, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    // `NODE_TEST_CONTEXT` унаследован от текущего прогона: с ним дочерний
    // `node --test` считает себя вложенным и не запускает файл вовсе.
    const { NODE_TEST_CONTEXT: _ignored, ...clean } = process.env
    const child = spawn(process.execPath, ['--test', '--test-timeout=60000', join('backoffice/test', file)], {
      cwd: ROOT,
      env: { ...clean, PUPPETEER_EXECUTABLE_PATH: NO_CHROME, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.add(child)
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${file}: не завершился за ${timeoutMs} мс без браузера\n${out.slice(-2000)}`))
    }, timeoutMs)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      children.delete(child)
      resolve({ code, out })
    })
  })
}

describe('режим браузерных тестов', () => {
  it('по умолчанию обязательный', () => {
    assert.equal(browserMode({}), 'required')
    assert.equal(browserMode({ ANGLE_BROWSER: '' }), 'required')
    assert.equal(browserMode({ ANGLE_BROWSER: 'required' }), 'required')
  })

  it('пропуск включается только явно', () => {
    assert.equal(browserMode({ ANGLE_BROWSER: 'optional' }), 'optional')
    assert.equal(browserMode({ ANGLE_BROWSER: ' OPTIONAL ' }), 'optional')
  })

  it('непонятное значение не превращается молча в пропуск', () => {
    assert.throws(() => browserMode({ ANGLE_BROWSER: 'skip' }), /ожидается "required" или "optional"/)
    assert.throws(() => browserMode({ ANGLE_BROWSER: '1' }), /ANGLE_BROWSER/)
  })

  it('причина отказа называет и проблему, и способ починить', () => {
    const reason = launchFailureReason(new Error('Tried to find the browser\nи ещё строки'))
    assert.match(reason, /no browser for puppeteer \(Tried to find the browser\)/)
    assert.match(reason, /npx puppeteer browsers install chrome/)
    assert.ok(!reason.includes('\n'), 'причина — одна строка')
  })
})

describe('обязательный отказ сохраняет исходную ошибку', () => {
  /** Так выглядит реальный отказ запуска: смысл — в строках ПОСЛЕ первой. */
  const launchError = () => {
    const spawn = new Error('spawn /snap/chromium ENOENT')
    return Object.assign(
      new Error('Failed to launch the browser process: Code: null\n[0913/2312:FATAL] cannot create sandbox\nTROUBLESHOOTING: https://pptr.dev/troubleshooting'),
      { cause: spawn },
    )
  }

  it('диагностика содержит весь вывод браузера, а не первую строку', () => {
    const details = launchFailureDetails(launchError())
    assert.match(details, /Failed to launch the browser process/)
    assert.match(details, /cannot create sandbox/, 'строка с настоящей причиной сохранена')
    assert.match(details, /TROUBLESHOOTING/)
    assert.match(details, /spawn \/snap\/chromium ENOENT/, 'вложенная cause тоже сохранена')
  })

  it('ошибка обязательного режима несёт детали и исходную ошибку в cause', () => {
    const original = launchError()
    const error = requiredModeError(original)
    assert.equal(error.cause, original, 'исходная ошибка доступна обработчику')
    assert.match(error.message, /no browser for puppeteer/)
    assert.match(error.message, /cannot create sandbox/)
    assert.match(error.message, /npx puppeteer browsers install chrome/)
    assert.match(error.message, /ANGLE_BROWSER=optional/)
  })

  it('не зацикливается на кольцевой cause', () => {
    const a = new Error('первая')
    const b = new Error('вторая')
    a.cause = b
    b.cause = a
    assert.match(launchFailureDetails(a), /первая/)
  })
})

describe('браузерные наборы', () => {
  it('нашлись и запускаются через общий harness', () => {
    assert.ok(browserSuites.length >= 5, `ожидались все наборы, найдено: ${browserSuites.join(', ')}`)
  })

  it('не запускают puppeteer в обход harness', () => {
    for (const file of browserSuites) {
      const source = readFileSync(join(TEST_DIR, file), 'utf8')
      assert.ok(!source.includes('puppeteer.launch('), `${file}: запуск браузера только через harness`)
      assert.ok(!/\bskip\s*=\s*(true|`)/.test(source), `${file}: пропуск задаётся harness, а не самим набором`)
    }
  })
})

describe('убитый прогон', () => {
  /**
   * Прогон снимают жёстко: `--test-timeout` убивает файл теста, и никакой
   * обработчик выхода уже не отработает. Chrome обязан умереть сам, иначе
   * осиротевший браузер висит до перезагрузки и жрёт память.
   */
  it('не оставляет Chrome сиротой', { skip: browserMode() === 'optional' && `${'ANGLE_BROWSER'}=optional` }, async () => {
    const source = `
      import { launchBrowser } from ${JSON.stringify(new URL('./browser-harness.mjs', import.meta.url).href)}
      const { browser } = await launchBrowser()
      console.log(JSON.stringify({ pid: browser.process().pid }))
      await new Promise(() => {})
    `
    const { NODE_TEST_CONTEXT: _ignored, ...clean } = process.env
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: ROOT, env: clean, stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.add(child)
    const pid = await new Promise((resolve, reject) => {
      let out = ''
      const timer = setTimeout(() => reject(new Error(`браузер не запустился за 90 с: ${out}`)), 90_000)
      child.stdout.on('data', (chunk) => {
        out += chunk
        const match = out.match(/\{"pid":(\d+)\}/)
        if (match) {
          clearTimeout(timer)
          resolve(Number(match[1]))
        }
      })
      child.stderr.on('data', (chunk) => { out += chunk })
      child.on('close', () => {
        clearTimeout(timer)
        reject(new Error(`процесс завершился раньше времени: ${out}`))
      })
    })
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    assert.ok(alive(), 'браузер запущен')
    child.kill('SIGKILL')
    children.delete(child)
    const deadline = Date.now() + 20_000
    while (alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
    assert.ok(!alive(), `Chrome ${pid} пережил убитый прогон — осиротевший браузер`)
  })
})

describe('недоступный Chrome', () => {
  for (const file of browserSuites) {
    it(`${file}: обязательный режим падает с причиной`, async () => {
      const { code, out } = await runSuite(file, { ANGLE_BROWSER: '' })
      assert.notEqual(code, 0, `${file} завершился кодом 0 без браузера:\n${out.slice(-2000)}`)
      assert.match(out, /no browser for puppeteer/)
      assert.match(out, /npx puppeteer browsers install chrome/)
      assert.match(out, /ANGLE_BROWSER=optional/)
    })
  }

  it('явный ANGLE_BROWSER=optional пропускает набор осознанно', async () => {
    const file = browserSuites[0]
    const { code, out } = await runSuite(file, { ANGLE_BROWSER: 'optional' })
    assert.equal(code, 0, `${file} должен пройти в режиме пропуска:\n${out.slice(-2000)}`)
    assert.match(out, /SKIP no browser for puppeteer/)
    assert.match(out, /ANGLE_BROWSER=optional/)
  })
})
