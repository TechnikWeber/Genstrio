// Mounting hole patterns of common boards, shared by the UI and the builders.
// Coordinates in mm from the lower left corner, the board's long edge along X.

export interface Board {
  length: number;
  width: number;
  holes: [number, number][];
}

const corners = (length: number, width: number, inset: number): [number, number][] => [
  [inset, inset],
  [length - inset, inset],
  [inset, width - inset],
  [length - inset, width - inset],
];

export const BOARDS: Record<string, Board> = {
  // Raspberry Pi 2/3/4/5 and the many boards that copy their footprint
  rpi: { length: 85, width: 56, holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]] },
  rpizero: { length: 65, width: 30, holes: corners(65, 30, 3.5) },
  pico: { length: 51, width: 21, holes: [[2, 4.8], [2, 16.2], [49, 4.8], [49, 16.2]] },
  uno: { length: 68.6, width: 53.4, holes: [[14, 2.5], [15.3, 50.7], [66.1, 7.6], [66.1, 35.5]] },
  mega: { length: 101.6, width: 53.4, holes: [[14, 2.5], [15.3, 50.7], [66.1, 7.6], [66.1, 35.5], [90.2, 50.7], [96.5, 2.5]] },
  feather: { length: 50.8, width: 22.86, holes: corners(50.8, 22.86, 2.54) },
  beaglebone: { length: 86.4, width: 54.6, holes: [[14.6, 3.2], [14.6, 51.4], [80.6, 6.35], [80.6, 48.25]] },
  // DOIT ESP32 DevKit V1, 30 pins. Clones differ by a few tenths.
  esp32devkit: { length: 51.5, width: 28.2, holes: corners(51.5, 28.2, 2.4) },
};
