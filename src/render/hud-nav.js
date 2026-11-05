/**
 * 导航指引的纯计算：小地图里该画什么、屏幕边缘箭头指向哪。
 *
 * 抽成纯函数是为了能直接断言 —— 「只显示当前层的房间」「目标在别层时用
 * 另一种颜色」「目标不在画面内时箭头贴在正确的边上」，这些都不需要真的
 * 跑游戏就能测。
 *
 * @module render/hud-nav
 */
import { FLOOR_Y } from '../core/floors.js';

/** 小地图覆盖的世界边长（地牢实际范围约 16 ~ 144，多留一点边）。 */
export const MAP_SPAN = 144;
/** 小地图覆盖区域的起点（世界坐标）。 */
export const MAP_ORIGIN = 8;
/** 判定「是不是同一层」的高度容差。 */
export const FLOOR_EPS = 2;

/** 目标在同层 / 不在同层时的颜色。 */
export const OBJECTIVE_COLOR = '#ffd83d';
export const OBJECTIVE_COLOR_OTHER = '#c88bff';

/**
 * 世界坐标 → 面板坐标。
 * @param {number} wx @param {number} wz @param {object} opts
 * @returns {[number, number]}
 */
function toPanel(wx, wz, opts) {
  const origin = opts.origin ?? MAP_ORIGIN;
  return [opts.x0 + (wx - origin) * opts.scale, opts.y0 + (wz - origin) * opts.scale];
}

/**
 * 玩家朝向在地图平面上的角度（弧度）。
 * 面朝 -z（地图上方）时是 0，顺时针为正。
 * @param {number} yaw 玩家偏航角
 * @returns {number}
 */
export function yawToMapAngle(yaw) {
  return -yaw;
}

/**
 * 目标相对玩家朝向的角度（弧度，屏幕上顺时针为正，0 = 正前方）。
 *
 * 目标的方位角是 atan2(dx, -dz)（0 = -z 方向），玩家自己的朝向角是 -yaw，
 * 所以相对角度 = 目标方位角 - (-yaw)。早先这里写成减 yaw，箭头会指反方向。
 *
 * @param {number} dx 目标相对玩家的 x 偏移
 * @param {number} dz 目标相对玩家的 z 偏移
 * @param {number} yaw 玩家偏航角
 * @returns {number}
 */
export function objectiveBearingAngle(dx, dz, yaw) {
  return Math.atan2(dx, -dz) + yaw;
}

/**
 * 判断某个点是否在房间的矩形范围内（水平面 + 高度都要对得上）。
 * @param {object} room @param {number} x @param {number} z @param {number} y
 * @returns {boolean}
 */
export function isInsideRoom(room, x, z, y) {
  if (!room) return false;
  const inXZ = Math.abs(x - room.cx) <= room.halfW && Math.abs(z - room.cz) <= room.halfD;
  if (!inXZ) return false;
  // 站在上一层房间的正下方时不算「在这个房间里」
  if (y === undefined || room.floorY === undefined) return true;
  return Math.abs(y - room.floorY) <= 4;
}

/**
 * 小地图的房间部分。
 * @param {object} map @param {object} opts @param {number} floorIndex
 * @returns {{rooms: object[], currentRoomName: string|null}}
 */
function buildRooms(map, opts, floorIndex) {
  const rooms = [];
  let currentRoomName = null;
  const player = map.player || { x: 0, z: 0, y: 0 };
  for (const r of map.rooms || []) {
    if ((r.floor ?? 0) !== floorIndex) continue;
    const [x0, y0] = toPanel(r.cx - r.halfW, r.cz - r.halfD, opts);
    const [x1, y1] = toPanel(r.cx + r.halfW, r.cz + r.halfD, opts);
    const isCurrent = isInsideRoom(r, player.x, player.z, player.y);
    if (isCurrent) currentRoomName = r.name || null;
    rooms.push({
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      name: r.name || null,
      isCurrent,
      isObjective: false,
      source: r,
    });
  }
  return { rooms, currentRoomName };
}

/**
 * 小地图的走廊部分（把房间连起来）。
 * @param {object} map @param {object} opts @param {number} floorY
 * @returns {object[]}
 */
function buildCorridors(map, opts, floorY) {
  const corridors = [];
  for (const c of map.corridors || []) {
    if (!c) continue;
    if (Math.abs((c.y ?? 0) - floorY) > FLOOR_EPS) continue;
    const [ax, ay] = toPanel(c.x1, c.z1, opts);
    const [bx, by] = toPanel(c.x2, c.z2, opts);
    corridors.push({ x1: ax, y1: ay, x2: bx, y2: by });
  }
  return corridors;
}

/**
 * 小地图的竖井（只标当前层那个入口）。
 * @param {object} map @param {object} opts @param {number} floorY
 * @returns {object[]}
 */
function buildShafts(map, opts, floorY) {
  const shafts = [];
  for (const st of map.stairs || []) {
    if (!st || !st.from) continue;
    if (Math.abs((st.from.y ?? 0) - floorY) > FLOOR_EPS) continue;
    const [sx, sy] = toPanel(st.from.x, st.from.z, opts);
    shafts.push({ x: sx, y: sy });
  }
  return shafts;
}

/**
 * 小地图上的零散图元（敌人 / 箱子 / 附魔台）。
 * @param {object} map @param {object} opts @param {number} floorY
 * @returns {{enemies: object[], chests: object[], enchants: object[]}}
 */
function buildPoints(map, opts, floorY) {
  const sameFloor = (y) => Math.abs((y ?? 0) - floorY) <= FLOOR_EPS;
  const pick = (list) => {
    const out = [];
    for (const item of list || []) {
      if (!item || !sameFloor(item.floorY)) continue;
      const [ix, iy] = toPanel(item.x, item.z, opts);
      out.push({ x: ix, y: iy });
    }
    return out;
  };
  return {
    enemies: pick(map.enemies),
    chests: pick(map.chests),
    enchants: pick(map.enchantSpots),
  };
}

/**
 * 小地图的目标标记。
 * @param {object} objective @param {object} opts @param {object[]} rooms
 * @param {number} floorIndex
 * @returns {object|null}
 */
function buildObjective(objective, opts, rooms, floorIndex) {
  if (!objective) return null;
  const [ox, oy] = toPanel(objective.x, objective.z, opts);

  // 目标所在的房间（当前层的话）高亮出来
  const targetRoom = (opts.rooms || []).find(
    (r) => (r.floor ?? 0) === floorIndex && isInsideRoom(r, objective.x, objective.z, objective.y)
  );
  if (targetRoom) {
    for (const r of rooms) {
      if (r.source === targetRoom) r.isObjective = true;
    }
  }

  const phase = ((opts.time ?? 0) % 1000) / 1000;
  return {
    x: ox,
    y: oy,
    onSameFloor: objective.sameFloor ?? true,
    floorIndex: objective.floorIndex ?? null,
    distance: objective.distance ?? 0,
    label: objective.label || '目标',
    pulse: 0.5 - 0.5 * Math.cos(phase * Math.PI * 2),
  };
}

/**
 * 目标在别的层时，小地图上标的箭头（↓ 在下面，↑ 在上面）。
 *
 * @param {number|null|undefined} objFloorIndex 目标所在层
 * @param {number} curFloorIndex 当前层
 * @returns {string} '' / ' ↓' / ' ↑'
 */
export function floorArrow(objFloorIndex, curFloorIndex) {
  if (objFloorIndex === null || objFloorIndex === undefined) return '';
  if (objFloorIndex === curFloorIndex) return '';
  return objFloorIndex > curFloorIndex ? ' ↓' : ' ↑';
}

/**
 * 小地图的布局计算。
 *
 * 楼层判定统一用「层序号 + 该层的标准层高」：
 * 玩家在竖井里时高度是连续的，只有层序号能说清「现在在哪一层」。
 *
 * @param {object} map state.minimap
 * @param {object} objective state.objective（可以是 null）
 * @param {object} opts { x0, y0, size, scale, time }
 * @returns {object} 各个图元的屏幕坐标
 */
export function buildMinimapLayout(map, objective, opts) {
  const scale = opts.scale ?? 1;
  const floorIndex = map.floorIndex ?? 0;
  const floorCount = map.floorCount ?? 1;
  const player = map.player || { x: 0, z: 0, yaw: 0, y: 0 };
  const floorY = map.floorY ?? FLOOR_Y[floorIndex] ?? 0;

  const { rooms, currentRoomName } = buildRooms(map, opts, floorIndex);
  const corridors = buildCorridors(map, opts, floorY);
  const shafts = buildShafts(map, opts, floorY);
  const { enemies, chests, enchants } = buildPoints(map, opts, floorY);

  // 竞技场：只有最底层才有
  let arena = null;
  if (map.arena && floorIndex === floorCount - 1) {
    const [ax, ay] = toPanel(map.arena.x - map.arena.half, map.arena.z - map.arena.half, opts);
    const [bx, by] = toPanel(map.arena.x + map.arena.half, map.arena.z + map.arena.half, opts);
    arena = { x: ax, y: ay, w: bx - ax, h: by - ay };
  }

  const [px, py] = toPanel(player.x, player.z, opts);
  const objectiveItem = buildObjective(objective, { ...opts, rooms: map.rooms || [] }, rooms, floorIndex);

  return {
    rooms,
    corridors,
    shafts,
    arena,
    enemies,
    chests,
    enchants,
    player: { x: px, y: py, angle: yawToMapAngle(player.yaw ?? 0) },
    objective: objectiveItem,
    compass: {
      x: opts.x0 + opts.size - 12 * (opts.uiScale ?? 1),
      y: opts.y0 + 12 * (opts.uiScale ?? 1),
      angle: 0,
    },
    currentRoomName,
    floorIndex,
    floorCount,
  };
}

/**
 * 屏幕边缘的指向箭头：目标不在画面里时，箭头贴在边缘指向它。
 *
 * 方向用**相机基底**里的方向量（right / up 分量）而不是屏幕坐标：
 * 目标在相机背后时投影坐标是镜像的，直接拿来算会指到反方向。
 *
 * @param {object} objective state.objective
 * @param {object} opts { width, height, scale, obstacles }
 * @returns {{x:number, y:number, angle:number, distance:number, label:string}|null}
 */
export function buildEdgeMarker(objective, opts) {
  if (!objective || !objective.screen) return null;
  if (objective.screen.visible) return null;

  const w = opts.width;
  const h = opts.height;
  const s = opts.scale ?? 1;
  // 上边要避开顶部目标条，下边要避开快捷栏，左右留一点边就行
  const marginTop = 140 * s;
  const marginBottom = 120 * s;
  const marginSide = 60 * s;
  const cx = w / 2;
  const cy = h / 2;

  // 方向只能用「相机基底」方向量：目标在相机背后时投影坐标是镜像的，
  // 拿它算方向会指到反方向。没有方向量就不画箭头。
  const dirX = objective.screen.dirX;
  const dirY = objective.screen.dirY;
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) return null;

  let dx = dirX;
  // dirY 是「相机上轴」方向（向上为正），屏幕 y 是向下为正，所以要取反
  let dy = -dirY;
  if (dx === 0 && dy === 0) {
    // 正后方：指示「转身」，箭头指屏幕下方
    dx = 0;
    dy = 1;
  }
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  // 从中心出发，走到「内缩边距的边框」为止（上下边距不一样）
  let t = Infinity;
  if (dy < -1e-6) t = (cy - marginTop) / -dy;
  else if (dy > 1e-6) t = (h - marginBottom - cy) / dy;
  if (dx > 1e-6) t = Math.min(t, (w - marginSide - cx) / dx);
  else if (dx < -1e-6) t = Math.min(t, (cx - marginSide) / -dx);
  if (!Number.isFinite(t)) t = Math.min(w, h) / 2;

  let px = cx + dx * t;
  let py = cy + dy * t;

  // 避开障碍物（比如右上角的小地图）：落点落在里面就挪到它左边
  for (const ob of opts.obstacles || []) {
    const inside =
      px > ob.x - 8 && px < ob.x + ob.w && py > ob.y - 8 && py < ob.y + ob.h;
    if (inside) px = Math.max(marginSide, ob.x - 24 * s);
  }

  return {
    x: px,
    y: py,
    angle: Math.atan2(dx, -dy),
    distance: objective.distance ?? 0,
    label: objective.label || '目标',
  };
}
