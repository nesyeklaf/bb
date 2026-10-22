export const round = (value, digits = 2) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

export const summarize = (values, digits = 2) => {
  const finite = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0)
    return {
      n: 0,
      min: null,
      p50: null,
      p95: null,
      p99: null,
      max: null,
      mean: null,
    };
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    n: finite.length,
    min: round(Math.min(...finite), digits),
    p50: round(percentile(finite, 0.5), digits),
    p95: round(percentile(finite, 0.95), digits),
    p99: round(percentile(finite, 0.99), digits),
    max: round(Math.max(...finite), digits),
    mean: round(sum / finite.length, digits),
  };
};

export const shareOver = (values, threshold) => {
  if (values.length === 0) return null;
  return round(
    values.filter((value) => value > threshold).length / values.length,
    4,
  );
};

export const spread = (values, digits = 2) => {
  const finite = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0)
    return { n: 0, min: null, max: null, mean: null, relativeSpread: null };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean =
    finite.reduce((total, value) => total + value, 0) / finite.length;
  return {
    n: finite.length,
    min: round(min, digits),
    max: round(max, digits),
    mean: round(mean, digits),
    relativeSpread: mean === 0 ? null : round((max - min) / mean, 3),
  };
};

export class ValidityLedger {
  constructor() {
    this.checks = [];
  }

  record(name, passed, detail) {
    this.checks.push({ name, passed: Boolean(passed), detail });
    return Boolean(passed);
  }

  get failures() {
    return this.checks.filter((check) => !check.passed);
  }

  get valid() {
    return this.failures.length === 0;
  }

  assertValid() {
    if (this.valid) return;
    const lines = this.failures.map(
      (check) => "  - " + check.name + ": " + JSON.stringify(check.detail),
    );
    throw new Error("Measurement is not valid:\n" + lines.join("\n"));
  }
}
