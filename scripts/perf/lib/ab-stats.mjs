const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};

const resample = (values, random) =>
  values.map(() => values[Math.floor(random() * values.length)]);

const MIN_UNITS = 3;
export const MIN_ROUNDS = 5;

const comparison = (a, b, deltas) => {
  const medianA = median(a);
  const medianB = median(b);
  if (deltas === null || deltas.length === 0)
    return { a: medianA, b: medianB, delta: null, low: null, high: null };
  const delta = medianB - medianA;
  const low = quantile(deltas, 0.025);
  const high = quantile(deltas, 0.975);
  return {
    a: medianA,
    b: medianB,
    delta,
    relative: medianA === 0 ? null : delta / medianA,
    low,
    high,
    verdict: high < 0 ? "b faster" : low > 0 ? "b slower" : "no difference",
  };
};

export const compareMedians = (a, b, { iterations = 5000, seed = 1 } = {}) => {
  if (a.length < MIN_UNITS || b.length < MIN_UNITS)
    return comparison(a, b, null);
  const random = mulberry32(seed);
  const deltas = [];
  for (let index = 0; index < iterations; index += 1)
    deltas.push(median(resample(b, random)) - median(resample(a, random)));
  return comparison(a, b, deltas);
};

export const compareRounds = (rounds, { iterations = 5000, seed = 1 } = {}) => {
  const pooledA = rounds.flatMap((round) => round.a);
  const pooledB = rounds.flatMap((round) => round.b);
  const roundsWith = (variant) =>
    rounds.filter((round) => round[variant].length > 0).length;
  if (roundsWith("a") < MIN_ROUNDS || roundsWith("b") < MIN_ROUNDS)
    return comparison(pooledA, pooledB, null);
  const random = mulberry32(seed);
  const deltas = [];
  for (let index = 0; index < iterations; index += 1) {
    const drawn = resample(rounds, random);
    const drawnA = drawn.flatMap((round) => round.a);
    const drawnB = drawn.flatMap((round) => round.b);
    if (drawnA.length > 0 && drawnB.length > 0)
      deltas.push(median(drawnB) - median(drawnA));
  }
  return comparison(pooledA, pooledB, deltas);
};

export const abOrder = (round) =>
  round % 4 === 0 || round % 4 === 3 ? ["a", "b"] : ["b", "a"];
