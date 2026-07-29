import type { Advice, RecommendationKind } from './recommendation.types';
import type { TravelMode } from '../routing/routing.types';

export class AdviceParseError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = 'AdviceParseError';
  }
}

const KINDS: RecommendationKind[] = ['leave_now', 'wait', 'leave_by'];
const MODES: TravelMode[] = ['driving', 'walking'];

/**
 * Turns whatever the model actually emitted into a valid Advice object.
 *
 * Open-weight models are much better at content than at obeying "no code
 * fences", so this is written to be forgiving about packaging and strict about
 * meaning: we will dig a JSON object out of prose, coerce "15 minutes" into
 * 15, and repair contradictions such as recommendation "wait" with no wait
 * time - but we refuse anything without a usable headline, because a blank
 * card is worse than an error.
 */
export function parseAdvice(raw: string): Advice {
  const parsed = selectAnswerObject(raw);

  if (!parsed) {
    throw new AdviceParseError('Model output contained no usable JSON object', raw);
  }

  const headline = asText(parsed.headline);
  if (!headline) {
    throw new AdviceParseError('Model output had no headline', raw);
  }

  const recommendation = asEnum(parsed.recommendation, KINDS) ?? 'leave_now';
  const waitMinutes = asNumber(parsed.wait_minutes);
  const leaveByTime = asClockTime(parsed.leave_by_time);

  return repairContradictions({
    recommendation,
    wait_minutes: waitMinutes,
    leave_by_time: leaveByTime,
    best_mode: asEnum(parsed.best_mode, MODES) ?? 'driving',
    headline: trim(headline, 140),
    reasoning: trim(asText(parsed.reasoning) ?? headline, 600),
    advisory: (() => {
      const advisory = asText(parsed.advisory);
      return advisory ? trim(advisory, 160) : null;
    })(),
  });
}

/**
 * Keeps the three decision fields mutually consistent so the UI never has to
 * render "wait for null minutes".
 */
function repairContradictions(advice: Advice): Advice {
  if (advice.recommendation === 'wait') {
    // A wait with no duration is meaningless; treat it as leave now.
    if (advice.wait_minutes === null || advice.wait_minutes <= 0) {
      return { ...advice, recommendation: 'leave_now', wait_minutes: null, leave_by_time: null };
    }
    return { ...advice, wait_minutes: Math.min(advice.wait_minutes, 120), leave_by_time: null };
  }

  if (advice.recommendation === 'leave_by') {
    if (!advice.leave_by_time) {
      return { ...advice, recommendation: 'leave_now', wait_minutes: null, leave_by_time: null };
    }
    return { ...advice, wait_minutes: null };
  }

  return { ...advice, wait_minutes: null, leave_by_time: null };
}

/**
 * Chooses the object that is actually the answer.
 *
 * The served Gemma 4 variants have thinking permanently enabled and emit that
 * reasoning into the response body, so a reply is typically pages of prose
 * followed by the real JSON. The prose frequently contains draft objects and
 * fenced examples of its own, which means taking the *first* object returns a
 * discarded draft.
 *
 * So we collect every balanced top-level object and walk them backwards: the
 * model's final answer is its last one. Walking backwards also recovers the
 * last complete draft when the real answer was cut off mid-string by the token
 * limit, which beats failing outright.
 */
function selectAnswerObject(raw: string): Record<string, unknown> | null {
  const candidates = findBalancedObjects(raw);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(candidates[i]) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        // Drafts and the final answer both parse; only accept one that
        // carries the field the card cannot render without.
        if (asText(record.headline)) return record;
      }
    } catch {
      // A truncated or malformed candidate simply loses to an earlier one.
    }
  }

  return null;
}

/** Every balanced `{...}` span in the text, in the order they appear. */
function findBalancedObjects(raw: string): string[] {
  const found: string[] = [];

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        found.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return found;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return null;
  return text;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    // Handles "15", "15 minutes", "~20 min".
    const match = value.match(/-?\d+(\.\d+)?/);
    if (match) return Math.round(Number.parseFloat(match[0]));
  }
  return null;
}

/**
 * Normalises a clock time to 24-hour "HH:MM".
 *
 * The contract asks for 24-hour, but models trained largely on US English slip
 * into "5:40 PM" often enough that silently rendering it as 05:40 would show
 * the user a departure time twelve hours wrong.
 */
function asClockTime(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;

  const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return null;

  let hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const meridiem = match[3]?.toLowerCase();

  if (minutes > 59) return null;

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function asEnum<T extends string>(value: unknown, allowed: T[]): T | null {
  const text = asText(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.find((option) => option === text) ?? null;
}

function trim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}...` : clean;
}
