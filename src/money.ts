// Money helpers. Amounts are integers in minor units; a currency's exponent
// is its number of decimal places (NGN 2, JPY 0, a custom unit 0..6).
// Nothing here uses floating point.

/**
 * Converts a decimal string to minor units: toMinor("100.50", 2) === 10050.
 * Throws on more decimal places than the exponent allows or an unsafe integer.
 */
export function toMinor(amount: string, exponent: number): number {
  checkExponent(exponent);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(amount.trim().replace(/,/g, ""));
  if (!m) throw new RangeError(`not a decimal amount: ${JSON.stringify(amount)}`);
  const [, sign, whole = "0", frac = ""] = m;
  if (frac.length > exponent) throw new RangeError(`${amount} has more than ${exponent} decimal places`);
  const digits = (whole + frac.padEnd(exponent, "0")).replace(/^0+(?=\d)/, "");
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${amount} is too large to represent exactly`);
  return sign ? -n : n;
}

/** Formats minor units as a plain decimal string: formatMinor(10050, 2) === "100.50". */
export function formatMinor(minor: number, exponent: number): string {
  checkExponent(exponent);
  assertMinor(minor, "minor");
  const neg = minor < 0;
  let s = String(Math.abs(minor));
  if (exponent > 0) {
    s = s.padStart(exponent + 1, "0");
    s = `${s.slice(0, -exponent)}.${s.slice(-exponent)}`;
  }
  return neg ? `-${s}` : s;
}

/** Throws unless value is a safe integer, so amounts are never silently rounded. */
export function assertMinor(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be an integer number of minor units (got ${String(value)})`);
  }
}

function checkExponent(exponent: number) {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) throw new RangeError("exponent must be an integer from 0 to 6");
}
