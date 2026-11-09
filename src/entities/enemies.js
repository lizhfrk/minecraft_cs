/**
 * 敌人：僵尸、骷髅、苦力怕、蜘蛛。
 * @module entities/enemies
 */
import * as THREE from 'three';
import { moveBody } from '../world/physics.js';
import { clamp, raycastVoxels } from '../core/utils.js';
import { NEARBY_RADIUS, NEARBY_Y_TOLERANCE } from '../core/difficulty.js';
import {
  createZombie,
  createSkeleton,
  createCreeper,
  createSpider,
  disposeObject,
} from './models.js';

/** @type {Record<string, any>} */
export const ENEMY_TYPES = {
  zombie: {
    label: '僵尸',
    hp: 20,
    speed: 2.5,
    damage: 3,
    attackRange: 1.9,
    attackCooldown: 1.0,
    aggroRange: 18,
    halfWidth: 0.3,
    height: 1.9,
    xp: 5,
    drops: [
      { item: 'bread', chance: 0.16 },
      { item: 'iron', chance: 0.1 },
    ],
  },
  skeleton: {
    label: '骷髅',
    hp: 16,
    speed: 2.9,
    damage: 2,
    attackRange: 1.9,
    attackCooldown: 1.0,
    aggroRange: 22,
    halfWidth: 0.3,
    height: 1.9,
    ranged: true,
    /** 骷髅的箭造成的伤害（会再乘难度倍率）。 */
    arrowDamage: 4,
    /**
     * 保持距离的上限（米）：比这更远就主动靠近。
     */
    preferredMax: 11,
    /**
     * 玩家贴到这个距离以内时，骷髅改用近战还手，不再后退。
     * 必须小于玩家的近战射程（铁剑 3.4），否则骷髅永远在后退，
     * 玩家连碰都碰不到 —— 「射箭的骷髅摸不到他」就是这里造成的死循环。
     */
    meleeReach: 3.2,
    /** 横向游走的速度倍率：全速横移的骷髅几乎用箭打不中。 */
    strafeSpeed: 0.55,
    shotCooldown: 2.1,
    xp: 7,
    drops: [
      { item: 'arrow', chance: 0.85, count: [2, 5] },
      { item: 'bone', chance: 0.2 },
    ],
  },
  creeper: {
    label: '苦力怕',
    hp: 16,
    speed: 2.4,
    damage: 9,
    attackRange: 3.2,
    attackCooldown: 2.0,
    aggroRange: 16,
    halfWidth: 0.3,
    height: 1.6,
    exploder: true,
    fuse: 1.4,
    xp: 9,
    drops: [{ item: 'gold', chance: 0.2 }],
  },
  spider: {
    label: '蜘蛛',
    hp: 12,
    speed: 3.9,
    damage: 2,
    attackRange: 1.8,
    attackCooldown: 0.8,
    aggroRange: 12,
    halfWidth: 0.4,
    height: 1.0,
    neutral: true,
    xp: 6,
    drops: [
      { item: 'arrow', chance: 0.45, count: [1, 3] },
      { item: 'bread', chance: 0.12 },
    ],
  },
};

const FLASH_MATERIAL = new THREE.MeshLambertMaterial({ color: 0xff4444 });
// 共享材质：实体销毁时不能 dispose
FLASH_MATERIAL.userData.shared = true;

/** 敌人唯一编号（便于调试与测试定位）。 */
let enemyIdCounter = 0;

/**
 * 离玩家超过这个距离（米）的「刷怪笼产物」会被回收。
 * 没有它，离开的房间里的怪会一直留在原地 —— 来回跑几趟全局怪数就堆上去了，
 * 而且每只残留怪每帧都要跑 AI 和体素物理。
 *
 * 房间初始预置的怪带 persistent 标记，不会被回收：
 * 没有刷怪笼的房间一旦被清空就再也不会有怪了。
 */
const DESPAWN_DISTANCE = 70;

export class Enemy {
  /**
   * @param {string} type @param {import('../world/world.js').World} world
   * @param {THREE.Scene} scene
   * @param {number} x @param {number} y @param {number} z
   * @param {object} [assets] 贴图资源
   */
  constructor(type, world, scene, x, y, z, assets = {}) {
    this.type = type;
    this.id = ++enemyIdCounter;
    this.def = ENEMY_TYPES[type];
    this.world = world;
    this.scene = scene;

    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.dead = false;
    this.removed = false;
    this.onGround = false;
    this.attackTimer = 0;
    this.shotTimer = 1 + Math.random();
    this.fuse = -1;
    this.aggro = false;
    this.hurtTimer = 0;
    this.walkPhase = Math.random() * 10;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.attackAnim = 0;
    /** 燃烧状态（火焰附魔）：{timer, tick, dps} */
    this.burn = null;
    /** 房间初始预置的怪：不会被远距离回收（那些房间没有刷怪笼）。 */
    this.persistent = false;

    this.buildModel(assets);

    this.healthBar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xd03030 })
    );
    fill.position.z = 0.01;
    this.healthFill = fill;
    this.healthBar.add(bg);
    this.healthBar.add(fill);
    this.healthBar.visible = false;
    this.healthBar.renderOrder = 5;
    scene.add(this.healthBar);

    this.group = this.model.group;
    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** 构建模型。 */
  buildModel(assets) {
    switch (this.type) {
      case 'zombie':
        this.model = createZombie(assets.zombieFace);
        break;
      case 'skeleton':
        this.model = createSkeleton(assets.skeletonFace);
        break;
      case 'creeper':
        this.model = createCreeper(assets.creeperFace);
        break;
      case 'spider':
      default:
        this.model = createSpider();
        break;
    }
  }

  /** 碰撞包围盒。 */
  get box() {
    const hw = this.def.halfWidth;
    const h = this.def.height;
    return {
      minX: this.pos.x - hw,
      maxX: this.pos.x + hw,
      minY: this.pos.y,
      maxY: this.pos.y + h,
      minZ: this.pos.z - hw,
      maxZ: this.pos.z + hw,
    };
  }

  /** 中心点。 */
  get center() {
    return {
      x: this.pos.x,
      y: this.pos.y + this.def.height * 0.6,
      z: this.pos.z,
    };
  }

  /**
   * 受到伤害。
   * @param {number} amount @param {number} [knockback] @param {THREE.Vector3} [dir]
   * @returns {boolean} 是否死亡
   */
  takeDamage(amount, knockback = 0, dir = null) {
    if (this.dead) return false;
    this.hp -= amount;
    this.hurtTimer = 0.18;
    this.aggro = true;
    if (knockback > 0 && dir) {
      this.vel.x += dir.x * knockback;
      this.vel.z += dir.z * knockback;
      this.vel.y = Math.max(this.vel.y, 3.4);
    }
    this.healthBar.visible = true;
    this.flash();
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  /** 受击闪红。 */
  flash() {
    this.model.group.traverse((o) => {
      if (o.isMesh) {
        if (!o.userData.origMaterial) o.userData.origMaterial = o.material;
        o.material = FLASH_MATERIAL;
      }
    });
  }

  /** 恢复原材质。 */
  restoreMaterials() {
    this.model.group.traverse((o) => {
      if (o.isMesh && o.userData.origMaterial) o.material = o.userData.origMaterial;
    });
  }

  /**
   * 到自己与玩家之间是否通视（中间没有实心方块）。
   * 没有这道判定，骷髅会隔着墙放箭 —— 「难度太高」的一大来源。
   * @param {import('./player.js').Player} player
   * @returns {boolean}
   */
  hasLineOfSight(player) {
    const ox = this.pos.x;
    const oy = this.pos.y + this.def.height * 0.75;
    const oz = this.pos.z;
    const dx = player.pos.x - ox;
    const dy = player.pos.y + 1.1 - oy;
    const dz = player.pos.z - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001) return true;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    // 起点所在的那一格不算遮挡：骷髅站在门框边时起点可能是实心方块
    const sx = Math.floor(ox);
    const sy = Math.floor(oy);
    const sz = Math.floor(oz);
    const hit = raycastVoxels(
      this.world,
      { x: ox, y: oy, z: oz },
      dir,
      len,
      (x, y, z) => {
        if (x === sx && y === sy && z === sz) return false;
        return this.world.isSolid(x, y, z);
      }
    );
    return !hit;
  }

  /**
   * 每帧更新。
   * @param {number} dt @param {import('./player.js').Player} player @param {object} game
   */
  update(dt, player, game) {
    if (this.dead) return;
    const def = this.def;
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dy = player.pos.y - this.pos.y;
    const dist = Math.hypot(dx, dz);

    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this.restoreMaterials();
    }
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;

    // 仇恨判定
    if (def.neutral) {
      if (this.aggro && dist > 24) this.aggro = false;
    } else if (dist < def.aggroRange && Math.abs(dy) < 12) {
      this.aggro = true;
    }

    const speed = def.speed;
    let wishX = 0;
    let wishZ = 0;

    if (this.aggro && player.health > 0) {
      const invDist = dist > 0.001 ? 1 / dist : 0;
      const nx = dx * invDist;
      const nz = dz * invDist;

      if (def.exploder) {
        if (dist < def.attackRange) {
          if (this.fuse < 0) {
            this.fuse = def.fuse;
            game.audio.creeperHiss();
          }
        }
        if (this.fuse < 0) {
          wishX = nx;
          wishZ = nz;
        }
      } else if (def.ranged) {
        this.shotTimer -= dt;
        // 玩家已经贴到近战距离内：压上去拼近战，不再后退。
        // 这一段是「骷髅摸不到他」的解药 —— 原来这里无条件后退，
        // 玩家在 3.4 米的剑够不到，骷髅在 6 米外一直退，两人永远碰不上。
        const inMelee = dist < def.meleeReach;
        if (dist > def.preferredMax) {
          wishX = nx;
          wishZ = nz;
        } else if (inMelee) {
          wishX = nx;
          wishZ = nz;
        } else {
          const strafe = def.strafeSpeed ?? 1;
          wishX = -nz * this.strafeDir * strafe;
          wishZ = nx * this.strafeDir * strafe;
        }
        if (dist < def.attackRange) {
          // 贴脸了就不用箭了，改用近战 —— 免得玩家被近距离速射
          if (this.attackTimer <= 0) {
            this.attackTimer = def.attackCooldown;
            this.attackAnim = 0.25;
            const damage = def.damage * (game.difficulty?.damageScale ?? 1);
            const died = player.applyDamage(damage, def.label);
            game.audio.hurt();
            game.onPlayerHurt(def.label);
            if (died) game.onPlayerDeath(def.label);
          }
        } else if (
          this.shotTimer <= 0 &&
          dist < 20 &&
          Math.abs(dy) < 12 &&
          this.hasLineOfSight(player)
        ) {
          this.shotTimer = def.shotCooldown;
          game.spawnEnemyArrow(this, player);
        }
      } else {
        if (dist > def.attackRange * 0.8) {
          wishX = nx;
          wishZ = nz;
        } else if (this.attackTimer <= 0) {
          this.attackTimer = def.attackCooldown;
          this.attackAnim = 0.25;
          const damage = def.damage * (game.difficulty?.damageScale ?? 1);
          const hpBefore = player.health;
          const died = player.applyDamage(damage, def.label);
          game.audio.hurt();
          game.onPlayerHurt(def.label);
          if (died) game.onPlayerDeath(def.label);
          // 荆棘：把伤害反弹回去 —— 只在真的打中了才反（无敌帧期间伤害没生效）
          const thorns = player.armorThorns || 0;
          if (thorns > 0 && player.health < hpBefore) {
            const tDied = this.takeDamage(thorns, 0, null);
            game.spawnParticles?.(this.center, 0x9cff4d, 5);
            if (tDied && game.onEnemyKilled) game.onEnemyKilled(this);
          }
        }
      }
    }

    // 燃烧（火焰附魔）：每秒掉血
    if (this.burn) {
      this.burn.timer -= dt;
      this.burn.tick -= dt;
      if (this.burn.tick <= 0) {
        this.burn.tick = 1;
        const died = this.takeDamage(this.burn.dps, 0, null);
        if (game.spawnParticles) game.spawnParticles(this.center, 0xff7a1a, 3, { speed: 1.2 });
        if (died && game.onEnemyKilled) game.onEnemyKilled(this);
      }
      if (this.burn.timer <= 0) this.burn = null;
    }

    // 苦力怕引信
    if (this.fuse >= 0) {
      this.fuse -= dt;
      const s = 1 + Math.sin(this.fuse * 24) * 0.12;
      this.model.group.scale.set(s, s, s);
      if (this.fuse <= 0) {
        game.explodeCreeper(this);
        return;
      }
    }

    // 速度与朝向
    const targetSpeed = this.aggro ? speed : 0;
    this.vel.x += (wishX * targetSpeed - this.vel.x) * Math.min(1, dt * 8);
    this.vel.z += (wishZ * targetSpeed - this.vel.z) * Math.min(1, dt * 8);
    if (wishX !== 0 || wishZ !== 0) {
      const targetYaw = Math.atan2(wishX, wishZ);
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * 8);
    }

    const res = moveBody(
      this.world,
      this.pos,
      this.vel,
      dt,
      def.halfWidth,
      def.height,
      {
        gravity: 26,
        stepUp: this.type !== 'spider',
        // 只有站在地面上才允许上台阶，否则腾空时会「凭空升高」
        grounded: this.onGround,
      }
    );
    this.onGround = res.onGround;

    // 动画
    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * moving * 2.4;
    this.animate(dt, moving);

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // 血条（始终朝向相机）
    if (this.healthBar.visible) {
      this.healthBar.position.set(
        this.pos.x,
        this.pos.y + this.def.height + 0.35,
        this.pos.z
      );
      if (game.camera) this.healthBar.quaternion.copy(game.camera.quaternion);
      this.healthFill.scale.x = Math.max(0, this.hp / this.maxHp);
      this.healthFill.position.x = -(1 - this.healthFill.scale.x) * 0.48;
    }
  }

  /**
   * 动画：手臂与腿的摆动。
   */
  animate(dt, moving) {
    const p = this.model.parts;
    const swing = Math.sin(this.walkPhase) * (moving > 0.2 ? 0.85 : 0.06);
    if (p.legL) p.legL.rotation.x = swing;
    if (p.legR) p.legR.rotation.x = -swing;
    if (p.armL) p.armL.rotation.x = -Math.PI / 2.1 + swing * 0.35;
    if (p.armR) p.armR.rotation.x = -Math.PI / 2.1 - swing * 0.35;

    if (p.legs) {
      p.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(this.walkPhase * 1.4 + i) * 0.5 * (moving > 0.2 ? 1 : 0.1);
      });
    }
    if (p.head) {
      p.head.rotation.y = Math.sin(this.walkPhase * 0.5) * 0.12;
    }
    if (this.attackAnim > 0) {
      const t = this.attackAnim / 0.25;
      if (p.armR) p.armR.rotation.x = -Math.PI / 2.1 - Math.sin(t * Math.PI) * 1.6;
    }
  }

  /** 移除。 */
  dispose() {
    // 可能被调用两次（自爆流程显式 dispose 一次，之后 update 里又按 dead 兜底一次）
    if (this.removed) return;
    this.scene.remove(this.group);
    this.scene.remove(this.healthBar);
    // 共享材质不能释放，否则会影响其它敌人
    disposeObject(this.group);
    this.healthBar.children.forEach((c) => {
      c.geometry?.dispose();
      if (c.material && !c.material.userData?.shared) c.material.dispose();
    });
    this.removed = true;
  }
}

export class EnemyManager {
  /**
   * @param {import('../world/world.js').World} world
   * @param {THREE.Scene} scene
   */
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    /** @type {Enemy[]} */
    this.enemies = [];
    this.assets = {};
  }

  /** 设置贴图资源。 */
  setAssets(assets) {
    this.assets = assets;
  }

  /**
   * 生成一个敌人。
   * @param {string} type @param {number} x @param {number} y @param {number} z
   */
  spawn(type, x, y, z) {
    const e = new Enemy(type, this.world, this.scene, x, y, z, this.assets);
    this.enemies.push(e);
    return e;
  }

  /**
   * 更新所有敌人与刷怪笼。
   * @param {number} dt @param {import('./player.js').Player} player @param {object} game
   */
  update(dt, player, game) {
    const despawnSq = DESPAWN_DISTANCE * DESPAWN_DISTANCE;
    for (const e of this.enemies) {
      if (e.dead) {
        e.dispose();
        continue;
      }
      // 离得太远的「刷怪笼产物」直接回收，避免离开的房间越堆越多
      if (!e.persistent && e.pos.distanceToSquared(player.pos) > despawnSq) {
        e.dispose();
        continue;
      }
      e.update(dt, player, game);
    }
    this.enemies = this.enemies.filter((e) => !e.removed);

    this.updateSpawners(dt, player, game);
  }

  /**
   * 刷怪笼按距离玩家远近生成小怪。
   *
   * 四道闸门保证怪物不会无限堆积：
   * 1. 玩家身边（30 米内）的怪不超过难度的 maxNearby；
   * 2. 刷怪笼附近（12 米内）的怪不超过难度的 maxPerSpawner；
   * 3. 新怪不能和别的怪重叠成一堆，也不能直接刷在玩家脸上；
   * 4. 刷怪间隔由难度决定，并且带随机浮动，避免整片房间同时开刷。
   */
  updateSpawners(dt, player, game) {
    const diff = game.difficulty;
    for (const s of this.world.spawners) {
      const d = Math.hypot(player.pos.x - s.x, player.pos.y - s.y, player.pos.z - s.z);
      // 计时器直接挂在刷怪笼身上：笼子被挖掉，计时器也就一起没了
      let timer = s.timer ?? diff.spawnInterval * 0.5;
      timer -= dt;
      if (timer <= 0) {
        if (d >= diff.spawnRadius) {
          // 玩家不在附近：轮询即可，不必频繁重置成完整间隔
          timer = 3;
        } else if (
          this.countNear(
            player.pos.x,
            player.pos.y,
            player.pos.z,
            NEARBY_RADIUS,
            NEARBY_Y_TOLERANCE
          ) >= diff.maxNearby
        ) {
          // 身边的怪已经够多了：短暂等待，玩家清掉一只就能很快补上
          timer = 2;
        } else if (this.countNear(s.x, s.y, s.z, 12) >= diff.maxPerSpawner) {
          // 刷怪笼附近已经很热闹了，先别再加
          timer = 4;
        } else {
          const spot = this.pickSpawnSpot(s, player);
          if (spot) {
            this.spawn(game.randomEnemyType(), spot[0], spot[1], spot[2]);
            timer = diff.spawnInterval + Math.random() * diff.spawnJitter;
          } else {
            timer = 3;
          }
        }
      }
      s.timer = timer;
    }
  }

  /**
   * 统计某个点附近（水平 + 垂直）的敌人数量。
   * @param {number} x @param {number} y @param {number} z @param {number} radius 水平半径
   * @param {number} [yTol] 垂直容差；不传时取半径的 0.6 倍
   * @returns {number}
   */
  countNear(x, y, z, radius, yTol = radius * 0.6) {
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (
        Math.abs(e.pos.x - x) <= radius &&
        Math.abs(e.pos.z - z) <= radius &&
        Math.abs(e.pos.y - y) <= yTol
      ) {
        n++;
      }
    }
    return n;
  }

  /**
   * 在刷怪笼四周挑一个能站的空位：不能和别的怪叠在一起，也不能贴着玩家脸。
   * @param {{x:number,y:number,z:number}} s
   * @param {import('./player.js').Player} player
   * @returns {[number,number,number]|null}
   */
  pickSpawnSpot(s, player) {
    const offsets = [
      [1.5, 1.5],
      [-1.5, 1.5],
      [1.5, -1.5],
      [-1.5, -1.5],
      [2.5, 0],
      [-2.5, 0],
      [0, 2.5],
      [0, -2.5],
    ];
    // 随机起点，避免每次都从同一个角开始
    const start = Math.floor(Math.random() * offsets.length);
    for (let i = 0; i < offsets.length; i++) {
      const [ox, oz] = offsets[(start + i) % offsets.length];
      const x = s.x + ox;
      const z = s.z + oz;
      if (this.world.get(Math.floor(x), Math.floor(s.y), Math.floor(z)) !== 0) continue;
      // 不要直接刷在玩家脸上
      if (Math.hypot(x - player.pos.x, z - player.pos.z) < 5) continue;
      // 不要和已有的怪叠在一起
      if (this.countNear(x, s.y, z, 2) > 0) continue;
      return [x, s.y, z];
    }
    return null;
  }

  /** 清空。 */
  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
  }
}
