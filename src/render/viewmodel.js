/**
 * 第一人称手持模型：手臂、剑、斧、弓。
 *
 * 参照《我的世界》的做法：
 *  - 手臂是带皮肤纹理的立体方块，不是纯色盒子；
 *  - 手持物品是「挤出」的立体模型（正面贴图标，侧面是物品本色），不是一张平面贴图；
 *  - 手从画面右下角伸出握住道具，挥砍 / 拉弓时手臂与武器一起动。
 *
 * 在独立场景中渲染，避免与世界产生深度冲突。
 * @module render/viewmodel
 */
import * as THREE from 'three';
import { ITEMS } from '../weapons/items.js';

/** 每种物品的摆放参数：位置、旋转、缩放、手臂姿态。 */
const LAYOUTS = {
  iron_sword: {
    // 图标里剑尖朝右上，转 90° 后剑尖朝左上、握把落在右下（靠近手）
    item: { pos: [0.15, -0.15, -0.60], rot: [0.10, -0.35, 1.57], scale: 0.44 },
    arm: { pos: [0.29, -0.41, -0.72], rot: [0.06, -0.12, 0.50] },
  },
  stone_axe: {
    item: { pos: [0.15, -0.15, -0.60], rot: [0.10, -0.35, 1.57], scale: 0.44 },
    arm: { pos: [0.29, -0.41, -0.72], rot: [0.06, -0.12, 0.50] },
  },
  bow: {
    item: { pos: [0.19, -0.17, -0.66], rot: [0.05, -0.30, 0.22], scale: 0.50 },
    arm: { pos: [0.26, -0.40, -0.74], rot: [0.10, -0.10, 0.46] },
  },
  default: {
    item: { pos: [0.20, -0.22, -0.62], rot: [0.05, -0.40, 0.35], scale: 0.40 },
    arm: { pos: [0.30, -0.44, -0.72], rot: [0.08, -0.14, 0.48] },
  },
};

export class ViewModel {
  /**
   * @param {{texture:THREE.Texture, flatTexture:THREE.Texture, rect:(n:string)=>any,
   *          tileRect:(n:string)=>any, canvas:HTMLCanvasElement, entity:(n:string)=>THREE.Texture}} atlas
   */
  constructor(atlas) {
    this.atlas = atlas;
    this.texture = atlas.flatTexture;
    this.rectOf = atlas.rect;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 12);

    /** 走动晃动用的根节点 */
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // ---- 手臂 ----
    this.armMaterial = new THREE.MeshBasicMaterial({
      map: atlas.entity('arm'),
      color: 0xffffff,
    });
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), this.armMaterial);
    this.group.add(this.arm);

    // ---- 手持物品（立体挤出）----
    this.itemMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.4,
      // 只画正面：背面若也画，图标上的镂空处会「透视」出背面，出现重影
      side: THREE.FrontSide,
    });
    this.edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x9a9a9a });
    this.itemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.itemMaterial);
    this.group.add(this.itemMesh);

    // 弓弦
    this.bowString = new THREE.Mesh(
      new THREE.PlaneGeometry(0.02, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xdddddd, side: THREE.DoubleSide })
    );
    this.bowString.visible = false;
    this.group.add(this.bowString);

    this.currentItem = null;
    this.swingTime = 0;
    this.swingDuration = 0.26;
    this.drawAmount = 0;
    this.bobPhase = 0;
    this.recoil = 0;
    /** 环境亮度（0-1），由玩家所在位置的光照决定 */
    this.lightLevel = 1;
  }

  /** 调整渲染尺寸。 */
  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 设置环境亮度，让手臂跟着场景明暗变化。
   * @param {number} level 0-1
   */
  setLight(level) {
    this.lightLevel = level;
    const v = 0.28 + 0.72 * level;
    this.armMaterial.color.setRGB(v, v, v);
  }

  /**
   * 换成所选角色的手臂（袖子与皮肤颜色不同）。
   * @param {string} charId 角色 id
   */
  setCharacter(charId) {
    const map = this.atlas.entity(`arm_${charId}`);
    if (!map || this.armMaterial.map === map) return;
    this.armMaterial.map = map;
    this.armMaterial.needsUpdate = true;
  }

  /**
   * 设置当前手持物品。
   * @param {string|null} itemId
   */
  setItem(itemId) {
    if (itemId === this.currentItem) return;
    this.currentItem = itemId;
    const def = itemId ? ITEMS[itemId] : null;

    if (!def) {
      this.itemMesh.visible = false;
      this.bowString.visible = false;
      this.arm.visible = true;
      return;
    }
    // 防具不是手持武器 —— 显示空手，不画那块方片
    if (def.type === 'armor') {
      this.itemMesh.visible = false;
      this.bowString.visible = false;
      this.arm.visible = true;
      return;
    }
    this.itemMesh.visible = true;
    this.applyItemGeometry(def.icon);
    this.applyLayout(LAYOUTS[itemId] || LAYOUTS.default);

    this.bowString.visible = itemId === 'bow';
    if (itemId === 'bow') {
      this.layoutBowString(LAYOUTS.bow);
    }
  }

  /**
   * 让弓弦贴在弓身内侧（弓弦在弓的左侧，贴着弓臂）。
   * @param {{item:any}} layout
   */
  layoutBowString(layout) {
    const it = layout.item;
    // 弓弦在弓臂两端的连线上（图标左侧 x ≈ 5.5/16），换算到世界坐标
    const localX = (-0.25 + 0.5 * (5.5 / 16)) * it.scale;
    const off = new THREE.Vector3(localX, 0, 0).applyEuler(
      new THREE.Euler(it.rot[0], it.rot[1], it.rot[2], 'XYZ')
    );
    // 弓弦要浮在弓身前面，否则会被挤在盒子里看不见
    this.bowString.position.set(it.pos[0] + off.x, it.pos[1] + off.y, it.pos[2] + off.z + 0.05);
    this.bowString.rotation.set(it.rot[0], it.rot[1], it.rot[2]);
    this.bowString.scale.set(1, it.scale * 0.92, 1);
  }

  /**
   * 把物品图标贴到一个有厚度的盒子上（正面/背面是图标，侧面是物品本色）。
   * @param {string} icon 图集内的纹理名
   */
  applyItemGeometry(icon) {
    const rect = this.rectOf(icon);
    if (!rect) return;

    const depth = 0.09;
    const geo = new THREE.BoxGeometry(0.5, 0.5, depth);
    const uv = geo.attributes.uv;
    const arr = uv.array;
    // BoxGeometry 的面顺序：[+X, -X, +Y, -Y, +Z, -Z]，每面 4 个顶点
    const setFace = (face, u0, v0, u1, v1) => {
      const o = face * 8;
      // 顶点顺序：[左上, 右上, 左下, 右下]
      arr[o + 0] = u0; arr[o + 1] = v1;
      arr[o + 2] = u1; arr[o + 3] = v1;
      arr[o + 4] = u0; arr[o + 5] = v0;
      arr[o + 6] = u1; arr[o + 7] = v0;
    };
    // 正反两面显示完整图标
    setFace(4, rect.u0, rect.v0, rect.u1, rect.v1);
    setFace(5, rect.u0, rect.v0, rect.u1, rect.v1);
    uv.needsUpdate = true;

    // 侧面取图标中心的一小块颜色，做出「挤出的厚度」
    const cu = (rect.u0 + rect.u1) / 2;
    const cv = (rect.v0 + rect.v1) / 2;
    const e = 0.004;
    setFace(0, cu - e, cv - e, cu + e, cv + e);
    setFace(1, cu - e, cv - e, cu + e, cv + e);
    setFace(2, cu - e, cv - e, cu + e, cv + e);
    setFace(3, cu - e, cv - e, cu + e, cv + e);

    // 侧面的材质：取图标上最常见的实心颜色
    const edge = this.averageIconColor(icon);
    this.edgeMaterial.color.setHex(edge);

    this.itemMesh.geometry.dispose();
    this.itemMesh.geometry = geo;
    this.itemMesh.material = [this.edgeMaterial, this.edgeMaterial, this.edgeMaterial,
      this.edgeMaterial, this.itemMaterial, this.itemMaterial];
  }

  /**
   * 计算图标的主色调（用于挤出模型的侧面）。
   * @param {string} icon
   * @returns {number} 颜色值
   */
  averageIconColor(icon) {
    const rect = this.atlas.tileRect(icon);
    if (!rect || !this.atlas.canvas) return 0x9a9a9a;
    const ctx = this.atlas.canvas.getContext('2d');
    try {
      const data = ctx.getImageData(rect.sx, rect.sy, rect.w, rect.h).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      if (n === 0) return 0x9a9a9a;
      // 压暗一点，侧面看起来像厚度
      const k = 0.72;
      return (
        (Math.round((r / n) * k) << 16) |
        (Math.round((g / n) * k) << 8) |
        Math.round((b / n) * k)
      );
    } catch (e) {
      return 0x9a9a9a;
    }
  }

  /**
   * 应用某种物品的摆放。
   * @param {{item:any, arm:any}} layout
   */
  applyLayout(layout) {
    const it = layout.item;
    this.itemMesh.position.set(it.pos[0], it.pos[1], it.pos[2]);
    this.itemMesh.rotation.set(it.rot[0], it.rot[1], it.rot[2]);
    this.itemMesh.scale.setScalar(it.scale);

    const ar = layout.arm;
    this.arm.position.set(ar.pos[0], ar.pos[1], ar.pos[2]);
    this.arm.rotation.set(ar.rot[0], ar.rot[1], ar.rot[2]);
  }

  /** 触发挥砍动画。 */
  swing(duration = 0.26) {
    this.swingTime = duration;
    this.swingDuration = duration;
  }

  /** 触发后坐力（开火）。 */
  kick(amount = 1) {
    this.recoil = Math.min(1.2, this.recoil + amount);
  }

  /**
   * @param {number} dt
   * @param {{moving:boolean, speed:number, drawAmount:number, charging:boolean, sprinting:boolean}} state
   */
  update(dt, state) {
    if (this.swingTime > 0) this.swingTime -= dt;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 5);
    this.drawAmount = state.drawAmount;

    const bobSpeed = state.moving ? 9 : 3;
    this.bobPhase += dt * bobSpeed;
    const bobAmp = state.moving ? 0.022 : 0.008;
    const bobX = Math.cos(this.bobPhase) * bobAmp;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmp * 1.4;

    this.group.position.set(bobX, bobY - this.recoil * 0.03, 0);
    this.group.rotation.set(0, 0, bobX * 0.6);

    // 冲刺时手臂下压
    if (state.sprinting) {
      this.group.position.y -= 0.03;
      this.group.rotation.x = 0.25;
    } else {
      this.group.rotation.x = 0;
    }

    // 挥砍：武器与手臂一起向左上挥出（贴近屏幕中央，不挡住视野）
    if (this.swingTime > 0) {
      const t = 1 - this.swingTime / this.swingDuration;
      const swing = Math.sin(t * Math.PI);
      this.group.position.x -= swing * 0.09;
      this.group.position.y += swing * 0.05;
      this.group.position.z -= swing * 0.05;
      this.group.rotation.z = swing * 0.45;
      this.group.rotation.x = -swing * 0.30;
      this.group.rotation.y = -swing * 0.20;
    } else {
      this.group.rotation.z *= 0.6;
      this.group.rotation.x *= 0.6;
      this.group.rotation.y *= 0.6;
    }

    // 拉弓：弓往后拉、弓弦收紧
    if (state.charging && this.currentItem === 'bow') {
      const d = this.drawAmount;
      const layout = LAYOUTS.bow;
      this.itemMesh.position.z = layout.item.pos[2] + d * 0.14;
      this.itemMesh.position.x = layout.item.pos[0] - d * 0.04;
      this.layoutBowString(layout);
      this.bowString.position.z += d * 0.26;
      this.bowString.scale.y = layout.item.scale * 0.92 * (1 - d * 0.25);
      this.group.rotation.y = -d * 0.25;
      // 拉弓时手臂往回缩
      this.arm.position.x = layout.arm.pos[0] - d * 0.05;
    } else if (this.currentItem === 'bow') {
      const layout = LAYOUTS.bow;
      this.itemMesh.position.z = layout.item.pos[2];
      this.itemMesh.position.x = layout.item.pos[0];
      this.layoutBowString(layout);
      this.group.rotation.y *= 0.7;
      this.arm.position.x = layout.arm.pos[0];
    }
  }
}
