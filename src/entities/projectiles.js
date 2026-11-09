/**
 * 投射物：箭、末影龙吐息。
 * @module entities/projectiles
 */
import * as THREE from 'three';
import { raycastVoxels, rayBoxDistance, raySphereDistance } from '../core/utils.js';
import { createArrowMesh, disposeObject } from './models.js';

/**
 * 敌人的箭：抛物线明显，飞行慢，可以走位躲开。
 */
const ENEMY_ARROW_GRAVITY = 14;
/**
 * 玩家的箭：几乎平直。
 * 之前和敌人共用 14 的重力，20 米外就要抬高一米多才能打中，
 * 再叠上骷髅的全速横移，「怎么都打不中」。
 */
const PLAYER_ARROW_GRAVITY = 5;

export class Projectile {
  /**
   * @param {'arrow'|'fireball'} kind
   * @param {import('../world/world.js').World} world
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} pos @param {THREE.Vector3} vel
   * @param {{damage:number, fromPlayer:boolean, owner?:any, life?:number, pierce?:number}} opts
   */
  constructor(kind, world, scene, pos, vel, opts) {
    this.kind = kind;
    this.world = world;
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.damage = opts.damage;
    this.fromPlayer = opts.fromPlayer;
    this.owner = opts.owner || null;
    this.life = opts.life ?? 8;
    this.dead = false;
    /** 重力加速度（米/秒²）：玩家的箭近乎平直，敌人的箭是抛物线。 */
    this.gravity = opts.gravity ?? (opts.fromPlayer ? PLAYER_ARROW_GRAVITY : ENEMY_ARROW_GRAVITY);
    /** 剩余穿透次数（附魔「穿透」） */
    this.pierce = opts.pierce ?? 0;
    /** 伤害来源名称（敌人投射物用） */
    this.source = opts.source || '';
    /** 已经穿透过的目标，避免同一支箭反复命中 */
    this.pierced = new Set();

    if (kind === 'arrow') {
      this.mesh = createArrowMesh();
    } else {
      this.mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.45, 0.45),
        new THREE.MeshBasicMaterial({ color: 0xff5a1f })
      );
      this.mesh.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.7, 0.7),
          new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.4 })
        )
      );
    }
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  /** 每帧更新。 */
  update(dt, game) {
    if (this.dead) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.destroy();
      return;
    }

    const prev = this.pos.clone();
    if (this.kind === 'arrow') this.vel.y -= this.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);

    // 实体命中
    const hit = this.checkEntities(prev, game);
    if (hit) {
      this.onEntityHit(hit, game);
      return;
    }

    // 方块命中
    const dir = this.pos.clone().sub(prev);
    const dist = dir.length();
    if (dist > 1e-5) {
      dir.normalize();
      const block = raycastVoxels(
        this.world,
        prev,
        dir,
        dist + 0.35,
        (x, y, z) => this.world.isSolid(x, y, z)
      );
      if (block) {
        this.pos.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
        this.onBlockHit(game);
        return;
      }
    }

    this.mesh.position.copy(this.pos);
    if (this.kind === 'arrow') {
      this.mesh.lookAt(this.pos.clone().add(this.vel));
    } else {
      this.mesh.rotation.x += dt * 6;
      this.mesh.rotation.y += dt * 4;
    }
  }

  /**
   * 检测与敌人的碰撞。
   */
  checkEntities(prev, game) {
    const dir = this.pos.clone().sub(prev);
    const dist = dir.length();
    if (dist < 1e-5) return null;
    dir.normalize();
    const origin = prev;

    let best = null;
    let bestT = Infinity;

    const test = (t) => {
      if (!t || t.dead) return;
      // 只跳过「自己」发射的同类目标
      if (this.owner && t === this.owner) return;
      // 已经穿透过的目标不再重复命中
      if (this.pierced.has(t)) return;
      const box = t.hitBox ? t.hitBox() : t.box;
      if (!box) return;
      const d = rayBoxDistance(origin, dir, box);
      if (d < bestT && d < dist + 0.4) {
        bestT = d;
        best = t;
      }
    };

    if (this.fromPlayer) {
      // 玩家的投射物只会命中怪物
      const enemies = game.enemies ? game.enemies.enemies : null;
      if (enemies) for (const e of enemies) test(e);
      if (game.dragon && game.dragon.alive) test(game.dragon);
      if (game.crystals) for (const c of game.crystals) test(c);
    } else {
      // 敌人的投射物只会命中玩家（不会误伤玩家的小怪）
      if (game.player) test(game.player);
    }

    return best;
  }

  /** 命中实体。 */
  onEntityHit(target, game) {
    const dir = this.vel.clone().normalize();

    // 命中玩家
    if (target === game.player) {
      if (this.kind === 'fireball') {
        game.explodeFireball(this.pos, this.damage);
      } else {
        const died = game.player.applyDamage(this.damage, this.source || '敌人的箭');
        game.onPlayerHurt(this.source || '骷髅');
        if (died) game.onPlayerDeath(this.source || '骷髅');
      }
      this.destroy();
      return;
    }

    if (!this.fromPlayer) {
      // 敌人的投射物打到别的东西上直接消失
      this.destroy();
      return;
    }

    if (target.isCrystal) {
      game.onCrystalHit(target, dir);
    } else if (target === game.dragon) {
      game.onDragonHit(this.damage, dir, this);
    } else {
      game.onEnemyHit(target, this.damage, dir, this.kind === 'arrow' ? 2.5 : 4);
    }
    if (this.kind === 'fireball') {
      game.explodeFireball(this.pos, this.damage);
      this.destroy();
      return;
    }
    // 穿透：还有穿透次数则继续飞行
    if (this.pierce > 0) {
      this.pierce--;
      this.pierced.add(target);
      this.damage *= 0.85; // 穿透后伤害递减
      return;
    }
    this.destroy();
  }

  /** 命中方块。 */
  onBlockHit(game) {
    if (this.kind === 'fireball') {
      game.explodeFireball(this.pos, this.damage);
    } else {
      game.audio.arrowHit();
    }
    this.destroy();
  }

  /** 销毁。 */
  destroy() {
    this.dead = true;
    this.scene.remove(this.mesh);
    disposeObject(this.mesh);
  }
}

export class ProjectileManager {
  /**
   * @param {import('../world/world.js').World} world
   * @param {THREE.Scene} scene
   */
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    /** @type {Projectile[]} */
    this.projectiles = [];
  }

  /**
   * 发射箭。
   * @param {THREE.Vector3} pos @param {THREE.Vector3} dir @param {number} speed
   * @param {number} damage @param {boolean} fromPlayer @param {any} [owner]
   * @param {number} [pierce] 穿透次数 @param {string} [source] 伤害来源名
   */
  spawnArrow(pos, dir, speed, damage, fromPlayer, owner = null, pierce = 0, source = '') {
    const vel = dir.clone().normalize().multiplyScalar(speed);
    const p = new Projectile('arrow', this.world, this.scene, pos, vel, {
      damage,
      fromPlayer,
      owner,
      pierce,
      source,
    });
    this.projectiles.push(p);
    return p;
  }

  /**
   * 发射龙息火球。
   * @param {THREE.Vector3} pos @param {THREE.Vector3} dir @param {number} speed @param {number} damage
   * @param {string} [source] 伤害来源名
   */
  spawnFireball(pos, dir, speed, damage, source = '末影龙') {
    const vel = dir.clone().normalize().multiplyScalar(speed);
    const p = new Projectile('fireball', this.world, this.scene, pos, vel, {
      damage,
      fromPlayer: false,
      life: 6,
      source,
    });
    this.projectiles.push(p);
    return p;
  }

  /** 更新。 */
  update(dt, game) {
    for (const p of this.projectiles) {
      if (!p.dead) p.update(dt, game);
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  /** 清空。 */
  clear() {
    for (const p of this.projectiles) p.destroy();
    this.projectiles = [];
  }
}
