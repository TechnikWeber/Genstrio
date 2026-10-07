import { draw, drawCircle, drawPolysides, type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { ParamError, prism, regionsSolid, round1, roundedRect, type Build, type Part } from './common';
import type { Pt } from './trace';

export interface GearParams {
  kind: 'spur' | 'rack' | 'ring' | 'planetary';
  module: number;
  teeth: number;
  teeth2: number;
  pressureAngle: '14.5' | '20' | '25';
  thickness: number;
  helix: number;
  herringbone: boolean;
  backlash: number;
  bore: 'none' | 'round' | 'd' | 'hex' | 'square';
  boreDiameter: number;
  boreFlat: number;
  hubDiameter: number;
  hubHeight: number;
  rackTeeth: number;
  rackHeight: number;
  rim: number;
  planetTeeth: number;
  planets: number;
  carrier: boolean;
  pinDiameter: number;
}

const DEDENDUM = 1.25;
// Below this many teeth the root is undercut and the tooth weakened.
const UNDERCUT = { '14.5': 32, '20': 17, '25': 12 };

interface Geometry {
  pitch: number;
  base: number;
  tip: number;
  root: number;
}

/** How far the teeth reach above and below the pitch circle, in modules, and how much thinner than half the pitch they are. */
interface Profile {
  addendum: number;
  dedendum: number;
  backlash: number;
}

/** The radii of a gear with z teeth of module m. */
export function gearRadii(m: number, z: number, alpha: number, addendum = 1, dedendum = DEDENDUM): Geometry {
  const pitch = (m * z) / 2;
  return { pitch, base: pitch * Math.cos(alpha), tip: pitch + addendum * m, root: Math.max(pitch - dedendum * m, 0.2 * m) };
}

/**
 * The outline of an involute gear, counter-clockwise, as corner points with
 * the arcs between them: one tooth is two flanks, a tip arc and a root arc.
 * A tooth is centred on the +X axis.
 */
function gearDrawing(m: number, z: number, alpha: number, { addendum, dedendum, backlash }: Profile, turn: number, coarse = false): { drawing: Drawing; tip: number } {
  const { pitch, base, tip: fullTip, root } = gearRadii(m, z, alpha, addendum, dedendum);
  const inv = (a: number) => Math.tan(a) - a;
  // Half the angle a tooth spans at radius r
  const half = (r: number) => (Math.PI * m / 2 - backlash) / (2 * pitch) + inv(alpha) - (r > base ? inv(Math.acos(base / r)) : 0);
  // Few teeth at a steep angle would come to a point before the full height: stop where a land is left.
  let tip = fullTip;
  for (let i = 0; i < 40 && half(tip) * tip < 0.1 * m; i++) tip -= 0.02 * m;
  const start = Math.max(base, root);
  const steps = coarse || z > 80 ? 3 : z > 40 ? 4 : 6;
  // Evenly spaced along the roll of the involute, which puts more points where it curves most.
  const roll = (r: number) => Math.sqrt(Math.max(0, (r / base) ** 2 - 1));
  const radii = Array.from({ length: steps + 1 }, (_, k) => base * Math.hypot(1, roll(start) + ((roll(tip) - roll(start)) * k) / steps));
  radii[0] = start;
  radii[steps] = tip;
  if (root < start - 1e-6) radii.unshift(root);
  const polar = (r: number, a: number): Pt => [r * Math.cos(a + turn), r * Math.sin(a + turn)];

  let pen = draw(polar(root, -half(root)));
  for (let i = 0; i < z; i++) {
    const centre = (2 * Math.PI * i) / z;
    for (const r of radii.slice(1)) pen = pen.lineTo(polar(r, centre - half(r)));
    pen = pen.threePointsArcTo(polar(tip, centre + half(tip)), polar(tip, centre));
    for (const r of [...radii].reverse().slice(1)) pen = pen.lineTo(polar(r, centre + half(r)));
    const next = centre + (2 * Math.PI) / z;
    if (i < z - 1) pen = pen.threePointsArcTo(polar(root, next - half(root)), polar(root, centre + Math.PI / z));
    else return { drawing: pen.threePointsArcTo(polar(root, -half(root)), polar(root, centre + Math.PI / z)).done(), tip };
  }
  throw new ParamError('err.generic');
}

function boreDrawing(p: GearParams): Drawing | null {
  const d = p.boreDiameter;
  if (p.bore === 'none') return null;
  if (p.bore === 'hex') return drawPolysides(d / Math.sqrt(3), 6);
  if (p.bore === 'square') return roundedRect(d, d, 0);
  const circle = drawCircle(d / 2);
  if (p.bore !== 'd') return circle;
  const flat = Math.min(p.boreFlat, d * 0.45);
  return circle.intersect(roundedRect(2 * d, 2 * d, 0).translate(0, -d / 2 - flat));
}

/**
 * The toothed body of a gear standing on z = 0, its teeth twisting by `twist`
 * degrees over its height. `extend` lets it stick out at both ends, teeth
 * carrying on, for cutting it out of something.
 */
function teeth(p: GearParams, z: number, turn: number, twist: number, profile: Profile, extend = 0): { shape: Shape3D; tip: number } {
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const h = p.thickness;
  const sketch = (angle: number, at: number, coarse = false) => gearDrawing(p.module, z, alpha, profile, turn + (angle * Math.PI) / 180, coarse).drawing.sketchOnPlane('XY', at) as Sketch;
  const { tip } = gearDrawing(p.module, z, alpha, profile, turn);
  const rate = twist / h;
  let shape: Shape3D;
  if (Math.abs(twist) < 1e-6) {
    shape = sketch(0, -extend).extrude(h + 2 * extend) as Shape3D;
  } else if (!p.herringbone) {
    shape = sketch(-rate * extend, -extend).extrude(h + 2 * extend, { twistAngle: rate * (h + 2 * extend) }) as Shape3D;
  } else {
    // Two twisted halves cannot be fused reliably where they meet, so the V is
    // one skin over outlines turned a few degrees at a time, up and back again.
    const steps = Math.max(2, Math.ceil(Math.abs(twist) / 2 / 6));
    const sections = Array.from({ length: 2 * steps + 1 }, (_, k) => {
      const at = k === 0 ? -extend : k === 2 * steps ? h + extend : (h * k) / (2 * steps);
      return sketch((twist / 2) * (1 - Math.abs(at - h / 2) / (h / 2)), at, true);
    });
    shape = sections[0].loftWith(sections.slice(1), { ruled: true }) as Shape3D;
  }
  return { shape, tip };
}

const external = (p: GearParams): Profile => ({ addendum: 1, dedendum: DEDENDUM, backlash: p.backlash });

/** A gear with hub and bore. */
function gearSolid(p: GearParams, z: number, turn: number, twist: number, bore: Drawing | null = boreDrawing(p), hub = true): { shape: Shape3D; tip: number } {
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const h = p.thickness;
  let { shape, tip } = teeth(p, z, turn, twist, external(p));
  const { root } = gearRadii(p.module, z, alpha);
  const hubHeight = hub ? p.hubHeight : 0;
  if (hubHeight > 0) shape = shape.fuse(prism(drawCircle(Math.min(p.hubDiameter / 2, root)), hubHeight + 0.2, h - 0.2)) as Shape3D;
  if (bore) shape = shape.cut(prism(bore, h + hubHeight + 2, -1)) as Shape3D;
  return { shape, tip };
}

/**
 * A ring with teeth on the inside. The gaps between its teeth are the teeth
 * of an ordinary gear with as many teeth, reaching out as far as the ring's
 * own teeth reach in; so that gear, cut out of a disc, leaves the ring.
 */
function ringSolid(p: GearParams, z: number, turn: number, twist: number): { shape: Shape3D; outer: number } {
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const gaps = teeth(p, z, turn, twist, { addendum: DEDENDUM, dedendum: 1, backlash: -p.backlash }, 1);
  const outer = gearRadii(p.module, z, alpha, DEDENDUM, 1).tip + p.rim;
  return { shape: prism(drawCircle(outer), p.thickness).cut(gaps.shape) as Shape3D, outer };
}

function* buildPlanetary(p: GearParams): Build {
  const m = p.module;
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const [zs, zp, n] = [p.teeth, p.planetTeeth, p.planets];
  const zr = zs + 2 * zp;
  // Evenly spaced planets only fit if sun and ring together have a multiple of their number in teeth …
  if ((zs + zr) % n !== 0) throw new ParamError('err.planetSpacing');
  // … and if neighbours leave each other room.
  if ((zs + zp) * Math.sin(Math.PI / n) < zp + 2.2) throw new ParamError('err.planetCrowd');
  const sunR = gearRadii(m, zs, alpha);
  const planetR = gearRadii(m, zp, alpha);
  const pin = p.carrier ? p.pinDiameter : 0;
  if (pin / 2 > planetR.root - 1) throw new ParamError('err.gearBore');
  const twistOf = (pitch: number) => ((p.thickness * Math.tan((p.helix * Math.PI) / 180)) / pitch) * (180 / Math.PI);
  const orbit = sunR.pitch + planetR.pitch;

  const sun = gearSolid(p, zs, 0, twistOf(sunR.pitch));
  const parts: Part[] = [];
  yield { label: 'stage.sun', parts: [{ name: 'sun', shape: sun.shape }] };
  // A planet turns against the sun, and the ring is cut with the hand of the planets.
  const planet = gearSolid(p, zp, 0, -twistOf(planetR.pitch), pin > 0 ? drawCircle(pin / 2 + 0.2) : null, false);
  yield { label: 'stage.planets', parts: [{ name: 'sun', shape: sun.shape }, { name: 'planet', shape: planet.shape }] };
  // With an even number of teeth a planet shows a gap where the first one faces the ring, so the ring needs a tooth there.
  const ring = ringSolid(p, zr, zp % 2 === 0 ? Math.PI / zr : 0, -twistOf((m * zr) / 2));

  const step = 2 * planet.tip + 3;
  const sunAt: [number, number, number] = [0, -(planet.tip + sun.tip + 3), 0];
  const ringAt: [number, number, number] = [0, planet.tip + ring.outer + 3, 0];
  const toothStep = (2 * Math.PI) / zs;
  parts.push(
    { name: 'sun', shape: sun.shape.translate(sunAt) as Shape3D, assembled: { flip: false, offset: [0, -sunAt[1], 0] } },
    {
      name: 'planet',
      shape: planet.shape,
      instances: Array.from({ length: n }, (_, k) => [k * step, 0, 0]),
      assembled: {
        flip: false,
        offset: [0, 0, 0],
        places: Array.from({ length: n }, (_, k) => {
          const at = (2 * Math.PI * k) / n;
          // Where the sun's nearest tooth is off this direction, the planet has rolled on by as much.
          const off = at % toothStep;
          const turn = at + Math.PI + (off * zs) / zp + Math.PI / zp;
          return [orbit * Math.cos(at), orbit * Math.sin(at), 0, (turn * 180) / Math.PI];
        }),
      },
    },
    { name: 'ring', shape: ring.shape.translate(ringAt) as Shape3D, assembled: { flip: false, offset: [0, -ringAt[1], 0] } },
  );
  if (p.carrier) {
    const plate = 3;
    const radius = orbit + pin / 2 + 3;
    let carrier = prism(drawCircle(radius), plate);
    for (let k = 0; k < n; k++) {
      const at = (2 * Math.PI * k) / n;
      carrier = carrier.fuse(prism(drawCircle(pin / 2).translate(orbit * Math.cos(at), orbit * Math.sin(at)), p.thickness + 0.2, plate - 0.2)) as Shape3D;
    }
    const hole = boreDrawing(p);
    if (hole) carrier = carrier.cut(prism(hole, plate + 2, -1)) as Shape3D;
    const at: [number, number, number] = [0, sunAt[1] - sun.tip - radius - 3, 0];
    parts.push({ name: 'carrier', shape: carrier.translate(at) as Shape3D, assembled: { flip: false, offset: [0, -at[1], -plate] } });
  }
  const notes: Note[] = [
    { level: 'info', key: 'note.planetary', vars: { r: zr, d: round1(2 * ring.outer), i: Math.round((1 + zr / zs) * 1000) / 1000 } },
    { level: 'info', key: 'note.planetPrint', vars: { n } },
  ];
  if (p.backlash < 0.05) notes.push({ level: 'info', key: 'note.gearBacklash' });
  return { parts, notes };
}

function buildRack(p: GearParams): { part: Part; notes: Note[] } {
  const m = p.module;
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const pitch = Math.PI * m;
  const length = p.rackTeeth * pitch;
  const foot = -DEDENDUM * m;
  const halfWidth = (y: number) => pitch / 4 - p.backlash / 2 - y * Math.tan(alpha);
  if (halfWidth(m) < 0.05) throw new ParamError('err.gearPointed');
  const outer: Pt[] = [[-length / 2, foot - p.rackHeight], [length / 2, foot - p.rackHeight], [length / 2, foot]];
  for (let i = p.rackTeeth - 1; i >= 0; i--) {
    const x = -length / 2 + (i + 0.5) * pitch;
    outer.push([x + halfWidth(foot), foot], [x + halfWidth(m), m], [x - halfWidth(m), m], [x - halfWidth(foot), foot]);
  }
  outer.push([-length / 2, foot]);
  return {
    part: { name: 'rack', shape: regionsSolid([{ outer, holes: [] }], p.thickness) },
    notes: [{ level: 'info', key: 'note.rackSize', vars: { l: round1(length), p: Math.round(pitch * 100) / 100, h: round1(p.rackHeight + (1 + DEDENDUM) * m) } }],
  };
}

export function* buildGear(p: GearParams): Build {
  if (p.kind === 'rack') {
    const { part, notes } = buildRack(p);
    return { parts: [part], notes };
  }
  if (p.kind === 'planetary') return yield* buildPlanetary(p);
  const m = p.module;
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const notes: Note[] = [];
  if (p.kind === 'ring') {
    const twist = ((p.thickness * Math.tan((p.helix * Math.PI) / 180)) / ((m * p.teeth) / 2)) * (180 / Math.PI);
    const ring = ringSolid(p, p.teeth, 0, twist);
    notes.push({ level: 'info', key: 'note.ringSize', vars: { d: round1(m * p.teeth), i: round1(m * p.teeth - 2 * m), o: round1(2 * ring.outer) } });
    return { parts: [{ name: 'ring', shape: ring.shape }], notes };
  }
  const radii = gearRadii(m, p.teeth, alpha);
  const boreSize = p.bore === 'none' ? 0 : p.bore === 'hex' ? p.boreDiameter / Math.sqrt(3) : p.bore === 'square' ? p.boreDiameter / Math.SQRT2 : p.boreDiameter / 2;
  const smallest = Math.min(p.teeth, p.teeth2 > 0 ? p.teeth2 : p.teeth);
  if (boreSize > gearRadii(m, smallest, alpha).root - 0.8) throw new ParamError('err.gearBore');

  // The helix angle is measured at the pitch circle.
  const twistOf = (pitch: number) => ((p.thickness * Math.tan((p.helix * Math.PI) / 180)) / pitch) * (180 / Math.PI);
  const first = gearSolid(p, p.teeth, 0, twistOf(radii.pitch));
  const parts: Part[] = [{ name: 'gear', shape: first.shape }];
  notes.push({ level: 'info', key: 'note.gearSize', vars: { d: round1(2 * radii.pitch), o: round1(2 * first.tip), r: round1(2 * radii.root) } });

  if (p.teeth2 > 0) {
    yield { label: 'stage.gear', parts: [...parts] };
    const other = gearRadii(m, p.teeth2, alpha);
    // The second gear turns the other way, with a gap where the first has a tooth.
    const second = gearSolid(p, p.teeth2, Math.PI - Math.PI / p.teeth2, -twistOf(other.pitch));
    const apart = first.tip + second.tip + 3;
    const distance = radii.pitch + other.pitch;
    parts[0].assembled = { flip: false, offset: [0, 0, 0] };
    parts.push({ name: 'gear2', shape: second.shape.translate([apart, 0, 0]) as Shape3D, assembled: { flip: false, offset: [distance - apart, 0, 0] } });
    notes.push({ level: 'info', key: 'note.gearPair', vars: { a: Math.round(distance * 100) / 100, d: round1(2 * other.pitch), i: Math.round((p.teeth2 / p.teeth) * 1000) / 1000 } });
  }
  if (p.backlash < 0.05) notes.push({ level: 'info', key: 'note.gearBacklash' });
  if (smallest < UNDERCUT[p.pressureAngle]) notes.push({ level: 'info', key: 'note.gearUndercut', vars: { n: UNDERCUT[p.pressureAngle] } });
  if (p.helix > 0 && !p.herringbone) notes.push({ level: 'info', key: 'note.gearHelix' });
  return { parts, notes };
}
