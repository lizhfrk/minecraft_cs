/**
 * 实体模型：全部用方块拼装，保持 Minecraft 的体素造型。
 * @module entities/models
 */
import * as THREE from 'three';

/** @type {Map<string, THREE.MeshLambertMaterial>} */
const materialCache = new Map();

/**
 * @param {number} hex @param {number} [emissive]
 */
export function solidMaterial(hex, emissive = 0) {
  const key = `${hex}_${emissive}`;
  if (!materialCache.has(key)) {
    const mat = new THREE.MeshLambertMaterial({
      color: hex,
      emissive: emissive ? emissive : 0x000000,
      emissiveIntensity: emissive ? 1 : 0,
    });
    // 标记为共享材质：实体销毁时不能 dispose，否则会影响所有使用它的实体
    mat.userData.shared = true;
    materialCache.set(key, mat);
  }
  return materialCache.get(key);
}

/**
 * 安全释放几何体与材质（共享材质会被跳过）。
 * @param {THREE.Object3D} root
 */
export function disposeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && !m.userData?.shared) m.dispose();
    }
  });
}

/**
 * 创建一个方块部件。
 * @param {number} w @param {number} h @param {number} d
 * @param {THREE.Material|THREE.Material[]} material
 * @param {number[]} pos
 */
export function part(w, h, d, material, pos = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = false;
  return mesh;
}

/**
 * 带头部贴图的面部朝向设置。
 * @param {THREE.Mesh} head @param {THREE.Material} faceMaterial @param {THREE.Material} side
 */
function applyFace(head, faceMaterial, side) {
  const mats = [side, side, side, side, faceMaterial, side];
  if (Array.isArray(head.material)) {
    head.material = mats;
  } else {
    head.material = mats;
  }
}

/**
 * 僵尸模型。
 * @param {THREE.Texture} faceTexture
 */
export function createZombie(faceTexture) {
  const group = new THREE.Group();
  const skin = solidMaterial(0x4a7a3a);
  const shirt = solidMaterial(0x3a5a9a);
  const pants = solidMaterial(0x2a2a55);
  const face = new THREE.MeshLambertMaterial({ map: faceTexture });

  const body = part(0.5, 0.75, 0.28, shirt, [0, 1.05, 0]);
  group.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.42, 0);
  const head = part(0.5, 0.5, 0.5, face, [0, 0.25, 0]);
  applyFace(head, face, skin);
  headPivot.add(head);
  group.add(headPivot);

  const armL = new THREE.Group();
  armL.position.set(-0.375, 1.42, 0);
  const armLMesh = part(0.25, 0.75, 0.25, skin, [0, -0.375, 0]);
  armL.add(armLMesh);
  armL.rotation.x = -Math.PI / 2.1;
  group.add(armL);

  const armR = new THREE.Group();
  armR.position.set(0.375, 1.42, 0);
  const armRMesh = part(0.25, 0.75, 0.25, skin, [0, -0.375, 0]);
  armR.add(armRMesh);
  armR.rotation.x = -Math.PI / 2.1;
  group.add(armR);

  const legL = new THREE.Group();
  legL.position.set(-0.125, 0.65, 0);
  legL.add(part(0.25, 0.65, 0.25, pants, [0, -0.325, 0]));
  group.add(legL);

  const legR = new THREE.Group();
  legR.position.set(0.125, 0.65, 0);
  legR.add(part(0.25, 0.65, 0.25, pants, [0, -0.325, 0]));
  group.add(legR);

  group.traverse((o) => {
    if (o.isMesh) o.position.z += 0;
  });

  return { group, parts: { body, head: headPivot, armL, armR, legL, legR } };
}

/**
 * 骷髅模型（手持弓）。
 * @param {THREE.Texture} faceTexture
 */
export function createSkeleton(faceTexture) {
  const group = new THREE.Group();
  const bone = solidMaterial(0xd8d8d8);
  const boneDark = solidMaterial(0xbdbdbd);
  const face = new THREE.MeshLambertMaterial({ map: faceTexture });

  const body = part(0.5, 0.75, 0.25, bone, [0, 1.05, 0]);
  group.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.42, 0);
  const head = part(0.5, 0.5, 0.5, face, [0, 0.25, 0]);
  applyFace(head, face, bone);
  headPivot.add(head);
  group.add(headPivot);

  const armL = new THREE.Group();
  armL.position.set(-0.375, 1.42, 0);
  armL.add(part(0.2, 0.7, 0.2, bone, [0, -0.35, 0]));
  armL.rotation.x = -1.5;
  group.add(armL);

  const armR = new THREE.Group();
  armR.position.set(0.375, 1.42, 0);
  armR.add(part(0.2, 0.7, 0.2, bone, [0, -0.35, 0]));
  armR.rotation.x = -1.5;
  group.add(armR);

  const legL = new THREE.Group();
  legL.position.set(-0.125, 0.65, 0);
  legL.add(part(0.2, 0.65, 0.2, bone, [0, -0.325, 0]));
  group.add(legL);

  const legR = new THREE.Group();
  legR.position.set(0.125, 0.65, 0);
  legR.add(part(0.2, 0.65, 0.2, bone, [0, -0.325, 0]));
  group.add(legR);

  // 手里的弓
  const bow = part(0.08, 0.6, 0.08, solidMaterial(0x6b4a2c), [0, -0.35, 0.2]);
  armR.add(bow);

  return { group, parts: { body, head: headPivot, armL, armR, legL, legR } };
}

/**
 * 苦力怕模型。
 * @param {THREE.Texture} faceTexture
 */
export function createCreeper(faceTexture) {
  const group = new THREE.Group();
  const skin = solidMaterial(0x5cb544);
  const face = new THREE.MeshLambertMaterial({ map: faceTexture });

  const body = part(0.5, 0.75, 0.3, skin, [0, 0.85, 0]);
  group.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.22, 0);
  const head = part(0.5, 0.5, 0.5, face, [0, 0.25, 0]);
  applyFace(head, face, skin);
  headPivot.add(head);
  group.add(headPivot);

  const legs = [];
  for (const [lx, lz] of [
    [-0.15, 0.15],
    [0.15, 0.15],
    [-0.15, -0.15],
    [0.15, -0.15],
  ]) {
    const g = new THREE.Group();
    g.position.set(lx, 0.5, lz);
    g.add(part(0.2, 0.5, 0.2, skin, [0, -0.25, 0]));
    group.add(g);
    legs.push(g);
  }

  return { group, parts: { body, head: headPivot, legs } };
}

/**
 * 蜘蛛模型。
 */
export function createSpider() {
  const group = new THREE.Group();
  const body = solidMaterial(0x2a2028);
  const head = solidMaterial(0x1d1620);

  const bodyMesh = part(0.7, 0.5, 0.9, body, [0, 0.55, -0.25]);
  group.add(bodyMesh);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.55, 0.35);
  const headMesh = part(0.5, 0.45, 0.5, head, [0, 0, 0]);
  headPivot.add(headMesh);
  group.add(headPivot);

  // 眼睛
  for (const ex of [-0.12, 0.12]) {
    const eye = part(0.1, 0.1, 0.06, solidMaterial(0xd03030), [ex, 0.08, 0.25]);
    headPivot.add(eye);
  }

  const legs = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const idx = i % 4;
    const g = new THREE.Group();
    g.position.set(side * 0.3, 0.4, 0.35 - idx * 0.28);
    g.add(part(0.9, 0.12, 0.12, body, [side * 0.42, 0, 0]));
    g.rotation.z = side * 0.5;
    group.add(g);
    legs.push(g);
  }

  return { group, parts: { body: bodyMesh, head: headPivot, legs } };
}

/**
 * 末影龙模型。
 * @param {THREE.Texture} bodyTexture @param {THREE.Texture} wingTexture
 */
export function createDragon(bodyTexture, wingTexture) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({
    map: bodyTexture,
    emissive: 0x2b1442,
    emissiveIntensity: 1.0,
  });
  const wingMat = new THREE.MeshLambertMaterial({
    map: wingTexture,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.35,
  });
  const boneMat = solidMaterial(0x3a3348);

  const body = part(2.0, 1.6, 3.6, bodyMat, [0, 0, 0]);
  group.add(body);

  const neck = new THREE.Group();
  neck.position.set(0, 0.4, 1.6);
  const neckMesh = part(0.8, 0.8, 1.4, bodyMat, [0, 0, 0.6]);
  neck.add(neckMesh);
  const headMesh = part(1.0, 0.9, 1.6, bodyMat, [0, 0.1, 1.9]);
  neck.add(headMesh);
  // 眼睛
  for (const ex of [-0.25, 0.25]) {
    neck.add(part(0.18, 0.18, 0.1, solidMaterial(0xcc33ff, 0x551188), [ex, 0.25, 2.6]));
  }
  // 下颚
  const jaw = part(0.8, 0.25, 1.2, bodyMat, [0, -0.25, 1.9]);
  neck.add(jaw);
  group.add(neck);

  // 翅膀
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(side * 0.9, 0.5, -0.3);
    const membrane = part(6.0, 0.12, 3.4, wingMat, [side * 3.0, 0, 0]);
    wing.add(membrane);
    // 翼骨
    for (let i = 0; i < 3; i++) {
      wing.add(part(0.18, 0.18, 3.0 - i * 0.5, boneMat, [side * (0.6 + i * 1.7), 0, -0.6]));
    }
    group.add(wing);
    wings.push(wing);
  }

  // 尾巴
  const tail = new THREE.Group();
  tail.position.set(0, 0, -1.7);
  for (let i = 0; i < 4; i++) {
    const seg = part(Math.max(0.25, 0.9 - i * 0.2), Math.max(0.25, 0.8 - i * 0.15), 0.8, bodyMat, [
      0,
      0,
      -0.5 - i * 0.75,
    ]);
    tail.add(seg);
  }
  group.add(tail);

  // 四条腿
  const legs = [];
  for (const side of [-1, 1]) {
    for (const back of [0, 1]) {
      const g = new THREE.Group();
      g.position.set(side * 0.9, -0.6, back ? -1.1 : 1.1);
      g.add(part(0.45, 1.0, 0.45, bodyMat, [0, -0.5, 0]));
      group.add(g);
      legs.push(g);
    }
  }

  return { group, parts: { body, neck, head: headMesh, jaw, wings, tail, legs } };
}

/**
 * 末影水晶模型。
 * @param {THREE.Texture} crystalTexture
 */
export function createEndCrystal(crystalTexture) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    map: crystalTexture,
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  });
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.9, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
  );
  inner.position.y = 0.5;
  group.add(inner);
  const outer = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.3, 1.0), mat);
  outer.position.y = 0.6;
  group.add(outer);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.16, 1.1),
    new THREE.MeshBasicMaterial({ color: 0x2a2038 })
  );
  base.position.y = 0.08;
  group.add(base);
  return { group, parts: { outer, inner, base } };
}

/**
 * 箭模型。
 */
export function createArrowMesh() {
  const group = new THREE.Group();
  const shaft = part(0.08, 0.08, 0.7, solidMaterial(0x8a8a8a), [0, 0, 0]);
  group.add(shaft);
  const tip = part(0.1, 0.1, 0.18, solidMaterial(0xdcdcdc), [0, 0, -0.42]);
  group.add(tip);
  const feather = part(0.02, 0.22, 0.22, solidMaterial(0xe8e8e8), [0, 0, 0.3]);
  group.add(feather);
  return group;
}

/**
 * 掉落物模型（旋转的迷你方块）。
 * @param {number} size @param {THREE.Material} material
 */
export function createDropMesh(size, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  return mesh;
}
