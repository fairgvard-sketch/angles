import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

/**
 * Палитра проверяется арифметикой, а не глазами.
 *
 * Замер Phase 11 нашёл 22 места, где тихий текст не дотягивал до нормы
 * WCAG AA: `--c-text-faint` давал 2.63:1 на белом при требуемых 4.5, а
 * `--c-text-subtle` — 4.25. Это не вопрос вкуса: 11-пиксельная подпись
 * таким серым не читается на солнце и на дешёвой матрице терминала.
 *
 * Тест стережёт границу шкалы. Он упадёт, если кто-нибудь снова
 * осветлит тихий текст «чтобы было спокойнее» или заведёт очередной
 * литеральный серый мимо токенов.
 */

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

function token(name) {
  const match = CSS.match(new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})`, 'i'))
  assert.ok(match, `токен ${name} должен существовать`)
  return match[1]
}

function luminance(hex) {
  // #fff — такой же цвет, как #ffffff: без разворота короткой записи
  // белый считался бы синим, и тест мерил бы не то.
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex
  const n = parseInt(full.slice(1), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const linear = channels.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Поверхности, на которых в кабинете лежит текст */
const SURFACES = ['--c-surface', '--c-page', '--c-surface-muted', '--c-surface-sunken']
/** Цвета, которыми в кабинете пишут */
const TEXT = ['--c-text', '--c-text-strong', '--c-text-2', '--c-text-muted', '--c-text-subtle']

describe('палитра текста', () => {
  it('любой цвет текста читается на любой поверхности (AA 4.5:1)', () => {
    for (const text of TEXT) {
      for (const surface of SURFACES) {
        const ratio = contrast(token(text), token(surface))
        assert.ok(
          ratio >= 4.5,
          `${text} на ${surface} = ${ratio.toFixed(2)}:1, нужно 4.5:1`
        )
      }
    }
  })

  it('нетекстовый серый дотягивает до своей нормы (3:1)', () => {
    // Точки состояния и иконки — не текст: к ним применимо 3:1, и
    // считается оно по поверхности, на которой они лежат (панель и
    // фон страницы). Прежний --c-text-faint (#9ba0a8) не дотягивал
    // и до этой нормы: 2.63:1.
    for (const surface of ['--c-surface', '--c-page']) {
      const ratio = contrast(token('--c-icon-faint'), token(surface))
      assert.ok(ratio >= 3, `--c-icon-faint на ${surface} = ${ratio.toFixed(2)}:1, нужно 3:1`)
    }
  })

  it('шкала тихого текста не схлопнулась в один оттенок', () => {
    // Иначе «тихо» и «очень тихо» перестают различаться, и иерархия
    // держится только размером.
    assert.notEqual(token('--c-text-subtle'), token('--c-text-muted'))
    assert.ok(luminance(token('--c-text-subtle')) > luminance(token('--c-text-muted')))
  })

  it('тихий серый пишется токеном, а не литералом мимо шкалы', () => {
    /*
     * Литеральные серые 3.2–3.4:1 жили в шестнадцати правилах и
     * обходили любую правку палитры: `--c-text-subtle` можно было
     * потемнить сколько угодно, а подписи в шапке, в журнале и в плане
     * зала оставались нечитаемыми.
     *
     * Проверяем только НЕЙТРАЛЬНЫЕ серые: смысловые цвета (красный
     * отказа, зелёный успеха, янтарь ожидания) лежат на собственных
     * фонах, и мерить их по белому бессмысленно.
     */
    /*
     * Единственное исключение — подпись на тёмном герое отчёта по
     * броням (`.ov-hero`, #1b1e24): там 8.75:1, и по белому её судить
     * нельзя. Статический тест поверхность под селектором не знает,
     * поэтому исключение названо поимённо, а не угадывается.
     */
    const onDarkSurface = new Set(['#b7bcc4'])
    const page = luminance(token('--c-page'))
    const stray = [...CSS.matchAll(/(?<![-\w])color:\s*(#[0-9a-f]{6})\b/gi)]
      .map((m) => m[1].toLowerCase())
      .filter((hex) => !onDarkSurface.has(hex))
      .filter((hex) => {
        const n = parseInt(hex.slice(1), 16)
        const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        const neutral = Math.max(r, g, b) - Math.min(r, g, b) <= 16
        // Светлее фона страницы — значит, написано для тёмной
        // поверхности (тёмный герой отчёта); по белому его не судят.
        const forDark = luminance(hex) > page
        return neutral && !forDark && contrast(hex, token('--c-surface')) < 4.5
      })
    assert.deepEqual(
      [...new Set(stray)], [],
      'нейтральные литералы ниже AA — их место в токенах шкалы'
    )
  })
})
