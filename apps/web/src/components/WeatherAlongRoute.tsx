import { RainIcon, SunIcon } from './icons';
import type { RouteWeather } from '../lib/types';

interface Props {
  weather: RouteWeather;
}

/**
 * The evidence for Move's central claim: weather is a property of the route,
 * not of a single pin. Each row is a real forecast lookup at that point, at
 * the time the traveller would reach it.
 */
export function WeatherAlongRoute({ weather }: Props) {
  if (weather.samples.length === 0) {
    return (
      <div className="why__block">
        <h3 className="why__title">Weather along the route</h3>
        <p className="why__line why__line--muted">{weather.summary}</p>
      </div>
    );
  }

  return (
    <div className="why__block">
      <h3 className="why__title">Weather along the route</h3>

      <ol className="route-weather">
        {weather.samples.map((sample) => (
          <li key={`${sample.label}-${sample.lat}-${sample.lon}`} className="route-weather__row">
            <span className="route-weather__marker" aria-hidden="true">
              <span className={`route-weather__dot${sample.wet ? ' is-wet' : ''}`} />
            </span>

            <span className="route-weather__where">
              <strong>{sample.label}</strong>
              <span className="route-weather__when">
                {sample.minutesFromNow <= 0 ? 'now' : `in ${sample.minutesFromNow} min`}
              </span>
            </span>

            <span className="route-weather__condition">
              {sample.wet ? <RainIcon /> : <SunIcon />}
              {sample.condition}
            </span>

            <span className="route-weather__numbers">
              {sample.temperatureC !== null && (
                <span className="route-weather__temp">{Math.round(sample.temperatureC)}&deg;</span>
              )}
              {sample.precipitationProbabilityAtArrivalPct !== null && (
                <span className={`route-weather__rain${sample.wet ? ' is-wet' : ''}`}>
                  {sample.precipitationProbabilityAtArrivalPct}%
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {weather.rainStartsInMinutes !== null && (
        <p className="why__line why__line--muted">
          Rain first expected in {weather.rainStartsInMinutes} min
          {weather.rainClearsInMinutes !== null &&
            `, clearing by around ${weather.rainClearsInMinutes} min from now`}
          .
        </p>
      )}
    </div>
  );
}
