import { useCallback, useEffect, useState } from 'react';
import { DestinationSearch } from './components/DestinationSearch';
import { ManageDestinations } from './components/ManageDestinations';
import { RecommendationCard } from './components/RecommendationCard';
import { AlertIcon, BoltIcon, ClockIcon, StarIcon } from './components/icons';
import { useGeolocation } from './hooks/useGeolocation';
import { usePush } from './hooks/usePush';
import { api } from './lib/api';
import type { Place, RecommendationResult, SavedDestination } from './lib/types';

type View = 'home' | 'result' | 'saved';

interface Target extends Place {
  /** Set when the trip came from a saved destination. */
  savedId?: string;
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [target, setTarget] = useState<Target | null>(null);
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<SavedDestination[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);

  const location = useGeolocation();
  const push = usePush();

  useEffect(() => {
    void api.listDestinations().then(setDestinations).catch(() => setDestinations([]));
  }, []);

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const run = useCallback(
    async (destination: Target) => {
      if (!location.position) {
        setError('Move needs your location before it can plan a trip.');
        return;
      }

      setTarget(destination);
      setView('result');
      setLoading(true);
      setError(null);

      try {
        const next = await api.recommendation({
          origin: location.position,
          destination: {
            lat: destination.lat,
            lon: destination.lon,
            name: destination.name,
            address: destination.address,
          },
          destinationId: destination.savedId,
        });
        setResult(next);
      } catch (failure) {
        setResult(null);
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not work out a recommendation right now.',
        );
      } finally {
        setLoading(false);
      }
    },
    [location.position],
  );

  const save = useCallback(async () => {
    const label = savingLabel?.trim();
    if (!target || target.savedId || !label) return;

    const created = await api.createDestination({
      label,
      address: target.address,
      lat: target.lat,
      lon: target.lon,
      notify: true,
    });

    setDestinations((current) => [...current, created]);
    setTarget({ ...target, savedId: created.id });
    setSavingLabel(null);
  }, [target, savingLabel]);

  const toggleNotify = useCallback(async (destination: SavedDestination) => {
    const updated = await api.setDestinationNotify(destination.id, !destination.notify);
    setDestinations((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  const remove = useCallback(async (destination: SavedDestination) => {
    await api.deleteDestination(destination.id);
    setDestinations((current) => current.filter((item) => item.id !== destination.id));
  }, []);

  return (
    <div className="app">
      <header className="masthead">
        <button type="button" className="brand" onClick={() => setView('home')}>
          <BoltIcon className="brand__mark" />
          Move
        </button>
        <button type="button" className="ghost" onClick={() => setView('saved')}>
          <StarIcon />
          Saved
        </button>
      </header>

      {!online && (
        <p className="notice notice--warn">
          <AlertIcon /> You are offline. Move can only show the last answer it saved.
        </p>
      )}

      <main className="main">
        {view === 'saved' && (
          <ManageDestinations
            destinations={destinations}
            push={push}
            onToggleNotify={toggleNotify}
            onDelete={remove}
            onBack={() => setView('home')}
          />
        )}

        {view === 'home' && (
          <section className="home">
            <h1 className="home__title">
              Should you
              <br />
              leave now?
            </h1>
            <p className="home__subtitle">
              One tap. Live traffic and weather along your actual route, read by Gemma 4.
            </p>

            <DestinationSearch
              near={location.position}
              disabled={location.status !== 'ready'}
              onPick={(place) => void run(place)}
            />

            <LocationStatus location={location} />

            {destinations.length > 0 && (
              <nav className="shortcuts" aria-label="Saved destinations">
                {destinations.map((destination) => (
                  <button
                    key={destination.id}
                    type="button"
                    className="chip"
                    disabled={location.status !== 'ready'}
                    onClick={() =>
                      void run({
                        name: destination.label,
                        address: destination.address,
                        lat: destination.lat,
                        lon: destination.lon,
                        savedId: destination.id,
                      })
                    }
                  >
                    {destination.label}
                  </button>
                ))}
              </nav>
            )}
          </section>
        )}

        {view === 'result' && (
          <section className="result">
            <header className="result__head">
              <button type="button" className="link" onClick={() => setView('home')}>
                Back
              </button>
              <div className="result__trip">
                <span className="result__to">{target?.name}</span>
                <span className="result__from">
                  from {result?.origin.name ?? 'your location'}
                </span>
              </div>
            </header>

            {loading && <LoadingCard destination={target?.name ?? 'your destination'} />}

            {!loading && error && (
              <div className="card card--error">
                <AlertIcon className="card__error-icon" />
                <h2 className="card__headline">No recommendation available</h2>
                <p className="card__error-body">{error}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => target && void run(target)}
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && result && (
              <>
                {result.stale && (
                  <p className="notice notice--warn">
                    <AlertIcon />
                    <span>
                      Showing the last answer from{' '}
                      {new Date(result.generatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      . Live data is unreachable, so this may be outdated.
                    </span>
                  </p>
                )}

                <RecommendationCard result={result} />

                {savingLabel === null ? (
                  <div className="result__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => target && void run(target)}
                    >
                      Refresh
                    </button>
                    {!target?.savedId && (
                      <button
                        type="button"
                        className="button"
                        onClick={() => setSavingLabel(shortLabel(target?.name ?? ''))}
                      >
                        Save this place
                      </button>
                    )}
                  </div>
                ) : (
                  <form
                    className="save-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                  >
                    <input
                      className="save-row__input"
                      value={savingLabel}
                      onChange={(event) => setSavingLabel(event.target.value)}
                      placeholder="Home, Work, School..."
                      aria-label="Name for this saved place"
                      maxLength={40}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="button button--ghost button--compact"
                      onClick={() => setSavingLabel(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="button button--compact"
                      disabled={!savingLabel.trim()}
                    >
                      Save
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function LocationStatus({ location }: { location: ReturnType<typeof useGeolocation> }) {
  if (location.status === 'ready') {
    return (
      <p className="location location--ready">
        <span className="location__pulse" aria-hidden="true" />
        Using your current location
      </p>
    );
  }

  if (location.status === 'locating') {
    return <p className="location">Finding your location...</p>;
  }

  return (
    <p className="location location--error">
      {location.error}{' '}
      <button type="button" className="link" onClick={location.retry}>
        Retry
      </button>
    </p>
  );
}

function LoadingCard({ destination }: { destination: string }) {
  return (
    <div className="card card--loading" role="status" aria-live="polite">
      <ClockIcon className="card__loading-icon" />
      <h2 className="card__headline">Reading the road to {destination}</h2>
      <ol className="steps">
        <li className="steps__item">Routing and live traffic</li>
        <li className="steps__item steps__item--delay-1">Weather along the route</li>
        <li className="steps__item steps__item--delay-2">Gemma 4 deciding</li>
      </ol>
    </div>
  );
}

/** "Kotoka International Airport" is a poor chip label; "Kotoka" is a good one. */
function shortLabel(name: string): string {
  return name.split(',')[0].split(' ').slice(0, 2).join(' ');
}
