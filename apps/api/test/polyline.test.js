const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { encodePolyline, simplify } = require('../dist/map/polyline');
const { sliceByFractions } = require('../dist/common/geo.util');

describe('encodePolyline', () => {
  it('matches the reference vector from the polyline spec', () => {
    // The canonical example, given as [lon, lat] because that is GeoJSON order.
    const points = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ];
    assert.equal(encodePolyline(points), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('encodes an empty path as an empty string', () => {
    assert.equal(encodePolyline([]), '');
  });

  it('produces a short string for a realistic Accra route', () => {
    const points = Array.from({ length: 30 }, (_, i) => [-0.1969 + i * 0.001, 5.556 + i * 0.002]);
    // Roughly six characters per point; the URL budget is 7000.
    assert.ok(encodePolyline(points).length < 300);
  });
});

describe('simplify', () => {
  it('leaves short paths untouched', () => {
    const points = [
      [0, 0],
      [1, 1],
    ];
    assert.deepEqual(simplify(points, 0.001), points);
  });

  it('drops points that sit on a straight line', () => {
    const straight = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    assert.deepEqual(simplify(straight, 0.0001), [
      [0, 0],
      [4, 0],
    ]);
  });

  it('keeps a genuine corner', () => {
    const corner = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 5],
    ];
    const result = simplify(corner, 0.0001);
    assert.ok(result.some(([x, y]) => x === 2 && y === 0), 'the turn must survive');
  });

  it('always keeps the first and last point', () => {
    const wiggly = Array.from({ length: 50 }, (_, i) => [i, Math.sin(i) * 0.00001]);
    const result = simplify(wiggly, 0.01);
    assert.deepEqual(result[0], wiggly[0]);
    assert.deepEqual(result[result.length - 1], wiggly[wiggly.length - 1]);
  });
});

describe('sliceByFractions', () => {
  // A straight 4-unit line makes the arithmetic checkable by eye.
  const line = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ];

  it('returns one slice per gap between fractions', () => {
    assert.equal(sliceByFractions(line, [0, 0.5, 1]).length, 2);
    assert.equal(sliceByFractions(line, [0, 1 / 3, 2 / 3, 1]).length, 3);
  });

  it('starts at the origin and ends at the destination', () => {
    const slices = sliceByFractions(line, [0, 0.5, 1]);
    assert.deepEqual(slices[0][0], [0, 0]);
    assert.deepEqual(slices[slices.length - 1].at(-1), [4, 0]);
  });

  it('joins slices end to end so the drawn line has no gaps', () => {
    const slices = sliceByFractions(line, [0, 0.5, 1]);
    // The end of one slice must be exactly the start of the next.
    assert.deepEqual(slices[0].at(-1), slices[1][0]);
  });

  it('cuts at the halfway point by distance', () => {
    const [first] = sliceByFractions(line, [0, 0.5, 1]);
    assert.deepEqual(first.at(-1), [2, 0]);
  });

  it('returns nothing for a degenerate route', () => {
    assert.deepEqual(sliceByFractions([[1, 1]], [0, 1]), []);
    assert.deepEqual(
      sliceByFractions(
        [
          [1, 1],
          [1, 1],
        ],
        [0, 1],
      ),
      [],
    );
  });
});
