/**
 * 地牢生成：多层递进的房间结构、走廊、下行阶梯、装饰，以及终局 BOSS 竞技场。
 * @module world/dungeon
 */
import { BLOCK } from './blocks.js';
import { RNG } from '../core/utils.js';
import { FLOOR_Y } from '../core/floors.js';

export const WORLD_W = 160;
export const WORLD_H = 80;
export const WORLD_D = 160;

/** 房间网格（4×4 单元，单元 32 格）。 */
const CELL = 32;
const CELL_ORIGIN = 16;
const GRID = 4;

/** BOSS 竞技场中心与半径。 */
export const ARENA_CENTER = { x: 80, z: 80 };
export const ARENA_HALF = 23;
export const ARENA_FLOOR_Y = FLOOR_Y[FLOOR_Y.length - 1];

const THEMES = ['hall', 'treasure', 'mob', 'lava', 'library', 'mines', 'crypt'];

export class Dungeon {
  /**
   * @param {import('./world.js').World} world
   * @param {number} seed
   */
  constructor(world, seed = 20261026) {
    this.world = world;
    this.rng = new RNG(seed);
    /** @type {Room[]} */
    this.rooms = [];
    /** @type {{pos:{x:number,y:number,z:number}, label:string}[]} */
    this.checkpoints = [];
    /** 房间在 XZ 平面上的索引（cellX,cellZ）→ 房间 */
    this.cellMap = new Map();
    /** 已挖出的走廊线段，用于竞技场开洞等后处理 */
    this.corridorSegments = [];
    /** 已放置的竖井位置，用于避免互相重叠 */
    this.usedShafts = [];
    /** 附魔台位置（武器升级点） */
    this.enchantSpots = [];
  }

  /** 生成整个地牢。 */
  generate() {
    this.fillRock();
    this.buildFloors();
    this.buildArena();
    this.decorateEntrance();
    this.world.relight();
  }

  /** 入口房间：放置工作台、熔炉、补给箱与出生点。 */
  decorateEntrance() {
    const room = this.rooms[0];
    if (!room) return;
    const w = this.world;
    const { cx, cz, floorY, halfW, halfD } = room;

    // 一律放在房间四角，避免挡住后续挖出的竖井门洞（门洞在墙面正中）
    const corners = [
      [cx - halfW + 1, cz - halfD + 1],
      [cx - halfW + 1, cz + halfD - 1],
      [cx + halfW - 1, cz - halfD + 1],
      [cx + halfW - 1, cz + halfD - 1],
    ];

    w.set(corners[0][0], floorY, corners[0][1], BLOCK.CRAFTING);
    w.set(corners[1][0], floorY, corners[1][1], BLOCK.FURNACE);

    w.set(corners[2][0], floorY, corners[2][1], BLOCK.CHEST);
    w.meta.set(w.index(corners[2][0], floorY, corners[2][1]), {
      type: 'chest',
      loot: [
        { item: 'arrow', count: 16 },
        { item: 'bread', count: 4 },
        { item: 'iron', count: 3 },
        { item: 'torch', count: 8 },
      ],
    });

    for (const c of corners) {
      for (let y = 0; y < 3; y++) w.set(c[0], floorY + y, c[1], BLOCK.OBSIDIAN);
      w.set(c[0], floorY + 3, c[1], BLOCK.TORCH);
    }

    this.spawnPoint = { x: cx, y: floorY, z: cz };
    this.checkpoints.push({ pos: { ...this.spawnPoint }, label: '地牢入口' });
  }

  /* -------------------------------------------------------------- */
  /*                            基础填充                             */
  /* -------------------------------------------------------------- */

  fillRock() {
    const w = this.world;
    for (let y = 0; y < w.height; y++) {
      for (let z = 0; z < w.depth; z++) {
        for (let x = 0; x < w.width; x++) {
          let id = BLOCK.STONE;
          if (y === 0) id = BLOCK.BEDROCK;
          else if (y === 1 && (x * 7 + z * 13) % 5 === 0) id = BLOCK.BEDROCK;
          else if (y < 4 && (x * 31 + z * 17 + y * 11) % 7 === 0) id = BLOCK.DEEPSLATE;
          w.blocks[w.index(x, y, z)] = id;
        }
      }
    }
  }

  /* -------------------------------------------------------------- */
  /*                            楼层构建                             */
  /* -------------------------------------------------------------- */

  buildFloors() {
    const rng = this.rng;
    /** 每层房间数量 */
    const perFloor = [4, 4, 4, 2];
    /** 每层使用哪些单元（0-15） */
    const floorCells = [];
    for (let f = 0; f < 4; f++) {
      const pool = [];
      for (let i = 0; i < GRID * GRID; i++) {
        const cx = i % GRID;
        const cz = Math.floor(i / GRID);
        // 底层避开中央竞技场占用的 2×2 单元
        if (f === 3 && cx >= 1 && cx <= 2 && cz >= 1 && cz <= 2) continue;
        pool.push(i);
      }
      rng.shuffle(pool);
      floorCells.push(pool.slice(0, perFloor[f]));
    }

    /** @type {Room[][]} */
    const floors = [];
    for (let f = 0; f < 4; f++) {
      const y = FLOOR_Y[f];
      /** @type {Room[]} */
      const floorRooms = [];
      for (const cellIdx of floorCells[f]) {
        const cx = cellIdx % GRID;
        const cz = Math.floor(cellIdx / GRID);
        const room = this.createRoom(cx, cz, y, f);
        floorRooms.push(room);
        this.rooms.push(room);
        this.cellMap.set(`${f}:${cx},${cz}`, room);
      }
      floors.push(floorRooms);
    }

    // 同层房间用走廊连通
    for (let f = 0; f < 4; f++) {
      this.connectFloor(floors[f], FLOOR_Y[f]);
    }
    // 逐层向下：阶梯 + 通往下一层房间的走廊
    for (let f = 0; f < 3; f++) {
      this.carveDescent(floors[f], FLOOR_Y[f], floors[f + 1], FLOOR_Y[f + 1]);
    }
    // 最底层通往 BOSS 竞技场
    this.carveDescentToArena(floors[3], FLOOR_Y[3]);

    // 前三层各放一个附魔台（武器升级点）
    for (let f = 0; f < 3; f++) {
      this.placeEnchantingTable(floors[f]);
    }
  }

  /**
   * 在某一层随机一个房间里放置附魔台。
   * 避开岩浆房（地面有破洞漏岩浆），并要求脚下是实心地板。
   * @param {Room[]} rooms
   */
  placeEnchantingTable(rooms) {
    if (!rooms.length) return;
    const rng = this.rng;
    const safe = rooms.filter((r) => r.theme !== 'lava');
    const pool = safe.length ? safe : rooms;
    const room = rng.pick(pool);
    // 找一块脚下踩实、头顶有空间的地面
    const free = room.cells.filter(
      (c) =>
        this.world.get(c.x, room.floorY, c.z) === 0 &&
        this.world.isSolid(c.x, room.floorY - 1, c.z)
    );
    if (!free.length) return;
    const p = rng.pick(free);
    this.world.set(p.x, room.floorY, p.z, BLOCK.ENCHANTING_TABLE);
    this.enchantSpots.push({ x: p.x + 0.5, y: room.floorY, z: p.z + 0.5 });
  }

  /**
   * 创建一个房间。
   * @param {number} cx @param {number} cz @param {number} y @param {number} floor
   */
  createRoom(cx, cz, y, floor) {
    const rng = this.rng;
    const halfW = rng.int(5, 8);
    const halfD = rng.int(5, 8);
    const height = rng.int(6, 9);
    const theme = THEMES[(cx * 3 + cz * 5 + floor) % THEMES.length];
    const room = {
      cx: CELL_ORIGIN + cx * CELL + CELL / 2,
      cz: CELL_ORIGIN + cz * CELL + CELL / 2,
      halfW,
      halfD,
      floorY: y,
      height,
      theme,
      floor,
      cells: [],
      spawnPoints: [],
    };
    this.carveRoom(room);
    this.decorateRoom(room);
    return room;
  }

  /** 挖空房间并铺地面、墙、顶。 */
  carveRoom(room) {
    const w = this.world;
    const { cx, cz, halfW, halfD, floorY, height } = room;
    const x0 = cx - halfW;
    const x1 = cx + halfW;
    const z0 = cz - halfD;
    const z1 = cz + halfD;

    const floorBlock = this.floorMaterial(room);
    const wallBlock = this.wallMaterial(room);
    const ceilBlock = this.ceilingMaterial(room);

    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        for (let y = floorY; y < floorY + height; y++) {
          w.set(x, y, z, 0);
        }
        // 地面
        w.set(x, floorY - 1, z, floorBlock);
        // 顶
        w.set(x, floorY + height, z, ceilBlock);
      }
    }
    // 墙（厚 1 格）
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      for (let z = z0 - 1; z <= z1 + 1; z++) {
        const onEdge =
          x === x0 - 1 || x === x1 + 1 || z === z0 - 1 || z === z1 + 1;
        if (!onEdge) continue;
        for (let y = floorY - 1; y <= floorY + height + 1; y++) {
          w.set(x, y, z, wallBlock);
        }
      }
    }
    // 记录房间内的方块坐标（用于生成点、装饰、校验）
    for (let x = x0 + 1; x < x1; x++) {
      for (let z = z0 + 1; z < z1; z++) {
        room.cells.push({ x, z });
      }
    }
  }

  floorMaterial(room) {
    switch (room.theme) {
      case 'library':
        return BLOCK.DARK_PLANKS;
      case 'lava':
        return BLOCK.NETHERRACK;
      case 'mines':
        return BLOCK.DIRT;
      case 'crypt':
        return BLOCK.SANDSTONE;
      case 'treasure':
        return BLOCK.QUARTZ;
      case 'mob':
        return BLOCK.COBBLESTONE;
      case 'hall':
      default:
        return room.floor >= 2 ? BLOCK.DEEPSLATE : BLOCK.STONE_BRICKS;
    }
  }

  wallMaterial(room) {
    switch (room.theme) {
      case 'library':
        return BLOCK.PLANKS;
      case 'lava':
        return BLOCK.NETHERRACK;
      case 'crypt':
        return BLOCK.SANDSTONE;
      case 'treasure':
        return BLOCK.QUARTZ;
      case 'mines':
        return BLOCK.COBBLESTONE;
      case 'hall':
      default:
        return room.floor >= 2 ? BLOCK.DEEPSLATE : BLOCK.STONE_BRICKS;
    }
  }

  ceilingMaterial(room) {
    switch (room.theme) {
      case 'library':
        return BLOCK.PLANKS;
      case 'lava':
        return BLOCK.NETHERRACK;
      default:
        return room.floor >= 2 ? BLOCK.DEEPSLATE : BLOCK.COBBLESTONE;
    }
  }

  /* -------------------------------------------------------------- */
  /*                            房间装饰                             */
  /* -------------------------------------------------------------- */

  decorateRoom(room) {
    const rng = this.rng;
    const w = this.world;
    const { cx, cz, halfW, halfD, floorY, height, theme } = room;

    // 墙上的火把（避开房间四角，防止挡住门洞）
    const torchCount = rng.int(2, 5);
    for (let i = 0; i < torchCount; i++) {
      const side = rng.int(0, 3);
      let x;
      let z;
      if (side === 0) {
        x = rng.int(cx - halfW + 2, cx + halfW - 2);
        z = cz - halfD;
      } else if (side === 1) {
        x = rng.int(cx - halfW + 2, cx + halfW - 2);
        z = cz + halfD;
      } else if (side === 2) {
        x = cx - halfW;
        z = rng.int(cz - halfD + 2, cz + halfD - 2);
      } else {
        x = cx + halfW;
        z = rng.int(cz - halfD + 2, cz + halfD - 2);
      }
      // 火把要贴在墙上（脚下方块为实体）
      if (!w.isSolid(x, floorY - 1, z)) {
        w.set(x, floorY - 1, z, BLOCK.STONE_BRICKS);
      }
      w.set(x, floorY, z, BLOCK.TORCH);
    }

    // 柱子
    if (theme === 'hall' || theme === 'crypt') {
      const px = cx - halfW + 2;
      const pz = cz - halfD + 2;
      for (const ox of [0, halfW * 2 - 4]) {
        for (const oz of [0, halfD * 2 - 4]) {
          for (let y = floorY; y < floorY + height - 1; y++) {
            w.set(px + ox, y, pz + oz, room.floor >= 2 ? BLOCK.DEEPSLATE : BLOCK.STONE_BRICKS);
          }
          w.set(px + ox, floorY + height - 1, pz + oz, BLOCK.GOLD_BLOCK);
        }
      }
    }

    // 矿脉：嵌在墙里
    const oreCount = rng.int(6, 16);
    const ores = [BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.REDSTONE_ORE, BLOCK.DIAMOND_ORE];
    for (let i = 0; i < oreCount; i++) {
      const x = rng.int(cx - halfW - 1, cx + halfW + 1);
      const z = rng.int(cz - halfD - 1, cz + halfD + 1);
      const y = rng.int(floorY, floorY + height);
      if (w.get(x, y, z) !== 0) w.set(x, y, z, rng.pick(ores));
    }

    // 主题专属陈设
    switch (theme) {
      case 'treasure': {
        const chests = rng.int(2, 4);
        for (let i = 0; i < chests; i++) {
          const p = this.pickFloorCell(room);
          if (!p) continue;
          w.set(p.x, floorY, p.z, BLOCK.CHEST);
          this.world.meta.set(w.index(p.x, floorY, p.z), { type: 'chest', loot: this.rollLoot() });
        }
        for (let i = 0; i < 5; i++) {
          const p = this.pickFloorCell(room);
          if (!p) continue;
          w.set(p.x, floorY, p.z, BLOCK.GOLD_BLOCK);
        }
        break;
      }
      case 'mob': {
        const p = this.pickFloorCell(room);
        if (p) {
          w.set(p.x, floorY, p.z, BLOCK.SPAWNER);
        }
        for (let i = 0; i < rng.int(3, 7); i++) {
          const q = this.pickFloorCell(room);
          if (q) w.set(q.x, floorY, q.z, BLOCK.COBWEB);
        }
        break;
      }
      case 'lava': {
        const cxr = cx + rng.int(-2, 2);
        const czr = cz + rng.int(-2, 2);
        const r = rng.int(2, 4);
        for (let x = cxr - r; x <= cxr + r; x++) {
          for (let z = czr - r; z <= czr + r; z++) {
            if ((x - cxr) ** 2 + (z - czr) ** 2 > r * r) continue;
            if (w.get(x, floorY, z) === 0) {
              w.set(x, floorY - 1, z, BLOCK.LAVA);
            }
          }
        }
        break;
      }
      case 'library': {
        for (let i = 0; i < 6; i++) {
          const side = rng.int(0, 3);
          let x;
          let z;
          if (side === 0) {
            x = rng.int(cx - halfW + 1, cx + halfW - 1);
            z = cz - halfD;
          } else if (side === 1) {
            x = rng.int(cx - halfW + 1, cx + halfW - 1);
            z = cz + halfD;
          } else if (side === 2) {
            x = cx - halfW;
            z = rng.int(cz - halfD + 1, cz + halfD - 1);
          } else {
            x = cx + halfW;
            z = rng.int(cz - halfD + 1, cz + halfD - 1);
          }
          for (let y = floorY; y < floorY + 3; y++) w.set(x, y, z, BLOCK.BOOKSHELF);
        }
        const p = this.pickFloorCell(room);
        if (p) w.set(p.x, floorY, p.z, BLOCK.CRAFTING);
        break;
      }
      case 'mines': {
        for (let i = 0; i < 4; i++) {
          const p = this.pickFloorCell(room);
          if (!p) continue;
          w.set(p.x, floorY, p.z, BLOCK.TNT);
        }
        break;
      }
      case 'crypt': {
        for (let i = 0; i < rng.int(2, 4); i++) {
          const p = this.pickFloorCell(room);
          if (!p) continue;
          w.set(p.x, floorY, p.z, BLOCK.SPAWNER);
        }
        break;
      }
      default:
        break;
    }
  }

  /** 随机取房间内一个空格位置。 */
  pickFloorCell(room) {
    const free = room.cells.filter(
      (c) => this.world.get(c.x, room.floorY, c.z) === 0
    );
    if (free.length === 0) return null;
    return this.rng.pick(free);
  }

  /** 宝箱战利品。 */
  rollLoot() {
    const rng = this.rng;
    const pool = ['arrow', 'arrow', 'arrow', 'bread', 'bread', 'iron', 'gold', 'torch', 'potion'];
    const n = rng.int(2, 4);
    const loot = [];
    for (let i = 0; i < n; i++) {
      const item = rng.pick(pool);
      const count = item === 'arrow' ? rng.int(6, 14) : rng.int(1, 3);
      loot.push({ item, count });
    }
    // 防具比较稀有，约三成的箱子有一件
    if (rng.chance(0.3)) {
      const armorPool = [
        'leather_helmet',
        'leather_chestplate',
        'leather_leggings',
        'iron_helmet',
        'iron_chestplate',
        'iron_leggings',
        'diamond_helmet',
        'diamond_chestplate',
        'diamond_leggings',
      ];
      loot.push({ item: rng.pick(armorPool), count: 1 });
    }
    return loot;
  }

  /* -------------------------------------------------------------- */
  /*                            连通结构                             */
  /* -------------------------------------------------------------- */

  /**
   * 同层房间用 L 形走廊连成最小生成树。
   * @param {Room[]} rooms @param {number} y
   */
  connectFloor(rooms, y) {
    if (rooms.length < 2) return;
    const connected = [rooms[0]];
    const rest = rooms.slice(1);
    while (rest.length > 0) {
      let best = null;
      let bestA = null;
      let bestD = Infinity;
      for (const a of connected) {
        for (const b of rest) {
          const d = Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
          if (d < bestD) {
            bestD = d;
            best = b;
            bestA = a;
          }
        }
      }
      this.carveCorridor(bestA.cx, bestA.cz, y, best.cx, best.cz, y);
      connected.push(best);
      rest.splice(rest.indexOf(best), 1);
    }
  }

  /**
   * L 形走廊（宽 3，高 3）。
   */
  carveCorridor(x1, z1, y, x2, z2) {
    const midX = x2;
    this.carveTunnel(x1, z1, midX, z1, y);
    this.carveTunnel(midX, z1, midX, z2, y);
    // 记录走廊线段（用于竞技场开洞与冲突检测），两段都必须与坐标轴平行
    this.corridorSegments.push(
      { x1, z1, x2: midX, z2: z1, y },
      { x1: midX, z1, x2: midX, z2, y }
    );
  }

  /**
   * 若该位置是箱子之类的实心装饰，把它挪到旁边空位（避免挖路时丢失战利品）。
   * @param {number} x @param {number} y @param {number} z
   */
  relocateDecoration(x, y, z) {
    const w = this.world;
    const id = w.get(x, y, z);
    if (id !== BLOCK.CHEST && id !== BLOCK.SPAWNER) return;
    const index = w.index(x, y, z);
    const meta = w.meta.get(index);
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (w.get(nx, ny, nz) !== 0) continue;
          if (!w.isSolid(nx, ny - 1, nz)) continue;
          w.set(nx, ny, nz, id);
          if (meta) {
            w.meta.set(w.index(nx, ny, nz), meta);
            w.meta.delete(index);
          }
          return;
        }
      }
    }
  }

  /** 沿轴向挖一条直隧道。 */
  carveTunnel(x1, z1, x2, z2, y) {
    const w = this.world;
    const stepX = Math.sign(x2 - x1);
    const stepZ = Math.sign(z2 - z1);
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    for (let i = 0; i <= len; i++) {
      const x = x1 + stepX * i;
      const z = z1 + stepZ * i;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const px = x + ox;
          const pz = z + oz;
          this.relocateDecoration(px, y, pz);
          this.relocateDecoration(px, y + 1, pz);
          w.set(px, y, pz, 0);
          w.set(px, y + 1, pz, 0);
          w.set(px, y + 2, pz, 0);
          w.set(px, y - 1, pz, BLOCK.STONE_BRICKS);
        }
      }
    }
  }

  /**
   * 竞技场围墙上，凡有同层走廊穿过的地方都开出可通行的洞口。
   */
  punchArenaDoors() {
    const w = this.world;
    const ax0 = ARENA_CENTER.x - ARENA_HALF;
    const ax1 = ARENA_CENTER.x + ARENA_HALF;
    const az0 = ARENA_CENTER.z - ARENA_HALF;
    const az1 = ARENA_CENTER.z + ARENA_HALF;
    const y = ARENA_FLOOR_Y;

    const onWall = (x, z) =>
      (x === ax0 - 1 || x === ax1 + 1 || z === az0 - 1 || z === az1 + 1) &&
      x >= ax0 - 2 &&
      x <= ax1 + 2 &&
      z >= az0 - 2 &&
      z <= az1 + 2;

    for (const seg of this.corridorSegments) {
      if (seg.y !== y) continue;
      // 拆成与坐标轴平行的两段，保证能覆盖整条走廊
      const legs = [];
      const dx = Math.sign(seg.x2 - seg.x1);
      const dz = Math.sign(seg.z2 - seg.z1);
      if (dx !== 0 && dz !== 0) {
        legs.push({ x1: seg.x1, z1: seg.z1, x2: seg.x2, z2: seg.z1 });
        legs.push({ x1: seg.x2, z1: seg.z1, x2: seg.x2, z2: seg.z2 });
      } else {
        legs.push(seg);
      }

      for (const leg of legs) {
        const ldx = Math.sign(leg.x2 - leg.x1);
        const ldz = Math.sign(leg.z2 - leg.z1);
        const len = Math.max(Math.abs(leg.x2 - leg.x1), Math.abs(leg.z2 - leg.z1));
        for (let t = 0; t <= len; t++) {
          const bx = leg.x1 + ldx * t;
          const bz = leg.z1 + ldz * t;
          // 走廊宽 3 格：垂直方向也要一起打通
          for (const [ox, oz] of [
            [0, 0],
            [ldz, -ldx],
            [-ldz, ldx],
          ]) {
            const px = bx + ox;
            const pz = bz + oz;
            if (!onWall(px, pz)) continue;
            for (let dy = 0; dy < 3; dy++) w.set(px, y + dy, pz, 0);
            w.set(px, y - 1, pz, BLOCK.END_STONE);
          }
        }
      }
    }
  }

  /**
   * 从本层挖一条下行通道（5×5 竖井内的螺旋阶梯）通往下层，并接上通往下一层房间的走廊。
   * 竖井式的好处：不会横穿同层走廊把房间隔断。
   * @param {Room[]} rooms @param {number} y @param {Room[]} nextRooms @param {number} nextY
   */
  carveDescent(rooms, y, nextRooms, nextY) {
    if (rooms.length === 0 || nextRooms.length === 0) return;
    const w = this.world;
    const rng = this.rng;
    const room = rng.pick(rooms);

    const spot = this.findShaftSpot(room, y, nextY);
    if (!spot) {
      this.carveDescentFallback(room, y, nextY);
      return;
    }
    const { cx, cz, dir } = spot;

    const HALF = 2; // 5×5 竖井
    const originX = cx - HALF;
    const originZ = cz - HALF;

    // 螺旋顺序：从入口角开始绕圈
    const ring = this.shaftRing(dir);

    // 挖竖井本体（从入口层上方一直到下一层，保证每级都有 2 格净空）
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        for (let yy = y + 1; yy >= nextY; yy--) {
          w.set(originX + i, yy, originZ + j, 0);
        }
        // 竖井底部地板
        w.set(originX + i, nextY - 1, originZ + j, BLOCK.STEP);
      }
    }

    // 入口平台：前 3 格保持与入口层连通，其余保持封闭，避免玩家一脚踩空
    for (let k = 0; k < 3 && k < ring.length; k++) {
      const [i, j] = ring[k];
      w.set(originX + i, y, originZ + j, 0);
    }

    // 螺旋台阶：每绕一格下降 1 格。
    // 留出最后一格作为「下到井底」的落点，避免最后一级台阶挡住井底。
    const steps = y - nextY;
    const blockCount = Math.min(ring.length - 1, Math.max(1, steps - 1));
    for (let k = 0; k < blockCount; k++) {
      const [i, j] = ring[k];
      w.set(originX + i, y - 1 - k, originZ + j, BLOCK.STEP);
    }

    // 入口：从房间角落走一条 L 形门洞到竖井入口格
    const entryLocal = ring[0];
    const entryX = originX + entryLocal[0];
    const entryZ = originZ + entryLocal[1];
    const cornerX = room.cx + dir.dx * room.halfW;
    const cornerZ = room.cz + dir.dz * room.halfD;
    this.carveDoorway(cornerX, cornerZ, entryX, cornerZ, y);
    this.carveDoorway(entryX, cornerZ, entryX, entryZ, y);

    // 入口装饰：黑曜石门柱 + 发光方块
    for (let h = 0; h < 3; h++) {
      w.set(cornerX, y + h, cornerZ - dir.dz * 2, BLOCK.OBSIDIAN);
      w.set(cornerX, y + h, cornerZ - dir.dz * 2 + dir.dz * 4, BLOCK.OBSIDIAN);
    }
    w.set(cornerX, y + 3, cornerZ, BLOCK.END_PORTAL);

    // 出口：竖井对角，接向下一层
    const exitLocal = ring[ring.length / 2];
    const exitX = originX + exitLocal[0];
    const exitZ = originZ + exitLocal[1];

    let target = nextRooms[0];
    let bestD = Infinity;
    for (const r of nextRooms) {
      const d = Math.abs(r.cx - exitX) + Math.abs(r.cz - exitZ);
      if (d < bestD) {
        bestD = d;
        target = r;
      }
    }
    this.carveCorridor(exitX, exitZ, nextY, target.cx, target.cz);

    this.stairs = this.stairs || [];
    this.stairs.push({
      from: { x: cornerX, y, z: cornerZ },
      to: { x: exitX, y: nextY, z: exitZ },
      // 竖井本体（5×5 的柱体）—— 指引要靠它判断「玩家是不是正在井下」
      shaft: { cx, cz, half: HALF },
      nextY,
    });
  }

  /**
   * 螺旋台阶的绕圈顺序（局部坐标），从入口角开始。
   * @param {{dx:number,dz:number}} dir 竖井相对房间的方向（对角）
   * @returns {[number,number][]}
   */
  shaftRing(dir) {
    const base = [
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3],
      [4, 4], [3, 4], [2, 4], [1, 4], [0, 4], [0, 3], [0, 2], [0, 1],
    ];
    // 入口角：朝向房间的那个角
    const entry =
      dir.dx > 0
        ? dir.dz > 0
          ? [0, 0]
          : [0, 4]
        : dir.dz > 0
          ? [4, 0]
          : [4, 4];
    const idx = base.findIndex((c) => c[0] === entry[0] && c[1] === entry[1]);
    return base.slice(idx).concat(base.slice(0, idx));
  }

  /**
   * 在两点之间挖一条 1 格宽、2 格高的门洞，保留地面。
   * @param {number} x1 @param {number} z1 @param {number} x2 @param {number} z2 @param {number} y
   */
  carveDoorway(x1, z1, x2, z2, y) {
    const w = this.world;
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    const sx = Math.sign(x2 - x1);
    const sz = Math.sign(z2 - z1);
    for (let i = 0; i <= steps; i++) {
      const px = x1 + sx * i;
      const pz = z1 + sz * i;
      this.relocateDecoration(px, y, pz);
      this.relocateDecoration(px, y + 1, pz);
      w.set(px, y, pz, 0);
      w.set(px, y + 1, pz, 0);
    }
  }

  /**
   * 为竖井挑选一个不与其它房间 / 竞技场冲突的位置。
   * 竖井一律放在房间的斜对角方向 —— 这样它既不会落在房间的边界线上，
   * 也不会落在走廊（走廊总是沿着房间中心线走）上。
   * @param {Room} room @param {number} y @param {number} nextY
   */
  findShaftSpot(room, y, nextY) {
    const dirs = [
      { dx: 1, dz: 1 },
      { dx: 1, dz: -1 },
      { dx: -1, dz: 1 },
      { dx: -1, dz: -1 },
    ];
    for (const extra of [4, 7, 10, 13]) {
      const offset = Math.max(room.halfW, room.halfD) + extra;
      for (const dir of dirs) {
        const cx = room.cx + dir.dx * offset;
        const cz = room.cz + dir.dz * offset;
        if (!this.shaftSpotFree(cx, cz, y, nextY)) continue;
        // 不能与已挖好的竖井重叠（否则会把它挖坏）
        if (this.shaftOverlapsExisting(cx, cz)) continue;
        // 不能压在同层的走廊上（否则会抽掉走廊的顶部）
        if (this.shaftOverlapsCorridor(cx, cz, y, nextY)) continue;
        // 还要保证门洞的 L 形路径不与其它房间重叠
        if (!this.doorwayFree(room, dir, offset)) continue;
        this.usedShafts.push({ cx, cz });
        return { cx, cz, dir };
      }
    }
    return null;
  }

  /**
   * 竖井位置是否与已放置的竖井重叠。
   * @param {number} cx @param {number} cz
   */
  shaftOverlapsExisting(cx, cz) {
    for (const s of this.usedShafts) {
      if (Math.abs(s.cx - cx) <= 5 && Math.abs(s.cz - cz) <= 5) return true;
    }
    return false;
  }

  /**
   * 竖井位置是否压在同层走廊上。
   * @param {number} cx @param {number} cz @param {number} y @param {number} nextY
   */
  shaftOverlapsCorridor(cx, cz, y, nextY) {
    const x0 = cx - 3;
    const x1 = cx + 3;
    const z0 = cz - 3;
    const z1 = cz + 3;
    for (const seg of this.corridorSegments) {
      if (seg.y !== y && seg.y !== nextY) continue;
      const dx = Math.sign(seg.x2 - seg.x1);
      const dz = Math.sign(seg.z2 - seg.z1);
      if (dx !== 0 && dz !== 0) continue; // 只处理与坐标轴平行的线段
      if (dx !== 0) {
        // 水平线段：z 固定
        if (seg.z1 < z0 || seg.z1 > z1) continue;
        if (Math.max(seg.x1, seg.x2) < x0 || Math.min(seg.x1, seg.x2) > x1) continue;
        return true;
      }
      if (seg.x1 < x0 || seg.x1 > x1) continue;
      if (Math.max(seg.z1, seg.z2) < z0 || Math.min(seg.z1, seg.z2) > z1) continue;
      return true;
    }
    return false;
  }

  /**
   * 门洞（L 形路径）是否安全。
   * @param {Room} room @param {{dx:number,dz:number}} dir @param {number} offset
   */
  doorwayFree(room, dir, offset) {
    const cornerX = room.cx + dir.dx * room.halfW;
    const cornerZ = room.cz + dir.dz * room.halfD;
    const entryX = room.cx + dir.dx * (offset - 2);
    const entryZ = room.cz + dir.dz * (offset - 2);
    const segs = [
      [cornerX, cornerZ, entryX, cornerZ],
      [entryX, cornerZ, entryX, entryZ],
    ];
    for (const [x1, z1, x2, z2] of segs) {
      for (const r of this.rooms) {
        if (r.floorY !== room.floor) continue;
        const minX = Math.min(x1, x2) - 1;
        const maxX = Math.max(x1, x2) + 1;
        const minZ = Math.min(z1, z2) - 1;
        const maxZ = Math.max(z1, z2) + 1;
        if (
          maxX >= r.cx - r.halfW &&
          minX <= r.cx + r.halfW &&
          maxZ >= r.cz - r.halfD &&
          minZ <= r.cz + r.halfD
        ) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * 竖井位置是否与其它房间 / 竞技场重叠。
   * @param {number} cx @param {number} cz @param {number} y @param {number} nextY
   */
  shaftSpotFree(cx, cz, y, nextY) {
    const HALF = 3; // 5×5 竖井 + 1 格余量
    const x0 = cx - HALF;
    const z0 = cz - HALF;

    // 竞技场
    if (
      x0 < ARENA_CENTER.x + ARENA_HALF + 1 &&
      x0 + HALF * 2 + 1 > ARENA_CENTER.x - ARENA_HALF - 1 &&
      z0 < ARENA_CENTER.z + ARENA_HALF + 1 &&
      z0 + HALF * 2 + 1 > ARENA_CENTER.z - ARENA_HALF - 1
    ) {
      // 竖井只在下降到竞技场那一层时需要避开
      if (nextY <= ARENA_FLOOR_Y) return false;
    }

    for (const r of this.rooms) {
      // 竖直方向是否有交集
      if (r.floorY - 1 > y || r.floorY + r.height + 1 < nextY) continue;
      if (
        x0 < r.cx + r.halfW + 1 &&
        x0 + HALF * 2 + 1 > r.cx - r.halfW - 1 &&
        z0 < r.cz + r.halfD + 1 &&
        z0 + HALF * 2 + 1 > r.cz - r.halfD - 1
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * 兜底方案：实在找不到位置时，挖一条斜向下的直通道。
   * @param {Room} room @param {number} y @param {number} nextY
   */
  carveDescentFallback(room, y, nextY) {
    const w = this.world;
    const steps = y - nextY;
    const dirX = room.cx + room.halfW < ARENA_CENTER.x ? 1 : -1;
    const startX = room.cx + dirX * (room.halfW + 1);
    const startZ = room.cz;
    for (let i = 0; i <= steps; i++) {
      const x = startX + dirX * i;
      const floorH = y - 1 - i;
      for (let oz = -1; oz <= 1; oz++) {
        w.set(x, floorH, startZ + oz, BLOCK.STEP);
        for (let h = 1; h <= 3; h++) w.set(x, floorH + h, startZ + oz, 0);
      }
      w.set(x, floorH + 1, startZ - 2, BLOCK.STEP);
      w.set(x, floorH + 1, startZ + 2, BLOCK.STEP);
    }
    const endX = startX + dirX * steps;
    const endY = y - steps;
    this.stairs = this.stairs || [];
    this.stairs.push({
      from: { x: startX - dirX, y, z: startZ },
      to: { x: endX, y: endY, z: startZ },
      nextY,
    });
  }

  /** 最底层：挖一条通往 BOSS 竞技场的通道。 */
  carveDescentToArena(rooms, y) {
    if (rooms.length === 0) return;
    const room = rooms[0];
    const targetX = ARENA_CENTER.x;
    const targetZ = ARENA_CENTER.z;

    // 从房间向竞技场方向挖水平通道
    const midX = targetX;
    this.carveTunnel(room.cx, room.cz, midX, room.cz, y);
    this.carveTunnel(midX, room.cz, midX, targetZ, y);
    this.corridorSegments.push(
      { x1: room.cx, z1: room.cz, x2: midX, z2: room.cz, y },
      { x1: midX, z1: room.cz, x2: midX, z2: targetZ, y }
    );

    this.arenaEntrance = { x: targetX, y, z: targetZ };
  }

  /* -------------------------------------------------------------- */
  /*                          BOSS 竞技场                            */
  /* -------------------------------------------------------------- */

  buildArena() {
    const w = this.world;
    const { x: cx, z: cz } = ARENA_CENTER;
    const half = ARENA_HALF;
    const floorY = ARENA_FLOOR_Y;
    // 竞技场净高必须小于「上一层地面 - 1」，否则会把上一层的房间整个挖掉
    const height = 12;

    // 地面与顶
    for (let x = cx - half; x <= cx + half; x++) {
      for (let z = cz - half; z <= cz + half; z++) {
        for (let y = floorY; y < floorY + height; y++) w.set(x, y, z, 0);
        w.set(x, floorY - 1, z, BLOCK.END_STONE);
        w.set(x, floorY + height, z, BLOCK.OBSIDIAN);
      }
    }
    // 围墙
    for (let x = cx - half - 1; x <= cx + half + 1; x++) {
      for (let z = cz - half - 1; z <= cz + half + 1; z++) {
        const onEdge =
          x === cx - half - 1 ||
          x === cx + half + 1 ||
          z === cz - half - 1 ||
          z === cz + half + 1;
        if (!onEdge) continue;
        for (let y = floorY - 1; y <= floorY + height; y++) w.set(x, y, z, BLOCK.OBSIDIAN);
      }
    }
    // 凡有走廊穿过竞技场围墙，一律开洞（走廊可能从任意一侧进入）
    this.punchArenaDoors();

    // 中央传送门 + 末影蛋
    for (let x = cx - 2; x <= cx + 2; x++) {
      for (let z = cz - 2; z <= cz + 2; z++) {
        w.set(x, floorY - 1, z, BLOCK.END_PORTAL);
      }
    }
    w.set(cx, floorY, cz, BLOCK.DRAGON_EGG);

    // 末影水晶基座（黑曜石柱），位置供 BOSS 模块使用
    /** @type {{x:number,y:number,z:number}[]} */
    this.crystalSpots = [];
    const pillarR = 17;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(a) * pillarR);
      const pz = Math.round(cz + Math.sin(a) * pillarR);
      const pHeight = 6 + (i % 3) * 2;
      for (let y = floorY; y < floorY + pHeight; y++) {
        w.set(px, y, pz, BLOCK.END_PILLAR);
      }
      w.set(px, floorY + pHeight, pz, BLOCK.END_PORTAL);
      this.crystalSpots.push({ x: px, y: floorY + pHeight + 1, z: pz });
    }

    // 竞技场内的装饰：环绕的黑曜石遗迹
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const px = Math.round(cx + Math.cos(a) * (half - 4));
      const pz = Math.round(cz + Math.sin(a) * (half - 4));
      for (let y = floorY; y < floorY + 3; y++) w.set(px, y, pz, BLOCK.OBSIDIAN);
      w.set(px, floorY + 3, pz, BLOCK.END_PORTAL);
    }
  }

  /**
   * 找到距离玩家最近的房间（用作重生点）。
   * @param {number} x @param {number} y @param {number} z
   */
  nearestRoom(x, y, z) {
    let best = null;
    let bestD = Infinity;
    for (const r of this.rooms) {
      const d = Math.abs(r.cx - x) + Math.abs(r.cz - z) + Math.abs(r.floorY - y) * 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }
}

/**
 * @typedef {object} Room
 * @property {number} cx @property {number} cz @property {number} halfW @property {number} halfD
 * @property {number} floorY @property {number} height @property {string} theme @property {number} floor
 * @property {{x:number,z:number}[]} cells
 */
