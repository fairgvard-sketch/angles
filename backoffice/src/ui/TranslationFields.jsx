import { MENU_TRANSLATION_LANGS } from '../translations'

/**
 * Названия на английском и русском для гостя QR-меню (Kassa 184) — в
 * диалогах категории, группы добавок и добавки. Пустое поле: гость увидит
 * оригинальное название, поэтому оно и стоит подсказкой внутри поля.
 */
export default function TranslationFields({ draft, original, onChange }) {
  return (
    <>
      <div className="field-row">
        {MENU_TRANSLATION_LANGS.map(({ code, label }) => (
          <label key={code} className="qr-field">
            <span>{label} name</span>
            <input
              lang={code}
              value={draft[code]?.name ?? ''}
              maxLength={120}
              placeholder={original || 'Same as the original'}
              onChange={(e) => onChange({ ...draft, [code]: { ...draft[code], name: e.target.value } })}
            />
          </label>
        ))}
      </div>
      <p className="hint">Shown in the QR menu to guests who pick English or Russian.</p>
    </>
  )
}
