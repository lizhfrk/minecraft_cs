/**
 * 体素世界：方块存储 + 天光/块光传播。
 * @module world/world
 */
import { BLOCKS, BLOCK, isOpaque, lightOf } from './blocks.js';

export class World {
  /**
   * @param {number} width @param {number} height @param {number} depth
   */
  constructor(width, height, depth) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.size = width * height * depth;
    /** @type {Uint8Array} */
    this.blocks = new Uint8Array(this.size);
    /** 天光 0-15 */
    this.skyLight = new Uint8Array(this.size);
    /** 方块光（火把/岩浆）0-15 */
    this.blockLight = new Uint8Array(this.size);
    /** 特殊方块元数据（箱子战利品等），key = 索引 */
    this.meta = new Map();
    /** 刷怪笼位置 */
    this.spawners = [];
  }

  /** @param {number} x @param {number} y @param {number} z */
  index(x, y, z) {
    return (y * this.depth + z) * this.width + x;
  }

  /** @param {number} x @param {number} y @param {number} z */
  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.width && y < this.height && z < this.depth;
  }

  /** @param {number} x @param {number} y @param {number} z @returns {number} */
  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.blocks[this.index(x, y, z)];
  }

  /**
   * @param {number} x @param {number} y @param {number} z @param {number} id
   * @returns {number} 被替换掉的方块 id
   */
  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return 0;
    const i = this.index(x, y, z);
    const prev = this.blocks[i];
    this.blocks[i] = id;
    if (id === BLOCK.SPAWNER && prev !== BLOCK.SPAWNER) {
      this.spawners.push({ x, y, z });
    } else if (prev === BLOCK.SPAWNER && id !== BLOCK.SPAWNER) {
      // 刷怪笼被挖掉后要停止刷怪
      const k = this.spawners.findIndex((s) => s.x === x && s.y === y && s.z === z);
      if (k >= 0) this.spawners.splice(k, 1);
    }
    return prev;
  }

  /** @param {number} x @param {number} y @param {number} z */
  isSolid(x, y, z) {
    const id = this.get(x, y, z);
    return id !== 0 && BLOCKS[id].solid;
  }

  /** @param {number} x @param {number} y @param {number} z */
  isOpaque(x, y, z) {
    const id = this.get(x, y, z);
    return id !== 0 && BLOCKS[id].opaque;
  }

  /** @param {number} x @param {number} y @param {number} z */
  isAir(x, y, z) {
    return this.get(x, y, z) === 0;
  }

  /* -------------------------------------------------------------- */
  /*                            光照计算                             */
  /* -------------------------------------------------------------- */

  /** 计算天光：每列自顶向下，遇到不透明方块后全列熄灭。 */
  computeSkyLight() {
    const { width, height, depth, blocks, skyLight } = this;
    skyLight.fill(0);
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        let level = 15;
        for (let y = height - 1; y >= 0; y--) {
          const i = (y * depth + z) * width + x;
          const id = blocks[i];
          if (id !== 0 && isOpaque(id)) {
            level = 0;
            skyLight[i] = 0;
            continue;
          }
          skyLight[i] = level;
          if (id !== 0 && BLOCKS[id].light > 0) level = 0;
        }
      }
    }
  }

  /** 计算方块光：多源 BFS 泛洪。 */
  computeBlockLight() {
    const { width, height, depth, blocks, blockLight } = this;
    blockLight.fill(0);
    const size = this.size;
    /** @type {Int32Array} */
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;

    for (let i = 0; i < size; i++) {
      const l = lightOf(blocks[i]);
      if (l > 0) {
        blockLight[i] = l;
        queue[tail++] = i;
      }
    }

    const neighbors = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    while (head < tail) {
      const i = queue[head++];
      const level = blockLight[i];
      if (level <= 1) continue;
      const x = i % width;
      const z = Math.floor(i / width) % depth;
      const y = Math.floor(i / (width * depth));
      for (const [dx, dy, dz] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= width || ny >= height || nz >= depth) continue;
        const ni = (ny * depth + nz) * width + nx;
        if (isOpaque(blocks[ni])) continue;
        // 向下传播衰减更快（近似 Minecraft）
        const next = level - (dy < 0 ? 2 : 1);
        if (next > blockLight[ni]) {
          blockLight[ni] = next;
          queue[tail++] = ni;
        }
      }
    }
  }

  /**
   * 取某个格子的光照强度（0-1），用于渲染与实体亮度。
   * @param {number} x @param {number} y @param {number} z
   */
  lightAt(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    const i = this.index(x, y, z);
    return Math.max(this.skyLight[i], this.blockLight[i]) / 15;
  }

  /** 重新计算光照（方块改动后调用）。 */
  relight() {
    this.computeSkyLight();
    this.computeBlockLight();
  }
}
