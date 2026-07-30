import { useState } from 'react';
import { AlertIcon, CarIcon, ChevronIcon, WalkIcon } from './icons';
import { RouteMap } from './RouteMap';
import { WeatherAlongRoute } from './WeatherAlongRoute';
import type { ModeSummary, RecommendationResult } from '../lib/types';

interface Props {
  result: RecommendationResult;
}

/**
 * The whole product in one card.
 *
 * Everything above the "Why this?" fold is the answer; everything below is the
 * evidence. That split is deliberate - a user who trusts the app never has to
 * read the data, and a user who does not can audit every number behind it.
 */
export function RecommendationCard({ result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { advice } = result;

  const chosen = advice.best_mode === 'walking' ? result.walking : result.driving;
  const alternative = advice.best_mode === 'walking' ? result.driving : result.walking;

  return (
    <article className={`card card--${advice.recommendation}`}>
      <header className="card__top">
        <span className="card__action">
          <span className="card__dot" aria-hidden="true" />
          {actionLabel(result)}
        </span>
        <span className="card__mode">
          {advice.best_mode === 'walking' ? <WalkIcon /> : <CarIcon />}
          {advice.best_mode === 'walking' ? 'Walk' : 'Drive'}
        </span>
      </header>

      <h2 className="card__headline">{advice.headline}</h2>

      <dl className="stats">
        <Stat label="ETA" value={chosen ? `${chosen.etaMinutes} min` : '--'} />
        <Stat label="vs typical" value={trafficLabel(chosen)} tone={trafficTone(chosen)} />
        <Stat label="Distance" value={chosen ? `${chosen.distanceKm} km` : '--'} />
      </dl>

      {advice.advisory && (
        <p className="advisory">
          <AlertIcon className="advisory__icon" />
          {advice.advisory}
        </p>
      )}

      <button
        type="button"
        className="disclosure"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        Why this?
        <ChevronIcon className={`disclosure__chevron${expanded ? ' is-open' : ''}`} />
      </button>

      {expanded && (
        <div className="why">
          <p className="why__reasoning">{advice.reasoning}</p>

          {result.mapUrl && <RouteMap mapUrl={result.mapUrl} weather={result.weather} />}

          <WeatherAlongRoute weather={result.weather} />

          {alternative && (
            <p className="why__line">
              {alternative.mode === 'walking' ? 'Walking' : 'Driving'} would take{' '}
              <strong>{alternative.etaMinutes} min</strong> ({alternative.distanceKm} km).
            </p>
          )}

          {result.futureDepartures.length > 0 && (
            <div className="why__block">
              <h3 className="why__title">If you left later</h3>
              <ul className="future">
                {result.futureDepartures.map((entry) => (
                  <li key={entry.offsetMinutes} className="future__row">
                    <span>in {entry.offsetMinutes} min</span>
                    <span className="future__eta">{entry.etaMinutes} min drive</span>
                    <span className={`future__delta${entry.deltaMinutes > 0 ? ' is-worse' : ''}`}>
                      {formatDelta(entry.deltaMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="why__meta">
            Reasoned by <strong>{result.model}</strong> at{' '}
            {new Date(result.generatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {!result.predictiveTrafficAvailable &&
              ' - predictive traffic unavailable, using live vs typical delay instead'}
            .
          </p>
        </div>
      )}
    </article>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className={`stat__value${tone ? ` stat__value--${tone}` : ''}`}>{value}</dd>
    </div>
  );
}

function actionLabel(result: RecommendationResult): string {
  const { advice } = result;

  if (advice.recommendation === 'wait' && advice.wait_minutes) {
    return `Wait ${advice.wait_minutes} min`;
  }
  if (advice.recommendation === 'leave_by' && advice.leave_by_time) {
    return `Leave by ${advice.leave_by_time}`;
  }
  return 'Leave now';
}

function trafficLabel(mode: ModeSummary | null): string {
  if (!mode || mode.trafficDelayMinutes === null) return 'normal';

  const delay = Math.round(mode.trafficDelayMinutes);
  if (delay <= 0) return 'clear';
  if (delay < 1) return 'normal';
  return `+${delay} min`;
}

function trafficTone(mode: ModeSummary | null): 'bad' | 'good' | undefined {
  if (!mode || mode.trafficDelayMinutes === null) return undefined;
  if (mode.trafficDelayMinutes >= 5) return 'bad';
  if (mode.trafficDelayMinutes <= 0) return 'good';
  return undefined;
}

function formatDelta(minutes: number): string {
  if (minutes === 0) return 'same';
  return minutes > 0 ? `${minutes} min worse` : `${Math.abs(minutes)} min better`;
}
