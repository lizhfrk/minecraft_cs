/**
 * BOSS：末影龙与末影水晶。
 * 玩法还原 Minecraft：射碎水晶柱上的末影水晶以阻断回血，末影龙栖息时可被近战攻击。
 * @module entities/dragon
 */
import * as THREE from 'three';
import { createDragon, createEndCrystal, disposeObject } from './models.js';
import { clamp } from '../core/utils.js';

/** 末影水晶。 */
export class EndCrystal {
  /**
   * @param {THREE.Scene} scene @param {object} assets
   * @param {number} x @param {number} y @param {number} z
   * @param {boolean} floating 是否为掉落的治疗水晶
   * @param {number} [floorY] 治疗水晶最终落到的地面高度（竞技场地面）
   */
  constructor(scene, assets, x, y, z, floating = false, floorY = null) {
    this.scene = scene;
    this.pos = new THREE.Vector3(x, y, z);
    this.floating = floating;
    this.alive = true;
    this.isCrystal = true;
    this.dead = false;
    this.age = Math.random() * 6;
    this.healTimer = 0;
    this.vel = new THREE.Vector3(0, floating ? 0.5 : 0, 0);
    this.groundY = null;
    /** 指定落地高度时，水晶会一直落到该高度（避免停在高高的柱顶上） */
    this.floorY = floorY;

    this.model = createEndCrystal(assets.crystal);
    this.group = this.model.group;
    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  /** 碰撞盒。 */
  hitBox() {
    return {
      minX: this.pos.x - 0.55,
      maxX: this.pos.x + 0.55,
      minY: this.pos.y - 0.2,
      maxY: this.pos.y + 1.3,
      minZ: this.pos.z - 0.55,
      maxZ: this.pos.z + 0.55,
    };
  }

  /**
   * @param {number} dt @param {object} game
   */
  update(dt, game) {
    this.age += dt;
    this.group.rotation.y = this.age * 1.4;
    const bob = Math.sin(this.age * 2.2) * 0.12;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);

    if (this.floating) {
      // 掉落的治疗水晶：缓慢下落，接触地面后漂浮并持续为末影龙回血
      this.vel.y -= 8 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.floorY !== null) {
        // 指定了竞技场地面：一直落到地面，不停在柱顶
        if (this.pos.y <= this.floorY + 0.15) {
          this.pos.y = this.floorY + 0.15;
          this.vel.y = 0;
        }
      } else {
        const ground = game.solidTopAt(this.pos.x, this.pos.z, this.pos.y);
        if (ground !== null && this.pos.y <= ground) {
          this.pos.y = ground;
          this.vel.y = 0;
        }
      }
      this.healTimer += dt;
      if (this.healTimer >= 0.25 && game.dragon) {
        this.healTimer = 0;
        game.dragon.heal(1);
      }
    }
  }

  /** 被摧毁。 */
  destroy() {
    this.alive = false;
    this.dead = true;
    this.scene.remove(this.group);
    disposeObject(this.group);
  }
}

/** 末影龙。 */
export class Dragon {
  /**
   * @param {import('../world/world.js').World} world
   * @param {THREE.Scene} scene
   * @param {object} assets
   * @param {{x:number,z:number}} center 竞技场中心
   * @param {number} floorY
   * @param {{x:number,y:number,z:number}[]} pillarSpots
   */
  constructor(world, scene, assets, center, floorY, pillarSpots) {
    this.world = world;
    this.scene = scene;
    this.assets = assets;
    this.center = center;
    this.floorY = floorY;
    this.pillarSpots = pillarSpots;

    this.maxHp = 200;
    this.hp = this.maxHp;
    this.alive = true;
    this.dead = false;
    this.activated = false;

    this.pos = new THREE.Vector3(center.x, floorY + 9, center.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'sleep';
    this.stateTimer = 0;
    this.circleAngle = 0;
    this.fireCooldown = 2;
    this.roarCooldown = 0;
    this.wingPhase = 0;
    this.teleportCooldown = 0;
    this.healTimer = 0;
    this.perchSpot = null;
    this.hoverTarget = new THREE.Vector3();

    this.model = createDragon(assets.dragonBody, assets.dragonWing);
    this.group = this.model.group;
    this.group.position.copy(this.pos);
    // 龙身散发的紫光，让它在漆黑的竞技场里清晰可见
    this.glow = new THREE.PointLight(0xaa55ff, 2.2, 26, 1.6);
    this.glow.position.set(0, 0.4, 0);
    this.group.add(this.glow);
    scene.add(this.group);

    /** @type {EndCrystal[]} */
    this.crystals = [];
    for (const spot of pillarSpots) {
      this.crystals.push(new EndCrystal(scene, assets, spot.x, spot.y, spot.z, false));
    }
  }

  /** 剩余的「石柱水晶」数量（掉落的治疗水晶不计入）。 */
  get aliveCrystals() {
    return this.crystals.filter((c) => c.alive && !c.floating).length;
  }

  /** 是否处于栖息（可被近战）状态。 */
  get perched() {
    return this.state === 'perch';
  }

  /** 碰撞盒。 */
  hitBox() {
    return {
      minX: this.pos.x - 1.6,
      maxX: this.pos.x + 1.6,
      minY: this.pos.y - 1.0,
      maxY: this.pos.y + 1.6,
      minZ: this.pos.z - 2.4,
      maxZ: this.pos.z + 2.4,
    };
  }

  /** 头颅位置（吐息起点）。 */
  headPosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 0.6, this.pos.z + 1.8);
  }

  /** 激活 BOSS。 */
  activate(game) {
    if (this.activated) return;
    this.activated = true;
    this.state = 'circle';
    this.stateTimer = 0;
    game.audio.dragonRoar();
    game.notify('末影龙苏醒了！');
  }

  /**
   * 受到伤害。
   * @param {number} amount @param {THREE.Vector3} dir
   * @param {object} game
   */
  takeDamage(amount, dir, game) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    game.audio.swordHit();
    if (this.hp <= 0) {
      this.die(game);
      return;
    }
    // 飞行时被击中会瞬移（还原 MC 机制）
    if (this.state !== 'perch' && this.teleportCooldown <= 0) {
      this.teleportCooldown = 1.6;
      this.doTeleport(game);
    }
  }

  /** 治疗（来自末影水晶）。 */
  heal(amount) {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /** 瞬移。 */
  doTeleport(game) {
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 6;
    this.pos.set(
      this.center.x + Math.cos(a) * r,
      this.floorY + 5 + Math.random() * 4,
      this.center.z + Math.sin(a) * r
    );
    this.vel.set(0, 0, 0);
    game.audio.teleport();
    game.spawnParticles(this.pos, 0x9b59d0, 26);
  }

  /** 死亡。 */
  die(game) {
    this.alive = false;
    this.dead = true;
    this.scene.remove(this.group);
    disposeObject(this.group);
    game.audio.dragonRoar();
    game.onDragonDefeated();
  }

  /**
   * 每帧更新。
   * @param {number} dt @param {import('./player.js').Player} player @param {object} game
   */
  update(dt, player, game) {
    if (!this.alive) return;

    for (const c of this.crystals) {
      if (c.alive) c.update(dt, game);
    }

    if (this.teleportCooldown > 0) this.teleportCooldown -= dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;

    // 水晶回血
    const crystals = this.aliveCrystals;
    if (crystals > 0 && this.state !== 'perch') {
      this.healTimer += dt;
      while (this.healTimer >= 1) {
        this.healTimer -= 1;
        this.heal(crystals);
      }
    }

    this.stateTimer += dt;
    const toPlayer = new THREE.Vector3(
      player.pos.x - this.pos.x,
      player.pos.y + 1 - this.pos.y,
      player.pos.z - this.pos.z
    );
    const distToPlayer = toPlayer.length();

    switch (this.state) {
      case 'sleep':
        this.wingPhase += dt * 2;
        this.pos.y = this.floorY + 9 + Math.sin(this.stateTimer * 0.6) * 0.5;
        break;

      case 'circle': {
        this.circleAngle += dt * 0.55;
        const radius = 15;
        const target = new THREE.Vector3(
          this.center.x + Math.cos(this.circleAngle) * radius,
          this.floorY + 7.5 + Math.sin(this.circleAngle * 1.7) * 2.5,
          this.center.z + Math.sin(this.circleAngle) * radius
        );
        this.steerTo(target, dt, 9);
        if (this.stateTimer > 7) {
          this.setState(crystals === 0 ? 'hover' : Math.random() < 0.45 ? 'perch' : 'hover');
        }
        break;
      }

      case 'hover': {
        this.hoverTarget.lerp(
          new THREE.Vector3(
            player.pos.x,
            Math.max(this.floorY + 5, player.pos.y + 4),
            player.pos.z
          ),
          Math.min(1, dt * 0.9)
        );
        this.steerTo(this.hoverTarget, dt, 11);
        if (this.fireCooldown <= 0 && distToPlayer < 26) {
          this.fireCooldown = crystals === 0 ? 1.1 : 1.9;
          this.breatheFire(player, game);
        }
        if (this.stateTimer > 6) {
          this.setState(Math.random() < 0.55 ? 'perch' : 'circle');
        }
        break;
      }

      case 'perch': {
        if (!this.perchSpot) {
          // 栖息在祭坛中央的传送门（喷泉）上 —— 和 MC 原版一样，
          // 这样玩家能走到旁边近战砍它；柱顶太高是够不到的。
          this.perchSpot = { x: this.center.x, y: this.floorY + 1, z: this.center.z };
        }
        const target = new THREE.Vector3(
          this.perchSpot.x,
          this.perchSpot.y + 1.2,
          this.perchSpot.z
        );
        this.steerTo(target, dt, 7);
        if (this.stateTimer > 9 || crystals === 0) {
          this.setState('circle');
          this.perchSpot = null;
        }
        break;
      }
      default:
        break;
    }

    // 翅膀与尾巴动画
    this.wingPhase += dt * (this.state === 'perch' ? 1.2 : 4.2);
    const flap = Math.sin(this.wingPhase) * 0.42;
    const parts = this.model.parts;
    if (parts.wings) {
      parts.wings[0].rotation.z = flap;
      parts.wings[1].rotation.z = -flap;
    }
    if (parts.tail) parts.tail.rotation.y = Math.sin(this.wingPhase * 0.5) * 0.28;
    if (parts.neck) parts.neck.rotation.x = Math.sin(this.wingPhase * 0.4) * 0.08;

    this.group.position.copy(this.pos);
    // 朝向玩家
    const yaw = Math.atan2(toPlayer.x, toPlayer.z);
    let diff = yaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 2.4);
    this.group.rotation.y = this.yaw;

    // 龙息余烬
    if (this.fireCooldown > 1.2 && this.state === 'hover') {
      game.spawnParticles(this.headPosition(), 0xff7b2a, 2);
    }
  }

  /** 切换状态。 */
  setState(state) {
    this.state = state;
    this.stateTimer = 0;
    if (state !== 'perch') this.perchSpot = null;
  }

  /**
   * 朝目标点转向飞行。
   */
  steerTo(target, dt, speed) {
    const dir = target.clone().sub(this.pos);
    const dist = dir.length();
    if (dist < 0.05) return;
    dir.normalize();
    const desired = dir.multiplyScalar(Math.min(speed, dist * 2));
    this.vel.lerp(desired, Math.min(1, dt * 2.2));
    this.pos.addScaledVector(this.vel, dt);
    // 限制在竞技场内
    const limit = 22;
    this.pos.x = clamp(this.pos.x, this.center.x - limit, this.center.x + limit);
    this.pos.z = clamp(this.pos.z, this.center.z - limit, this.center.z + limit);
    this.pos.y = clamp(this.pos.y, this.floorY + 2.5, this.floorY + 11);
  }

  /** 吐出龙息火球。 */
  breatheFire(player, game) {
    const head = this.headPosition();
    const dir = new THREE.Vector3(
      player.pos.x - head.x,
      player.pos.y + 1.0 - head.y,
      player.pos.z - head.z
    );
    dir.normalize();
    dir.x += (Math.random() - 0.5) * 0.18;
    dir.y += (Math.random() - 0.5) * 0.12;
    dir.z += (Math.random() - 0.5) * 0.18;
    dir.normalize();
    game.projectiles.spawnFireball(head, dir, 17, 9);
    game.audio.dragonBreath();
  }

  /**
   * 处理水晶被击碎。
   * @param {EndCrystal} crystal
   */
  onCrystalDestroyed(crystal, game) {
    const wasPillar = !crystal.floating;
    crystal.destroy();
    game.audio.crystalBreak();
    game.spawnParticles(crystal.pos, 0xd8c8ff, 24);
    if (wasPillar) {
      // 掉落一颗治疗水晶，需要再射一次才能彻底清除
      // 落到竞技场地面上，方便玩家补射（停在柱顶上根本打不到）
      const drop = new EndCrystal(
        this.scene,
        this.assets,
        crystal.pos.x,
        crystal.pos.y,
        crystal.pos.z,
        true,
        this.floorY
      );
      this.crystals.push(drop);
      game.notify('末影水晶破碎，掉落治疗水晶 —— 再射一次！');
    }
  }
}
