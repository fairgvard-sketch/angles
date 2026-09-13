import { Button } from './ui/Button'
import { hasCapability } from './navigation'

/** A route through existing editors, not a second editor or a launch certificate. */
export default function MenuSetup({ context, location, catalogue, guestUrl, onNavigate }) {
  const empty = catalogue?.availableCount === 0
  const navigate = (view, tab = null) => onNavigate(view, location.id, tab)
  return (
    <section className="panel menu-setup" aria-label="Prepare your guest menu">
      <details key={empty ? 'empty' : 'review'} open={empty || !catalogue}>
        <summary>
          <strong>Prepare your guest menu</strong>
          <span>{!catalogue ? 'Could not check the catalogue — retry loading to check it.'
            : empty ? 'No available items for guests at this location.'
              : `${catalogue.availableCount} available ${catalogue.availableCount === 1 ? 'item' : 'items'} in ${catalogue.categoryCount} active ${catalogue.categoryCount === 1 ? 'category' : 'categories'} · Review setup`}</span>
        </summary>
        <p className="menu-setup-note">
          For {location.name}. Saved changes go live directly; check the guest page before sharing.
        </p>
        <ol>
          <li>
            <div><strong>Check your location</strong><p>Confirm the location name and the display name guests should see.</p></div>
            <Button variant="secondary" onClick={() => navigate('locations', 'details')}>Location details</Button>
          </li>
          <li>
            <div><strong>Fill this location’s catalogue</strong><p>Add categories and available items. Check prices, sizes and required options. The catalogue editor covers all your locations.</p></div>
            <Button variant="secondary" onClick={() => navigate('menu')}>Manage catalogue</Button>
          </li>
          {hasCapability(context, 'online_orders') && (
            <li>
              <div><strong>Review how guests order</strong><p>Set fulfilment types and review opening hours in QR Menu. Without a schedule, hours do not restrict ordering; other channel rules still apply.</p></div>
              <Button variant="secondary" onClick={() => navigate('online')}>Opening hours &amp; fulfilment</Button>
            </li>
          )}
          <li>
            <div><strong>Set up the guest page</strong><p>Check the appearance, short address and QR code before sharing them.</p></div>
            <Button variant="secondary" onClick={() => navigate('online')}>Link, QR &amp; appearance</Button>
          </li>
          <li>
            <div><strong>Check as a guest</strong><p>Open the page on a phone. Check the correct location, prices and available options. Opening the link does not mark this step complete.</p></div>
            {guestUrl ? <a className="text-button" href={guestUrl} target="_blank" rel="noreferrer">Open as guest</a>
              : <span className="menu-setup-note">Guest link could not be loaded. Retry loading.</span>}
          </li>
        </ol>
      </details>
    </section>
  )
}
