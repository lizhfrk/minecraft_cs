/**
 * 通用数学 / 随机 / 体素射线工具。
 * @module core/utils
 */

/** 可复现的伪随机数发生器（mulberry32）。 */
export class RNG {
  /** @param {number} seed */
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
  }

  /** @returns {number} [0,1) */
  next() {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @param {number} min @param {number} max */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** @param {number} min @param {number} max 整数区间 */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** @param {number} p 概率 */
  chance(p) {
    return this.next() < p;
  }

  /** @template T @param {T[]} arr */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** 就地洗牌 */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const deg2rad = (d) => (d * Math.PI) / 180;

/** 帧率无关的指数逼近。 */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/**
 * 体素 DDA 射线步进（Amanatides & Woo）。
 * @param {{get:(x:number,y:number,z:number)=>number, isSolid:(x:number,y:number,z:number)=>boolean}} world
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} dir 归一化方向
 * @param {number} maxDist
 * @param {(x:number,y:number,z:number)=>boolean} [predicate] 命中判定，默认 solid
 * @returns {{x:number,y:number,z:number,nx:number,ny:number,nz:number,distance:number}|null}
 */
export function raycastVoxels(world, origin, dir, maxDist, predicate) {
  const hit = predicate || ((x, y, z) => world.isSolid(x, y, z));
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const boundary = (o, s) => (s > 0 ? Math.floor(o) + 1 - o : o - Math.floor(o));
  let tMaxX = stepX !== 0 ? boundary(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? boundary(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? boundary(origin.z, stepZ) * tDeltaZ : Infinity;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  for (let i = 0; i < 512; i++) {
    if (hit(x, y, z)) {
      return { x, y, z, nx, ny, nz, distance: t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxDist) break;
  }
  return null;
}

/**
 * 射线 vs 轴对齐包围盒（slab 法）。
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} dir
 * @param {{minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number}} box
 * @returns {number} 命中距离，未命中返回 Infinity
 */
export function rayBoxDistance(origin, dir, box) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    ['x', box.minX, box.maxX],
    ['y', box.minY, box.maxY],
    ['z', box.minZ, box.maxZ],
  ];
  for (const [axis, lo, hi] of axes) {
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (origin[axis] < lo || origin[axis] > hi) return Infinity;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - origin[axis]) * inv;
    let t2 = (hi - origin[axis]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** 射线 vs 球体，返回命中距离或 Infinity。 */
export function raySphereDistance(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** 点是否落在 AABB 内。 */
export function pointInBox(p, box, pad = 0) {
  return (
    p.x >= box.minX - pad &&
    p.x <= box.maxX + pad &&
    p.y >= box.minY - pad &&
    p.y <= box.maxY + pad &&
    p.z >= box.minZ - pad &&
    p.z <= box.maxZ + pad
  );
}

/** 由中心点与尺寸构造 AABB。 */
export function makeBox(cx, cy, cz, w, h) {
  const hw = w / 2;
  return {
    minX: cx - hw,
    maxX: cx + hw,
    minY: cy,
    maxY: cy + h,
    minZ: cz - hw,
    maxZ: cz + hw,
  };
}
