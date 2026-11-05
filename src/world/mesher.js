/**
 * 体素网格化：把方块数据转换成带 AO（环境光遮蔽）与平滑光照的三角面。
 * 以 16×16 的水平区块为单位构建，便于局部重建。
 * @module world/mesher
 */
import * as THREE from 'three';
import { BLOCKS, BLOCK } from './blocks.js';

const CHUNK = 16;

/** AO 等级对应的亮度系数。 */
const AO_MUL = [0.42, 0.63, 0.82, 1.0];

/**
 * 六个面：法线 n、两个切向轴 u/v、基点 base（单位立方体局部坐标）。
 * 顶点顺序：base, base+u, base+u+v, base+v（从外部看为逆时针）。
 */
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], base: [1, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], base: [0, 0, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], base: [0, 1, 0] },
  { n: [0, -1, 0], u: [0, 0, -1], v: [1, 0, 0], base: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], base: [0, 0, 1] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], base: [1, 0, 0] },
];

/** 需要放进半透明通道的方块。 */
const TRANSPARENT_IDS = new Set([BLOCK.GLASS, BLOCK.COBWEB]);

/** 可增长的顶点缓冲。 */
class VertexBuffer {
  constructor(capacity = 8192) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.uv = new Float32Array(capacity * 2);
    this.col = new Float32Array(capacity * 3);
    this.count = 0;
  }

  /** @param {number} extra */
  ensure(extra) {
    if (this.count + extra <= this.capacity) return;
    let cap = this.capacity;
    while (cap < this.count + extra) cap *= 2;
    const pos = new Float32Array(cap * 3);
    const uv = new Float32Array(cap * 2);
    const col = new Float32Array(cap * 3);
    pos.set(this.pos);
    uv.set(this.uv);
    col.set(this.col);
    this.pos = pos;
    this.uv = uv;
    this.col = col;
    this.capacity = cap;
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} u @param {number} v
   * @param {number} r @param {number} g @param {number} b
   */
  push(x, y, z, u, v, r, g, b) {
    const i = this.count++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
  }

  toGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.count * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.count * 2), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.count * 3), 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

export class WorldMesher {
  /**
   * @param {import('./world.js').World} world
   * @param {{rect:(name:string)=>{u0:number,v0:number,u1:number,v1:number}|null}} atlas
   * @param {THREE.Material} opaqueMaterial
   * @param {THREE.Material} transparentMaterial
   */
  constructor(world, atlas, opaqueMaterial, transparentMaterial) {
    this.world = world;
    this.atlas = atlas;
    this.opaqueMaterial = opaqueMaterial;
    this.transparentMaterial = transparentMaterial;
    /** @type {THREE.Group} */
    this.group = new THREE.Group();
    this.group.name = 'voxel-world';
    /** @type {Map<string, THREE.Mesh[]>} */
    this.chunks = new Map();
  }

  /** 世界水平区块数量 */
  get chunkCountX() {
    return Math.ceil(this.world.width / CHUNK);
  }

  get chunkCountZ() {
    return Math.ceil(this.world.depth / CHUNK);
  }

  /** 构建全部区块。 */
  buildAll() {
    for (let cz = 0; cz < this.chunkCountZ; cz++) {
      for (let cx = 0; cx < this.chunkCountX; cx++) {
        this.buildChunk(cx, cz);
      }
    }
    return this.group;
  }

  /**
   * 构建（或重建）一个区块的网格。
   * @param {number} cx @param {number} cz
   */
  buildChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const existing = this.chunks.get(key);
    if (existing) {
      for (const mesh of existing) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
      }
    }

    const opaque = new VertexBuffer();
    const transparent = new VertexBuffer();

    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const x1 = Math.min(x0 + CHUNK, this.world.width);
    const z1 = Math.min(z0 + CHUNK, this.world.depth);

    for (let y = 0; y < this.world.height; y++) {
      for (let z = z0; z < z1; z++) {
        for (let x = x0; x < x1; x++) {
          const id = this.world.get(x, y, z);
          if (id === 0) continue;
          const def = BLOCKS[id];
          const buf = TRANSPARENT_IDS.has(id) ? transparent : opaque;
          if (def.shape === 'torch') {
            this.emitTorch(buf, x, y, z, id, def);
          } else if (def.shape === 'chest') {
            this.emitBox(buf, x, y, z, id, def, [0.0625, 0, 0.0625], [0.9375, 0.625, 0.9375]);
          } else if (def.shape === 'cross') {
            this.emitCross(buf, x, y, z, def);
          } else {
            this.emitCube(buf, x, y, z, id, def);
          }
        }
      }
    }

    /** @type {THREE.Mesh[]} */
    const meshes = [];
    if (opaque.count > 0) {
      const mesh = new THREE.Mesh(opaque.toGeometry(), this.opaqueMaterial);
      mesh.name = `chunk-opaque-${key}`;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    if (transparent.count > 0) {
      const mesh = new THREE.Mesh(transparent.toGeometry(), this.transparentMaterial);
      mesh.name = `chunk-transparent-${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    this.chunks.set(key, meshes);
  }

  /** 某坐标变更后重建所在区块。 */
  rebuildAround(x, y, z) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    this.buildChunk(cx, cz);
  }

  /* -------------------------------------------------------------- */
  /*                          具体生成逻辑                           */
  /* -------------------------------------------------------------- */

  /**
   * 该方块与邻居之间是否需要生成面。
   * @param {number} x @param {number} y @param {number} z @param {number} id
   */
  faceVisible(x, y, z, id) {
    if (!this.world.inBounds(x, y, z)) return false;
    const nid = this.world.get(x, y, z);
    if (nid === 0) return true;
    if (nid === id) return false;
    return !BLOCKS[nid].opaque;
  }

  /**
   * 取得某格的 0-1 光照值。
   * @param {number} x @param {number} y @param {number} z
   */
  lightAt(x, y, z) {
    if (!this.world.inBounds(x, y, z)) return 0;
    const i = this.world.index(x, y, z);
    return Math.max(this.world.skyLight[i], this.world.blockLight[i]) / 15;
  }

  /**
   * 计算某个面某个顶点的光照（含 AO）。
   * @param {number} x @param {number} y @param {number} z
   * @param {{n:number[],u:number[],v:number[]}} face
   * @param {number} i @param {number} j
   */
  cornerLight(x, y, z, face, i, j) {
    const du = i ? 1 : -1;
    const dv = j ? 1 : -1;
    const nx = x + face.n[0];
    const ny = y + face.n[1];
    const nz = z + face.n[2];
    const ux = face.u[0];
    const uy = face.u[1];
    const uz = face.u[2];
    const vx = face.v[0];
    const vy = face.v[1];
    const vz = face.v[2];

    const s1x = nx + ux * du;
    const s1y = ny + uy * du;
    const s1z = nz + uz * du;
    const s2x = nx + vx * dv;
    const s2y = ny + vy * dv;
    const s2z = nz + vz * dv;
    const cx = s1x + vx * dv;
    const cy = s1y + vy * dv;
    const cz = s1z + vz * dv;

    const s1 = this.world.isOpaque(s1x, s1y, s1z) ? 1 : 0;
    const s2 = this.world.isOpaque(s2x, s2y, s2z) ? 1 : 0;
    const cr = this.world.isOpaque(cx, cy, cz) ? 1 : 0;
    const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);

    const light =
      (this.lightAt(nx, ny, nz) +
        this.lightAt(s1x, s1y, s1z) +
        this.lightAt(s2x, s2y, s2z) +
        this.lightAt(cx, cy, cz)) /
      4;

    return light * AO_MUL[ao];
  }

  /**
   * 生成一个完整立方体的可见面。
   */
  emitCube(buf, x, y, z, id, def) {
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const nx = x + face.n[0];
      const ny = y + face.n[1];
      const nz = z + face.n[2];
      if (!this.faceVisible(nx, ny, nz, id)) continue;
      const rect = this.atlas.rect(def.tex[f]);
      if (!rect) continue;
      this.pushFace(buf, x, y, z, face, rect, face.base, face.u, face.v, true);
    }
  }

  /**
   * 生成小尺寸方块（火把、箱子）。
   */
  emitBox(buf, x, y, z, id, def, min, max) {
    const sx = max[0] - min[0];
    const sy = max[1] - min[1];
    const sz = max[2] - min[2];
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const nx = x + face.n[0];
      const ny = y + face.n[1];
      const nz = z + face.n[2];
      if (!this.faceVisible(nx, ny, nz, id)) continue;
      const rect = this.atlas.rect(def.tex[f]);
      if (!rect) continue;
      const base = [
        min[0] + face.base[0] * sx,
        min[1] + face.base[1] * sy,
        min[2] + face.base[2] * sz,
      ];
      const u = [face.u[0] * sx, face.u[1] * sy, face.u[2] * sz];
      const v = [face.v[0] * sx, face.v[1] * sy, face.v[2] * sz];
      this.pushFace(buf, x, y, z, face, rect, base, u, v, false);
    }
  }

  /**
   * 火把：细长小方块。
   */
  emitTorch(buf, x, y, z, id, def) {
    this.emitBox(buf, x, y, z, id, def, [0.4375, 0, 0.4375], [0.5625, 0.625, 0.5625]);
  }

  /**
   * 交叉面（蜘蛛网）。
   */
  emitCross(buf, x, y, z, def) {
    const rect = this.atlas.rect(def.tex[0]);
    if (!rect) return;
    const light = this.lightAt(x, y, z);
    const planes = [
      [
        [0.15, 0, 0.15],
        [0.85, 0, 0.85],
        [0.85, 1, 0.85],
        [0.15, 1, 0.15],
      ],
      [
        [0.85, 0, 0.15],
        [0.15, 0, 0.85],
        [0.15, 1, 0.85],
        [0.85, 1, 0.15],
      ],
    ];
    for (const p of planes) {
      for (let side = 0; side < 2; side++) {
        const q = side === 0 ? p : [p[3], p[2], p[1], p[0]];
        buf.ensure(6);
        const uvs = [
          [rect.u0, rect.v0],
          [rect.u1, rect.v0],
          [rect.u1, rect.v1],
          [rect.u0, rect.v1],
        ];
        for (const i of [0, 1, 2, 0, 2, 3]) {
          buf.push(
            x + q[i][0],
            y + q[i][1],
            z + q[i][2],
            uvs[i][0],
            uvs[i][1],
            light,
            light,
            light
          );
        }
      }
    }
  }

  /**
   * 推入一个四边形（非索引几何体需要显式的两个三角形，共 6 个顶点）。
   * @param {VertexBuffer} buf
   * @param {number} x @param {number} y @param {number} z
   * @param {{n:number[],u:number[],v:number[]}} face
   * @param {{u0:number,v0:number,u1:number,v1:number}} rect
   * @param {number[]} base @param {number[]} u @param {number[]} v
   * @param {boolean} smooth 是否使用平滑光照与 AO
   */
  pushFace(buf, x, y, z, face, rect, base, u, v, smooth) {
    const corners = [
      [base[0], base[1], base[2]],
      [base[0] + u[0], base[1] + u[1], base[2] + u[2]],
      [base[0] + u[0] + v[0], base[1] + u[1] + v[1], base[2] + u[2] + v[2]],
      [base[0] + v[0], base[1] + v[1], base[2] + v[2]],
    ];
    const uvs = [
      [rect.u0, rect.v0],
      [rect.u1, rect.v0],
      [rect.u1, rect.v1],
      [rect.u0, rect.v1],
    ];
    const ij = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    // 顶点顺序：0-1-2 与 0-2-3 两个三角形
    const order = [0, 1, 2, 0, 2, 3];
    buf.ensure(6);
    for (const i of order) {
      const light = smooth
        ? this.cornerLight(x, y, z, face, ij[i][0], ij[i][1])
        : this.lightAt(x, y, z);
      buf.push(
        x + corners[i][0],
        y + corners[i][1],
        z + corners[i][2],
        uvs[i][0],
        uvs[i][1],
        light,
        light,
        light
      );
    }
  }
}
