/**
 * 体素物理：碰撞检测与轴向解算，供玩家与敌人共用。
 * @module world/physics
 */

const EPS = 1e-3;

/**
 * 包围盒是否与实心方块重叠。
 * @param {import('./world.js').World} world
 * @param {number} x @param {number} y @param {number} z
 * @param {number} hw 半宽 @param {number} h 高度
 */
export function bodyCollides(world, x, y, z, hw, h) {
  const minX = Math.floor(x - hw + EPS);
  const maxX = Math.floor(x + hw - EPS);
  const minY = Math.floor(y + EPS);
  const maxY = Math.floor(y + h - EPS);
  const minZ = Math.floor(z - hw + EPS);
  const maxZ = Math.floor(z + hw - EPS);
  for (let vy = minY; vy <= maxY; vy++) {
    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vx = minX; vx <= maxX; vx++) {
        if (world.isSolid(vx, vy, vz)) return true;
      }
    }
  }
  return false;
}

/**
 * 沿轴解算穿透并修正坐标。
 * @param {import('./world.js').World} world
 * @param {{x:number,y:number,z:number}} pos
 * @param {'x'|'y'|'z'} axis @param {number} delta
 * @param {number} hw @param {number} h
 * @returns {number|null} 修正后的坐标；无碰撞返回 null
 */
export function correctAxis(world, pos, axis, delta, hw, h) {
  // delta 为 0 时没有「移动方向」，无法计算修正位置，直接跳过
  // （否则会被当成向下移动，把实体凭空顶到方块顶面）
  if (delta === 0) return null;
  const minX = Math.floor(pos.x - hw + EPS);
  const maxX = Math.floor(pos.x + hw - EPS);
  const minY = Math.floor(pos.y + EPS);
  const maxY = Math.floor(pos.y + h - EPS);
  const minZ = Math.floor(pos.z - hw + EPS);
  const maxZ = Math.floor(pos.z + hw - EPS);

  let correction = null;
  for (let vy = minY; vy <= maxY; vy++) {
    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vx = minX; vx <= maxX; vx++) {
        if (!world.isSolid(vx, vy, vz)) continue;
        let c;
        if (axis === 'x') {
          c = delta > 0 ? vx - hw - EPS : vx + 1 + hw + EPS;
          correction = correction === null ? c : delta > 0 ? Math.min(correction, c) : Math.max(correction, c);
        } else if (axis === 'z') {
          c = delta > 0 ? vz - hw - EPS : vz + 1 + hw + EPS;
          correction = correction === null ? c : delta > 0 ? Math.min(correction, c) : Math.max(correction, c);
        } else {
          c = delta > 0 ? vy - h - EPS : vy + 1 + EPS;
          correction = correction === null ? c : delta > 0 ? Math.min(correction, c) : Math.max(correction, c);
        }
      }
    }
  }
  if (correction !== null) pos[axis] = correction;
  return correction;
}

/**
 * 实体脚下（正下方一格）是否有方块支撑。
 * 检查中心与四个角，避免「斜着站在台阶边缘」时被误判为悬空。
 * @param {import('./world.js').World} world
 * @param {{x:number,y:number,z:number}} pos
 * @param {number} hw
 */
export function hasGroundUnder(world, pos, hw) {
  const feetY = Math.floor(pos.y - 0.01);
  const xs = [Math.floor(pos.x), Math.floor(pos.x + hw - 0.01), Math.floor(pos.x - hw + 0.01)];
  const zs = [Math.floor(pos.z), Math.floor(pos.z + hw - 0.01), Math.floor(pos.z - hw + 0.01)];
  for (const x of xs) {
    for (const z of zs) {
      if (world.isSolid(x, feetY, z)) return true;
    }
  }
  return false;
}

/**
 * 推进一个实体：重力 + 水平移动 + 碰撞解算（支持自动上台阶）。
 *
 * 上台阶的规则（避免实体「飞起来」）：
 *  1. 一帧内最多抬高 1 格 —— X / Z 两个轴共用同一个基准高度，
 *     否则斜着撞墙角时两个轴各抬一次，实体每帧都在往上爬；
 *  2. 只有站在地面上时才允许上台阶（腾空时抬升等于凭空升高）；
 *  3. 抬升后脚下必须有方块支撑，否则退回原位。
 *
 * @param {import('./world.js').World} world
 * @param {{x:number,y:number,z:number}} pos
 * @param {{x:number,y:number,z:number}} vel
 * @param {number} dt
 * @param {number} hw 半宽 @param {number} h 高度
 * @param {{gravity?:number, stepUp?:boolean, friction?:number, grounded?:boolean}} [opts]
 * @returns {{onGround:boolean, stepped:boolean}}
 */
export function moveBody(world, pos, vel, dt, hw, h, opts = {}) {
  const gravity = opts.gravity ?? 26;
  const stepUp = opts.stepUp !== false;
  const friction = opts.friction ?? 0;
  const grounded = opts.grounded ?? false;

  vel.y -= gravity * dt;
  if (vel.y < -45) vel.y = -45;

  const baseY = pos.y; // 本帧基准高度，两个轴共用
  const beforeX = pos.x;
  const beforeZ = pos.z;
  const dx = vel.x * dt;
  const dz = vel.z * dt;
  let stepped = false;

  // 先在原高度同时推进两个轴
  let hitX = false;
  let hitZ = false;
  if (dx !== 0) {
    pos.x += dx;
    if (correctAxis(world, pos, 'x', dx, hw, h) !== null) {
      pos.x = beforeX;
      hitX = true;
    }
  }
  if (dz !== 0) {
    pos.z += dz;
    if (correctAxis(world, pos, 'z', dz, hw, h) !== null) {
      pos.z = beforeZ;
      hitZ = true;
    }
  }

  if (hitX || hitZ) {
    if (stepUp && grounded) {
      // 逐轴尝试抬高 1 格。两个轴共用 baseY：一帧最多升 1 格，
      // 不会因为两个轴各抬一次而变成 2 格（那正是实体「飞起来」的根因）。
      if (hitX) {
        const ox = pos.x;
        pos.x = beforeX + dx;
        pos.y = baseY + 1.0;
        const blocked = correctAxis(world, pos, 'x', dx, hw, h) !== null;
        const supported =
          !blocked && !bodyCollides(world, pos.x, pos.y, pos.z, hw, h) &&
          hasGroundUnder(world, pos, hw);
        if (supported) {
          stepped = true;
          vel.y = Math.max(vel.y, 0);
        } else {
          pos.x = ox;
          pos.y = baseY;
          vel.x = 0;
        }
      }
      if (hitZ) {
        const oz = pos.z;
        const oy = pos.y;
        pos.z = beforeZ + dz;
        pos.y = baseY + 1.0;
        const blocked = correctAxis(world, pos, 'z', dz, hw, h) !== null;
        const supported =
          !blocked && !bodyCollides(world, pos.x, pos.y, pos.z, hw, h) &&
          hasGroundUnder(world, pos, hw);
        if (supported) {
          stepped = true;
          vel.y = Math.max(vel.y, 0);
        } else {
          pos.z = oz;
          pos.y = oy;
          vel.z = 0;
        }
      }
    } else {
      if (hitX) vel.x = 0;
      if (hitZ) vel.z = 0;
    }
  }

  // Y 轴
  const beforeY = pos.y;
  const dy = vel.y * dt;
  let onGround = false;
  // dy 为 0 时不做解算：correctAxis 会把 delta=0 当成「向下」，可能把实体凭空顶上去
  if (dy !== 0) {
    pos.y += dy;
    if (correctAxis(world, pos, 'y', dy, hw, h) !== null) {
      if (dy < 0) onGround = true;
      vel.y = 0;
    } else if (dy < 0) {
      if (bodyCollides(world, pos.x, pos.y - 0.08, pos.z, hw, h)) {
        pos.y = beforeY;
        onGround = true;
        vel.y = 0;
      }
    }
  }

  if (friction > 0 && onGround) {
    vel.x *= 1 - friction;
    vel.z *= 1 - friction;
  }

  return { onGround, stepped };
}

/**
 * 判断目标点是否可以站立。
 * @param {import('./world.js').World} world
 */
export function canStand(world, x, y, z, hw, h) {
  return !bodyCollides(world, x, y, z, hw, h);
}
