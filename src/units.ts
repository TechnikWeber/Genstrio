// Lengths are stored and built in millimetres; this only changes how they are shown and typed.

export type Unit = 'mm' | 'cm' | 'in';
export const UNITS: Unit[] = ['mm', 'cm', 'in'];

const PER_UNIT: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4 };
const DECIMALS: Record<Unit, number> = { mm: 3, cm: 3, in: 3 };

let unit: Unit = 'mm';

export const getUnit = () => unit;
export const setUnit = (next: Unit) => {
  unit = next;
};

const round = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;

/** A length in mm, in the chosen unit. */
export const toUnit = (mm: number) => round(mm / PER_UNIT[unit], DECIMALS[unit]);

/** A length typed in the chosen unit, in mm. */
export const fromUnit = (value: number) => round(value * PER_UNIT[unit], 4);

/** Step of a number input whose step is `mm` in millimetres. */
export function unitStep(mm: number): number {
  if (unit === 'mm') return mm;
  if (unit === 'cm') return round(mm / 10, 4);
  return mm >= 1 ? 0.05 : mm >= 0.5 ? 0.02 : 0.005;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Inches the way a ruler reads: "3 1/2" when the value is a 64th, decimals otherwise. */
function formatInches(inches: number): string {
  const n = Math.round(Math.abs(inches) * 64);
  if (Math.abs(Math.abs(inches) - n / 64) > 5e-4) return String(round(inches, 3));
  const whole = Math.floor(n / 64);
  const rest = n % 64;
  const d = gcd(rest, 64);
  const text = rest ? `${whole ? `${whole} ` : ''}${rest / d}/${64 / d}` : String(whole);
  return inches < 0 && n ? `-${text}` : text;
}

/** Inches as typed: "3.5", "3 1/2", "3-1/2" or "7/16". NaN if it is none of these. */
function parseInches(text: string): number {
  const m = /^\s*(-)?\s*(?:(\d+(?:[.,]\d*)?|[.,]\d+)|(?:(\d+)[\s-]+)?(\d+)\s*\/\s*(\d+))\s*(?:″|"|in)?\s*$/.exec(text);
  if (!m) return NaN;
  const value = m[2] !== undefined ? Number(m[2].replace(',', '.')) : Number(m[3] ?? 0) + Number(m[4]) / Number(m[5]);
  return m[1] ? -value : value;
}

/** A length in mm as the text of an input field. */
export const formatLength = (mm: number) => (unit === 'in' ? formatInches(mm / 25.4) : String(toUnit(mm)));

/** The text of an input field as a length in mm; NaN if it cannot be read. */
export const parseLength = (text: string) => (unit === 'in' ? round(parseInches(text) * 25.4, 4) : fromUnit(Number(text.replace(',', '.'))));
