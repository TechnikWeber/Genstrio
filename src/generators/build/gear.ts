import { draw, drawCircle, drawPolysides, type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { ParamError, prism, regionsSolid, revolveZ, round1, roundedRect, type Build, type Part } from './common';
import type { Pt } from './trace';

export interface GearParams {
  kind: 'spur' | 'rack' | 'ring' | 'planetary' | 'bevel' | 'worm' | 'pulley';
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
  wormStarts: number;
  wormDiameter: number;
  wormLength: number;
  shaftAngle: number;
  beltWidth: number;
  flanges: 'none' | 'bottom' | 'both';
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
function gearDrawing(m: number, z: number, alpha: number, { addendum, dedendum, backlash }: Profile, turn: number, coarse = false, cone = 0): { drawing: Drawing; tip: number } {
  // The teeth of a bevel gear have the form of a larger gear, the one its
  // back cone unrolls to: by the cosine of the cone angle more teeth, drawn
  // in a plane that leans by that angle. Seen along the axis they are as much
  // lower, and each spans as much more of the circle.
  const lean = Math.cos(cone);
  const { pitch, base, tip: fullTip, root } = gearRadii(m, z / lean, alpha, addendum, dedendum);
  const inv = (a: number) => Math.tan(a) - a;
  // Half the angle a tooth spans at radius r
  const half = (r: number) => ((Math.PI * m / 2 - backlash) / (2 * pitch) + inv(alpha) - (r > base ? inv(Math.acos(base / r)) : 0)) / lean;
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
  // A point of that larger gear lies on the back cone, above or below the flat outline drawn here;
  // it is brought into the outline along its ray to the tip of the pitch cone.
  const flat = (m * z) / 2;
  const seen = (r: number) => {
    const rise = (r - pitch) * Math.sin(cone);
    // Tips lie towards the tip of the cone and so come out further; on a cone too flat they would never arrive.
    const left = flat - rise * Math.tan(cone);
    if (left < 0.35 * flat) throw new ParamError('err.bevelAngle');
    return ((flat + (r - pitch) * lean) * flat) / left;
  };
  const polar = (r: number, a: number): Pt => [seen(r) * Math.cos(a + turn), seen(r) * Math.sin(a + turn)];

  let pen = draw(polar(root, -half(root)));
  for (let i = 0; i < z; i++) {
    const centre = (2 * Math.PI * i) / z;
    for (const r of radii.slice(1)) pen = pen.lineTo(polar(r, centre - half(r)));
    pen = pen.threePointsArcTo(polar(tip, centre + half(tip)), polar(tip, centre));
    for (const r of [...radii].reverse().slice(1)) pen = pen.lineTo(polar(r, centre + half(r)));
    const next = centre + (2 * Math.PI) / z;
    if (i < z - 1) pen = pen.threePointsArcTo(polar(root, next - half(root)), polar(root, centre + Math.PI / z));
    else return { drawing: pen.threePointsArcTo(polar(root, -half(root)), polar(root, centre + Math.PI / z)).done(), tip: seen(tip) };
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

/**
 * A straight bevel gear standing on its large end. All its teeth run towards
 * one point on the axis, the tip of the pitch cone, so the outline at the top
 * is the one at the bottom, only smaller.
 */
function bevelSolid(p: GearParams, z: number, cone: number, turn: number): { shape: Shape3D; tip: number; apex: number; face: number } {
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const m = p.module;
  const pitch = (m * z) / 2;
  const distance = pitch / Math.sin(cone);
  const face = Math.min(p.thickness, distance * 0.4);
  const { drawing, tip } = gearDrawing(m, z, alpha, external(p), turn, false, cone);
  const top = drawing.scale(1 - face / distance, [0, 0]).sketchOnPlane('XY', face * Math.cos(cone)) as Sketch;
  let shape = (drawing.sketchOnPlane('XY', 0) as Sketch).loftWith(top, { ruled: true }) as Shape3D;
  const bore = boreDrawing(p);
  if (bore) shape = shape.cut(prism(bore, face + 2, -1)) as Shape3D;
  return { shape, tip, apex: pitch / Math.tan(cone), face };
}

function buildBevel(p: GearParams): { parts: Part[]; notes: Note[] } {
  const z2 = p.teeth2 > 0 ? p.teeth2 : p.teeth;
  // The two pitch cones share their tip and touch along a line, so their half angles add up to the angle between the axes.
  const shaft = ((p.shaftAngle ?? 90) * Math.PI) / 180;
  const cone = Math.atan(Math.sin(shaft) / (z2 / p.teeth + Math.cos(shaft)));
  // Past about 75° a cone is nearly a disc with teeth standing on it, which is another kind of gear.
  if (cone <= 0.05 || shaft - cone <= 0.05 || Math.max(cone, shaft - cone) > 1.32) throw new ParamError('err.bevelAngle');
  const first = bevelSolid(p, p.teeth, cone, Math.PI - Math.PI / p.teeth);
  const second = bevelSolid(p, z2, shaft - cone, 0);
  const apart = first.tip + second.tip + 3;
  const deg = (a: number) => round1((a * 180) / Math.PI);
  const notes: Note[] = [{ level: 'info', key: 'note.bevel', vars: { s: p.shaftAngle ?? 90, a: deg(cone), b: deg(shaft - cone), i: Math.round((z2 / p.teeth) * 1000) / 1000, h1: round1(first.apex), h2: round1(second.apex) } }];
  if (first.face < p.thickness - 0.01) notes.push({ level: 'info', key: 'note.bevelFace', vars: { b: round1(first.face) } });
  return {
    parts: [
      { name: 'gear', shape: first.shape, assembled: { flip: false, offset: [0, 0, 0] } },
      // Fitted, the second gear is tipped over by the angle between the axes, the tips of both cones in one point.
      {
        name: 'gear2',
        shape: second.shape.translate([apart, 0, 0]) as Shape3D,
        assembled: { flip: false, tilt: p.shaftAngle ?? 90, offset: [-second.apex * Math.sin(shaft) - apart * Math.cos(shaft), 0, first.apex - second.apex * Math.cos(shaft) + apart * Math.sin(shaft)] },
      },
    ],
    notes,
  };
}

// A GT2 belt: teeth every 2 mm, 0.75 mm high, its cords 0.254 mm outside the pulley.
const GT2 = { pitch: 2, offset: 0.254, depth: 0.8, round: 0.6, mouth: 0.74 };

/**
 * A pulley for a GT2 timing belt. Each groove is a round bottom that widens
 * towards the rim: close to the real profile, which is made of three arcs,
 * and with the play a printed pulley needs anyway.
 */
function buildPulley(p: GearParams): { parts: Part[]; notes: Note[] } {
  const n = p.teeth;
  const outer = (n * GT2.pitch) / Math.PI / 2 - GT2.offset;
  const bore = p.bore === 'none' ? 0 : p.boreDiameter / 2;
  if (outer - GT2.depth < bore + 1.2) throw new ParamError('err.gearBore');
  // Depth of the groove at a distance s from its middle, measured along the rim
  const centre = GT2.depth - GT2.round;
  const edge = Math.sqrt(GT2.round ** 2 - centre ** 2) * 0.92;
  const depthAt = (s: number) => {
    const a = Math.abs(s);
    if (a >= GT2.mouth) return 0;
    const round = centre + Math.sqrt(Math.max(0, GT2.round ** 2 - Math.min(a, edge) ** 2));
    return a <= edge ? round : (round * (GT2.mouth - a)) / (GT2.mouth - edge);
  };
  const outline: Pt[] = [];
  const steps = n > 30 ? 4 : 6;
  for (let k = 0; k < n; k++) {
    const at = (2 * Math.PI * k) / n;
    for (let i = -steps; i <= steps; i++) {
      const s = (GT2.mouth * i) / steps;
      const angle = at + s / outer;
      const r = outer - depthAt(s);
      outline.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    // The rim between two grooves, kept round by a point in its middle
    outline.push([outer * Math.cos(at + Math.PI / n), outer * Math.sin(at + Math.PI / n)]);
  }
  const belt = p.beltWidth + 1;
  const low = p.flanges === 'none' ? 0 : 1;
  const high = p.flanges === 'both' ? 1.5 : 0;
  // Reaching a little into each rim, where there is one
  const from = low ? low - 0.2 : 0;
  let shape = regionsSolid([{ outer: outline, holes: [] }], low + belt + (high ? 0.2 : 0) - from, from);
  // The rims that keep the belt on: the lower one flat on the bed, the upper one sloped so it prints without support.
  if (low) shape = shape.fuse(prism(drawCircle(outer + 1.2), low)) as Shape3D;
  if (high) shape = shape.fuse(revolveZ([[0, low + belt], [outer - 0.2, low + belt], [outer + 1.2, low + belt + high - 0.3], [outer + 1.2, low + belt + high], [0, low + belt + high]])) as Shape3D;
  const height = low + belt + high;
  if (p.hubHeight > 0) shape = shape.fuse(prism(drawCircle(Math.min(p.hubDiameter / 2, outer)), p.hubHeight + 0.2, height - 0.2)) as Shape3D;
  const hole = boreDrawing(p);
  if (hole) shape = shape.cut(prism(hole, height + p.hubHeight + 2, -1)) as Shape3D;
  return {
    parts: [{ name: 'pulley', shape }],
    notes: [
      { level: 'info', key: 'note.pulley', vars: { n, d: Math.round(((n * GT2.pitch) / Math.PI) * 100) / 100, o: Math.round(2 * outer * 100) / 100, w: p.beltWidth } },
      { level: 'info', key: 'note.pulleyFit' },
    ],
  };
}

/**
 * A worm: its thread has straight flanks along the axis, so across the axis
 * each flank is a spiral whose radius grows evenly with the angle. That
 * outline, twisted once per lead, is the worm.
 */
function wormSolid(p: GearParams): { shape: Shape3D; lead: number; tip: number } {
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const m = p.module;
  const starts = p.wormStarts;
  const pitch = p.wormDiameter / 2;
  const lead = starts * Math.PI * m;
  const tip = pitch + m;
  const root = pitch - DEDENDUM * m;
  const bore = p.bore === 'none' ? 0 : p.boreDiameter / 2;
  if (root < Math.max(1.5, bore + 1.2)) throw new ParamError('err.wormThin');
  const thickness = (Math.PI * m) / 2 - p.backlash;
  const half = (r: number) => (Math.PI / lead) * (thickness - 2 * (r - pitch) * Math.tan(alpha));
  const radii = Array.from({ length: 6 }, (_, k) => root + ((tip - root) * k) / 5);
  const polar = (r: number, a: number): Pt => [r * Math.cos(a), r * Math.sin(a)];
  let pen = draw(polar(root, -half(root)));
  for (let k = 0; k < starts; k++) {
    const centre = (2 * Math.PI * k) / starts;
    for (const r of radii.slice(1)) pen = pen.lineTo(polar(r, centre - half(r)));
    pen = pen.threePointsArcTo(polar(tip, centre + half(tip)), polar(tip, centre));
    for (const r of [...radii].reverse().slice(1)) pen = pen.lineTo(polar(r, centre + half(r)));
    const next = centre + (2 * Math.PI) / starts;
    pen = pen.threePointsArcTo(polar(root, k < starts - 1 ? next - half(root) : -half(root)), polar(root, centre + Math.PI / starts));
  }
  let shape = (pen.done().sketchOnPlane('XY', 0) as Sketch).extrude(p.wormLength, { twistAngle: (360 * p.wormLength) / lead }) as Shape3D;
  const hole = boreDrawing(p);
  if (hole) shape = shape.cut(prism(hole, p.wormLength + 2, -1)) as Shape3D;
  return { shape, lead, tip };
}

// How worm and wheel sit to each other when fitted; found by trying which way round nothing collides.
const WORM_FIT = { hand: 1, thread: 1 };

function buildWorm(p: GearParams): { parts: Part[]; notes: Note[] } {
  const m = p.module;
  const alpha = (Number(p.pressureAngle) * Math.PI) / 180;
  const worm = wormSolid(p);
  // The wheel is a helical gear whose teeth slant by the lead angle of the worm.
  const leadAngle = Math.atan(worm.lead / (Math.PI * p.wormDiameter));
  const wheelPitch = (m * p.teeth) / 2;
  const twist = WORM_FIT.hand * ((p.thickness * Math.tan(leadAngle)) / wheelPitch) * (180 / Math.PI);
  // A tooth of the wheel points at the worm (towards −y) half way up.
  const wheel = gearSolid({ ...p, herringbone: false }, p.teeth, -Math.PI / 2 - ((twist / 2) * Math.PI) / 180, twist);
  const distance = p.wormDiameter / 2 + wheelPitch;
  const apart = wheel.tip + worm.tip + 4;
  // Along the worm, the gap that faces the wheel nearest to its middle
  const step = worm.lead / p.wormStarts;
  let gap = (WORM_FIT.thread * worm.lead) / 4 + step / 2;
  gap += Math.round((p.wormLength / 2 - gap) / step) * step;
  const notes: Note[] = [
    { level: 'info', key: 'note.worm', vars: { a: Math.round(distance * 100) / 100, i: Math.round((p.teeth / p.wormStarts) * 100) / 100, g: round1((leadAngle * 180) / Math.PI) } },
    { level: 'info', key: 'note.wormPrint' },
  ];
  if (p.backlash < 0.1) notes.push({ level: 'info', key: 'note.gearBacklash' });
  return {
    parts: [
      { name: 'wheel', shape: wheel.shape, assembled: { flip: false, offset: [0, 0, 0] } },
      // Fitted, the worm lies beside the wheel, its axis level with the middle of the teeth.
      { name: 'worm', shape: worm.shape.translate([apart, 0, 0]) as Shape3D, assembled: { flip: false, tilt: 90, offset: [-gap, -distance, p.thickness / 2 + apart] } },
    ],
    notes,
  };
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
  if (p.kind === 'bevel') return buildBevel(p);
  if (p.kind === 'worm') return buildWorm(p);
  if (p.kind === 'pulley') return buildPulley(p);
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
