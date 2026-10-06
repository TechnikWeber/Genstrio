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
