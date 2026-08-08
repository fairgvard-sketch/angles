import { useState } from 'react'
import { supabase } from './supabase'
import { PRODUCT_META, productState } from './navigation'

/**
 * Карточка продуктов (100/104/105): жизненный цикл каждой карточки —
 * Active / Developer / Included with ANGLE Orders / Pending activation /
 * Available as add-on. Биллинга нет: «запросить» создаёт заявку
 * (request_product_activation), активирует оператор ANGLE. Карточка —
 * маркетинг/UX-состояние; настоящие запреты живут на сервере
 * (module_disabled).
 *
 * Отдельный модуль, а не кусок App.jsx: карточку показывают два разных
 * места — экран активации (организация ещё без продуктов) и вкладка
 * Products в настройках. Общий импорт из App.jsx завязал бы ленивый чанк
 * настроек на первый чанк кабинета.
 *
 * Названия продуктов живут в `navigation.js` рядом с `productState`: о
 * заявке, которая ждёт активации, сообщает ещё и дашборд.
 */

function ProductRow({ context, product, onReloadContext }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const state = productState(context, product.id)

  async function requestActivation() {
    setBusy(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('request_product_activation', {
      p_product: product.id,
    })
    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }
    await onReloadContext?.()
    setBusy(false)
  }

  const isOn = state === 'active' || state === 'developer' || state === 'included'
  return (
    <div className={`product-row ${isOn ? 'is-active' : ''}`}>
      <span>
        <strong>{product.label}</strong>
        <small>{product.detail}</small>
        {error && <small className="form-error">{error}</small>}
      </span>
      {state === 'active' && <span className="status"><i /> Active</span>}
      {state === 'developer' && <span className="status status-developer"><i /> Developer</span>}
      {state === 'included' && <span className="status">Included with ANGLE Orders</span>}
      {state === 'pending' && <span className="status status-pending"><i /> Pending activation</span>}
      {state === 'addon' && (
        <button className="text-button" onClick={requestActivation} disabled={busy}>
          {busy ? 'Requesting…' : 'Available as add-on — request'}
        </button>
      )}
    </div>
  )
}

export default function ProductsCard({ context, onReloadContext, heading = true }) {
  if (!Array.isArray(context?.products)) return null
  return (
    <section className="panel form-panel">
      {heading && (
        <div className="panel-heading">
          <div><h2>Your products</h2><p>Modules enabled for this organisation. Everything shares one catalogue and account.</p></div>
        </div>
      )}
      <div className="product-list">
        {PRODUCT_META.map((product) => (
          <ProductRow key={product.id} context={context} product={product} onReloadContext={onReloadContext} />
        ))}
      </div>
    </section>
  )
}
