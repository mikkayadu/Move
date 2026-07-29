const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { parseAdvice, AdviceParseError } = require('../dist/recommendation/advice.parser');

/**
 * These run against the compiled output, so they exercise exactly the code the
 * server loads. The parser is the riskiest component in the system: everything
 * downstream of it is deterministic, and everything upstream is an open-weight
 * model that will occasionally wrap its answer in prose.
 */

const VALID = {
  recommendation: 'leave_now',
  leave_by_time: null,
  wait_minutes: null,
  best_mode: 'driving',
  headline: 'Leave now, the road is clear.',
  reasoning: 'Traffic is at typical levels and no rain is forecast on the route.',
  advisory: null,
};

describe('parseAdvice - packaging tolerance', () => {
  it('accepts a clean JSON object', () => {
    const advice = parseAdvice(JSON.stringify(VALID));
    assert.equal(advice.recommendation, 'leave_now');
    assert.equal(advice.headline, 'Leave now, the road is clear.');
  });

  it('strips markdown code fences', () => {
    const advice = parseAdvice('```json\n' + JSON.stringify(VALID) + '\n```');
    assert.equal(advice.recommendation, 'leave_now');
  });

  it('digs the object out of surrounding prose', () => {
    const raw = `Sure! Here is the JSON you asked for:\n\n${JSON.stringify(VALID)}\n\nLet me know if you need anything else.`;
    assert.equal(parseAdvice(raw).best_mode, 'driving');
  });

  it('does not stop at a brace inside a string value', () => {
    const tricky = { ...VALID, headline: 'Leave now {right now} before the rain.' };
    assert.equal(
      parseAdvice(JSON.stringify(tricky)).headline,
      'Leave now {right now} before the rain.',
    );
  });

  it('rejects output with no usable headline', () => {
    assert.throws(() => parseAdvice(JSON.stringify({ ...VALID, headline: '' })), AdviceParseError);
  });

  // The served Gemma 4 variants cannot have thinking disabled and emit their
  // reasoning into the response body, so a real reply is prose containing
  // draft objects, followed by the actual answer.
  it('takes the final object when the model thinks out loud first', () => {
    const raw = [
      '*   Weighing the options:',
      '    *   Driving is faster than walking here.',
      '    *   Draft: ```json',
      JSON.stringify({ ...VALID, headline: 'DRAFT - do not use' }),
      '    ```',
      '*   Refining the answer:',
      JSON.stringify({ ...VALID, headline: 'Leave now, the road is clear.' }),
    ].join('\n');

    assert.equal(parseAdvice(raw).headline, 'Leave now, the road is clear.');
  });

  it('falls back to the last complete draft when the answer is truncated', () => {
    const raw = [
      'Thinking...',
      JSON.stringify({ ...VALID, headline: 'Recoverable draft.' }),
      'Final answer:',
      '{"recommendation":"leave_now","headline":"cut off mid-str',
    ].join('\n');

    assert.equal(parseAdvice(raw).headline, 'Recoverable draft.');
  });

  it('ignores objects that parse but carry no headline', () => {
    const raw = [
      '{"note":"scratch work, no headline here"}',
      JSON.stringify(VALID),
      '{"trailing":"also no headline"}',
    ].join('\n');

    assert.equal(parseAdvice(raw).headline, 'Leave now, the road is clear.');
  });

  it('rejects output that is not JSON at all', () => {
    assert.throws(() => parseAdvice('I cannot help with that.'), AdviceParseError);
  });
});

describe('parseAdvice - field coercion', () => {
  it('reads a wait time written as prose', () => {
    const advice = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'wait', wait_minutes: 'about 20 minutes' }),
    );
    assert.equal(advice.recommendation, 'wait');
    assert.equal(advice.wait_minutes, 20);
  });

  it('normalises enum casing and spacing', () => {
    const advice = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'Leave Now', best_mode: 'WALKING' }),
    );
    assert.equal(advice.recommendation, 'leave_now');
    assert.equal(advice.best_mode, 'walking');
  });

  it('converts a 12-hour departure time to 24-hour', () => {
    const advice = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'leave_by', leave_by_time: '5:40 PM' }),
    );
    assert.equal(advice.leave_by_time, '17:40');
  });

  it('keeps midnight and noon the right way round', () => {
    const midnight = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'leave_by', leave_by_time: '12:15 AM' }),
    );
    assert.equal(midnight.leave_by_time, '00:15');

    const noon = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'leave_by', leave_by_time: '12:15 PM' }),
    );
    assert.equal(noon.leave_by_time, '12:15');
  });

  it('treats the string "null" as an absent advisory', () => {
    const advice = parseAdvice(JSON.stringify({ ...VALID, advisory: 'null' }));
    assert.equal(advice.advisory, null);
  });

  it('falls back to a sane mode when the model invents one', () => {
    const advice = parseAdvice(JSON.stringify({ ...VALID, best_mode: 'teleport' }));
    assert.equal(advice.best_mode, 'driving');
  });
});

describe('parseAdvice - contradiction repair', () => {
  it('downgrades a wait with no duration to leave now', () => {
    const advice = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'wait', wait_minutes: null }),
    );
    assert.equal(advice.recommendation, 'leave_now');
    assert.equal(advice.wait_minutes, null);
  });

  it('downgrades a leave_by with no time to leave now', () => {
    const advice = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'leave_by', leave_by_time: null }),
    );
    assert.equal(advice.recommendation, 'leave_now');
  });

  it('clears stray timing fields on a leave_now', () => {
    const advice = parseAdvice(
      JSON.stringify({ ...VALID, wait_minutes: 15, leave_by_time: '17:40' }),
    );
    assert.equal(advice.recommendation, 'leave_now');
    assert.equal(advice.wait_minutes, null);
    assert.equal(advice.leave_by_time, null);
  });

  it('caps an absurd wait rather than showing it', () => {
    const advice = parseAdvice(
      JSON.stringify({ ...VALID, recommendation: 'wait', wait_minutes: 6000 }),
    );
    assert.equal(advice.wait_minutes, 120);
  });

  it('drops leave_by_time when the model says wait', () => {
    const advice = parseAdvice(
      JSON.stringify({
        ...VALID,
        recommendation: 'wait',
        wait_minutes: 10,
        leave_by_time: '17:40',
      }),
    );
    assert.equal(advice.leave_by_time, null);
  });
});
