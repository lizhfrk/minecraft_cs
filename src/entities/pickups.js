/**
 * 掉落物：击杀敌人后掉落的物品，走近即可拾取。
 * @module entities/pickups
 */
import * as THREE from 'three';
import { ITEMS } from '../weapons/items.js';

export class Pickup {
  /**
   * @param {string} itemId @param {number} count @param {THREE.Vector3} pos
   * @param {THREE.Scene} scene @param {THREE.Texture} atlasTexture
   * @param {(name:string)=>{u0:number,v0:number,u1:number,v1:number}|null} rectOf
   */
  constructor(itemId, count, pos, scene, atlasTexture, rectOf) {
    this.itemId = itemId;
    this.count = count;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3(
      (Math.random() - 0.5) * 2.4,
      2.6 + Math.random(),
      (Math.random() - 0.5) * 2.4
    );
    this.age = 0;
    this.dead = false;
    this.grounded = false;

    const def = ITEMS[itemId];
    const rect = rectOf(def ? def.icon : 'item_iron');
    const geo = new THREE.PlaneGeometry(0.4, 0.4);
    if (rect) {
      const uv = geo.attributes.uv;
      // PlaneGeometry 的顶点顺序是 [左上, 右上, 左下, 右下]
      const coords = [
        [rect.u0, rect.v1],
        [rect.u1, rect.v1],
        [rect.u0, rect.v0],
        [rect.u1, rect.v0],
      ];
      for (let i = 0; i < 4; i++) uv.setXY(i, coords[i][0], coords[i][1]);
      uv.needsUpdate = true;
    }
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: atlasTexture,
        side: THREE.DoubleSide,
        alphaTest: 0.4,
        transparent: false,
      })
    );
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  /**
   * @param {number} dt @param {import('./player.js').Player} player @param {object} game
   */
  update(dt, player, game) {
    this.age += dt;
    this.vel.y -= 22 * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < 0) this.pos.y = 0;

    const ground = game.solidTopAt(this.pos.x, this.pos.z, this.pos.y);
    if (ground !== null && this.pos.y <= ground + 0.02 && this.vel.y < 0) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.vel.x *= 0.7;
      this.vel.z *= 0.7;
      this.grounded = true;
    }

    this.mesh.position.set(
      this.pos.x,
      this.pos.y + 0.35 + Math.sin(this.age * 2.4) * 0.08,
      this.pos.z
    );
    this.mesh.rotation.y = this.age * 1.8;

    // 拾取
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y + 0.9 - (this.pos.y + 0.35);
    const dz = player.pos.z - this.pos.z;
    if (dx * dx + dy * dy + dz * dz < 2.4) {
      const def = ITEMS[this.itemId];
      // 防具：槽位空着就直接穿上，身上那件更好就留在背包里
      // （一次只自动穿一件；多件时整批进背包，避免丢件）
      if (def && def.type === 'armor' && this.count === 1) {
        if (player.equipArmor({ id: this.itemId, count: 1 })) {
          game.audio.pickup();
          game.notify(`装备了 ${def.label}（防御 ${def.defense}）`);
          this.dead = true;
          return;
        }
      }
      if (player.giveItem(this.itemId, this.count)) {
        game.audio.pickup();
        game.notify(`+${this.count} ${ITEMS[this.itemId]?.label || this.itemId}`);
        this.dead = true;
      }
    }
    // 5 分钟后消失
    if (this.age > 300) this.dead = true;
  }

  /** 移除。 */
  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class PickupManager {
  /**
   * @param {THREE.Scene} scene @param {THREE.Texture} atlasTexture
   * @param {(name:string)=>{u0:number,v0:number,u1:number,v1:number}|null} rectOf
   */
  constructor(scene, atlasTexture, rectOf) {
    this.scene = scene;
    this.atlasTexture = atlasTexture;
    this.rectOf = rectOf;
    /** @type {Pickup[]} */
    this.pickups = [];
  }

  /**
   * @param {string} itemId @param {number} count @param {THREE.Vector3} pos
   */
  spawn(itemId, count, pos) {
    const p = new Pickup(itemId, count, pos, this.scene, this.atlasTexture, this.rectOf);
    this.pickups.push(p);
    return p;
  }

  /** 更新。 */
  update(dt, player, game) {
    for (const p of this.pickups) {
      if (!p.dead) p.update(dt, player, game);
    }
    for (const p of this.pickups) {
      if (p.dead) p.dispose(this.scene);
    }
    this.pickups = this.pickups.filter((p) => !p.dead);
  }

  /** 清空。 */
  clear() {
    for (const p of this.pickups) p.dispose(this.scene);
    this.pickups = [];
  }
}
