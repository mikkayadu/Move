import { BellIcon, TrashIcon } from './icons';
import type { PushState } from '../hooks/usePush';
import type { SavedDestination } from '../lib/types';

interface Props {
  destinations: SavedDestination[];
  push: PushState;
  onToggleNotify: (destination: SavedDestination) => void;
  onDelete: (destination: SavedDestination) => void;
  onBack: () => void;
}

/**
 * Saved destinations and the notification switch that makes them proactive.
 *
 * Watching is per destination rather than global, because "tell me about the
 * school run" and "tell me about every trip I ever took" are very different
 * products, and only the first one stays installed.
 */
export function ManageDestinations({
  destinations,
  push,
  onToggleNotify,
  onDelete,
  onBack,
}: Props) {
  return (
    <section className="panel">
      <header className="panel__head">
        <button type="button" className="link" onClick={onBack}>
          Back
        </button>
        <h2 className="panel__title">Saved places</h2>
      </header>

      <PushBanner push={push} />

      {destinations.length === 0 ? (
        <p className="empty">
          No saved places yet. Run a trip, then tap <strong>Save</strong> on the result to keep it
          here.
        </p>
      ) : (
        <ul className="saved-list">
          {destinations.map((destination) => (
            <li key={destination.id} className="saved-row">
              <div className="saved-row__text">
                <span className="saved-row__label">{destination.label}</span>
                <span className="saved-row__address">{destination.address}</span>
              </div>

              <div className="saved-row__actions">
                <button
                  type="button"
                  className={`toggle${destination.notify ? ' is-on' : ''}`}
                  onClick={() => onToggleNotify(destination)}
                  aria-pressed={destination.notify}
                  title={destination.notify ? 'Watching for a good window' : 'Not watching'}
                >
                  <BellIcon />
                  <span className="toggle__text">{destination.notify ? 'Watching' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => onDelete(destination)}
                  aria-label={`Delete ${destination.label}`}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PushBanner({ push }: { push: PushState }) {
  if (push.status === 'subscribed') {
    return (
      <p className="notice notice--ok">
        Notifications are on. Move will nudge you when a watched trip opens up.
      </p>
    );
  }

  if (push.status === 'denied') {
    return (
      <p className="notice">
        Notifications are blocked in your browser settings, so watched places will not alert you.
      </p>
    );
  }

  if (push.status === 'unsupported' || push.status === 'disabled') {
    return (
      <p className="notice">
        Push is unavailable here. Watched places still work, you just have to open the app to see
        the change.
      </p>
    );
  }

  return (
    <div className="notice notice--action">
      <span>Turn on notifications to get told when a good departure window opens.</span>
      <button type="button" className="button button--small" onClick={push.enable} disabled={push.busy}>
        {push.busy ? 'Enabling...' : 'Enable'}
      </button>
      {push.error && <span className="notice__error">{push.error}</span>}
    </div>
  );
}
