/**
 * 粒子系统：爆炸、水晶破碎、传送等特效。
 * @module render/particles
 */
import * as THREE from 'three';

export class Particles {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    /** @type {Map<number, THREE.MeshBasicMaterial>} */
    this.materials = new Map();
    /** @type {any[]} */
    this.particles = [];
    this.max = 500;
  }

  /** @param {number} hex */
  materialFor(hex) {
    if (!this.materials.has(hex)) {
      this.materials.set(
        hex,
        new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 1 })
      );
    }
    return this.materials.get(hex);
  }

  /**
   * 爆发粒子。
   * @param {THREE.Vector3} pos @param {number} color @param {number} count
   * @param {{speed?:number, size?:number, life?:number, gravity?:number}} [opts]
   */
  spawn(pos, color, count, opts = {}) {
    const speed = opts.speed ?? 3.5;
    const size = opts.size ?? 0.16;
    const life = opts.life ?? 0.7;
    const gravity = opts.gravity ?? 9;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.max) break;
      const mesh = new THREE.Mesh(this.geometry, this.materialFor(color));
      const s = size * (0.6 + Math.random() * 0.9);
      mesh.scale.set(s, s, s);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.9 + 0.1,
        Math.random() - 0.5
      ).normalize();
      this.particles.push({
        mesh,
        vel: dir.multiplyScalar(speed * (0.5 + Math.random())),
        life: life * (0.6 + Math.random() * 0.7),
        maxLife: life,
        gravity,
        baseScale: s,
      });
    }
  }

  /** 更新。 */
  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.z += dt * 4;
      // 用缩放做淡出：材质是按颜色共享的，改 opacity 会让同色粒子一起变
      const fade = Math.min(1, p.life / (p.maxLife * 0.5));
      const s = p.baseScale * (0.35 + 0.65 * fade);
      p.mesh.scale.set(s, s, s);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  /** 清空。 */
  clear() {
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
  }
}
