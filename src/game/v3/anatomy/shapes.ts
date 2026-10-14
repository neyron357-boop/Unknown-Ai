import { add, mul, norm, sub, type Vec } from './skeleton';

/**
 * Outline geometry for silhouettes. Everything returns closed polygons in screen space.
 * Profiles describe a body part as half-widths in front of / behind its bone, so muscles
 * read in profile: quads and calves, biceps and triceps, chest and glutes.
 */

/** [t along bone 0..1, front half-width, back half-width] in body units. */
export type Profile = [number, number, number][];

export function catmull(pts: Vec[], k = 3): Vec[] {
  if (pts.length < 3) return pts.slice();
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < k; s++) {
      const t = s / k;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Points on a circular arc from angle a0 to a1 (radians, screen space). */
export function arc(c: Vec, r: number, a0: number, a1: number, n = 6): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/** Anterior normal of a bone: points to the character's front when the bone hangs down. */
export function frontNormal(u: Vec, facing: number): Vec {
  return { x: u.y * facing, y: -u.x * facing };
}

/** Rounded cap joining two points around `center` on the side away from `inward`. */
function cap(from: Vec, to: Vec, outward: Vec, n = 5): Vec[] {
  const c = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const r = Math.hypot(to.x - from.x, to.y - from.y) / 2;
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  // choose the sweep direction that passes through `outward`
  const mid = Math.atan2(outward.y, outward.x);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  const test = a0 + sweep / 2;
  if (Math.cos(test - mid) < 0) sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
  const out: Vec[] = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/**
 * A limb segment from a to b with a muscle profile.
 * `scale` multiplies widths (pixels per unit); `facing` picks which side is "front".
 */
export function limbShape(a: Vec, b: Vec, profile: Profile, facing: number, scale: number, caps: [boolean, boolean] = [true, true]): Vec[] {
  const d = sub(b, a);
  const L = Math.hypot(d.x, d.y) || 1e-3;
  const u = { x: d.x / L, y: d.y / L };
  const n = frontNormal(u, facing);
  const front: Vec[] = [];
  const back: Vec[] = [];
  for (const [t, fw, bw] of profile) {
    const c = { x: a.x + d.x * t, y: a.y + d.y * t };
    front.push({ x: c.x + n.x * fw * scale, y: c.y + n.y * fw * scale });
    back.push({ x: c.x - n.x * bw * scale, y: c.y - n.y * bw * scale });
  }
  const f = catmull(front, 3);
  const bk = catmull(back, 3).reverse();
  const out: Vec[] = [...f];
  if (caps[1]) out.push(...cap(f[f.length - 1], bk[0], u));
  out.push(...bk);
  if (caps[0]) out.push(...cap(bk[bk.length - 1], f[0], { x: -u.x, y: -u.y }));
  return out;
}

/** Point and tangent at arc-length fraction t along a polyline chain. */
export function chainAt(chain: Vec[], t: number): { p: Vec; u: Vec } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < chain.length; i++) {
    const l = Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y);
    lens.push(l);
    total += l;
  }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const f = lens[i] ? target / lens[i] : 0;
      const a = chain[i];
      const b = chain[i + 1];
      const u = norm(sub(b, a));
      // smooth the tangent across joints
      let uu = u;
      if (f < 0.25 && i > 0) uu = norm(add(u, mul(norm(sub(chain[i], chain[i - 1])), 0.5 - f * 2)));
      if (f > 0.75 && i < lens.length - 1) uu = norm(add(u, mul(norm(sub(chain[i + 2], chain[i + 1])), (f - 0.75) * 2)));
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, u: uu };
    }
    target -= lens[i];
  }
  return { p: chain[chain.length - 1], u: { x: 0, y: -1 } };
}

/** Torso (or any trunk) along a chain of points with a profile. */
export function chainShape(chain: Vec[], profile: Profile, facing: number, scale: number): Vec[] {
  const front: Vec[] = [];
  const back: Vec[] = [];
  for (const [t, fw, bw] of profile) {
    const { p, u } = chainAt(chain, t);
    const n = frontNormal(u, facing);
    front.push({ x: p.x + n.x * fw * scale, y: p.y + n.y * fw * scale });
    back.push({ x: p.x - n.x * bw * scale, y: p.y - n.y * bw * scale });
  }
  return [...catmull(front, 3), ...catmull(back, 3).reverse()];
}

/**
 * Local shape → screen. Local coords: x forward (toward facing), y up.
 * `up` is the unit up-vector of the part in screen space.
 */
export function localShape(origin: Vec, up: Vec, facing: number, scale: number, pts: [number, number][], smooth = 0): Vec[] {
  const fwd = { x: -up.y * facing, y: up.x * facing };
  const out = pts.map(([x, y]) => ({ x: origin.x + (fwd.x * x + up.x * y) * scale, y: origin.y + (fwd.y * x + up.y * y) * scale }));
  return smooth ? catmullClosed(out, smooth) : out;
}

export function catmullClosed(pts: Vec[], k = 2): Vec[] {
  const n = pts.length;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < k; s++) {
      const t = s / k;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

/** Ribbon along a polyline (cloth, scarves, hair): width from w0 to w1, optional ragged edge. */
export function ribbonShape(pts: Vec[], w0: number, w1: number, jag = 0, seed = 1): Vec[] {
  if (pts.length < 2) return [];
  const left: Vec[] = [];
  const right: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const u = norm(sub(b, a));
    const n = { x: -u.y, y: u.x };
    const t = i / (pts.length - 1);
    let w = w0 + (w1 - w0) * t;
    if (jag && i > 0) w *= 1 + Math.sin(i * 2.7 + seed) * jag;
    left.push({ x: pts[i].x + n.x * w * 0.5, y: pts[i].y + n.y * w * 0.5 });
    right.push({ x: pts[i].x - n.x * w * 0.5, y: pts[i].y - n.y * w * 0.5 });
  }
  const l = catmull(left, 2);
  const r = catmull(right, 2).reverse();
  return [...l, ...r];
}

/** Translates a polygon. */
export function shift(pts: Vec[], dx: number, dy: number): Vec[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Axis-aligned bounds of many polygons. */
export function bounds(polys: Vec[][]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poly of polys)
    for (const p of poly) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
