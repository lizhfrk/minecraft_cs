/**
 * 玩家：移动、碰撞、生命/护甲/饥饿、快捷栏。
 * @module entities/player
 */
import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { bodyCollides, correctAxis, hasGroundUnder } from '../world/physics.js';
import { ITEMS } from '../weapons/items.js';
import { enchantSummary } from '../weapons/enchants.js';

const EPS = 1e-3;

/** 防具槽的部位名。 */
const ARMOR_SLOT_NAMES = ['head', 'chest', 'legs'];

/** 护甲减伤的上限（70%）。 */
const MAX_ARMOR_REDUCTION = 0.7;

/** @param {number} current @param {number} target @param {number} maxDelta */
function moveTowards(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

export class Player {
  /**
   * @param {import('../world/world.js').World} world
   * @param {THREE.Camera} camera
   */
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.halfWidth = 0.3;
    this.height = 1.8;
    this.eyeHeight = 1.62;
    this.crouchEyeHeight = 1.32;

    /** 基础最大生命（护甲的「生命」附魔会额外加成） */
    this.baseMaxHealth = 20;
    this.health = this.baseMaxHealth;
    this.hunger = 20;
    this.saturation = 5;

    this.onGround = false;
    this.sprinting = false;
    this.crouching = false;
    this.inWater = false;

    this.hotbar = new Array(9).fill(null);
    this.selected = 0;

    /** @type {{head: object|null, chest: object|null, legs: object|null}} 防具槽 */
    this.armorSlots = { head: null, chest: null, legs: null };

    this.invulnerable = 0;
    this.regenTimer = 0;
    this.hungerTimer = 0;
    this.stepDistance = 0;

    /** 经验与等级（附魔台消耗） */
    this.xp = 0;
    this.level = 0;
    /** @type {Record<string, {id:string, level:number}[]>} 物品 id → 附魔列表 */
    this.enchants = {};

    /** @type {string|null} 最近一次死亡原因 */
    this.lastDamageSource = null;
    /** 统计 */
    this.stats = { kills: 0, damageDealt: 0, arrowsFired: 0, blocksMined: 0 };
  }

  /** 当前手持物品 id */
  get heldItem() {
    const slot = this.hotbar[this.selected];
    return slot ? slot.id : null;
  }

  /** 当前快捷栏槽位 */
  get heldSlot() {
    return this.hotbar[this.selected];
  }

  /** 放置出生点 */
  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
  }

  /* -------------------------------------------------------------- */
  /*                            输入处理                             */
  /* -------------------------------------------------------------- */

  /** @param {number} dx @param {number} dy 鼠标位移 */
  look(dx, dy) {
    const sensitivity = 0.0022;
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /**
   * 每帧更新。
   * @param {number} dt @param {import('../core/input.js').Input} input
   */
  update(dt, input) {
    this.updateLook(dt, input);
    this.updateMovement(dt, input);
    this.updateVitals(dt);
    this.syncCamera();
  }

  /** @param {number} dt @param {import('../core/input.js').Input} input */
  updateLook(dt, input) {
    if (!input.locked) return;
    this.look(input.mouseDX, input.mouseDY);
  }

  /** @param {number} dt @param {import('../core/input.js').Input} input */
  updateMovement(dt, input) {
    const wantCrouch = input.down('ControlLeft') || input.down('ControlRight');
    // 站起前先确认头顶没有低矮的天花板
    if (wantCrouch) {
      this.crouching = true;
    } else if (this.crouching) {
      const blocked = bodyCollides(
        this.world,
        this.pos.x,
        this.pos.y,
        this.pos.z,
        this.halfWidth,
        this.height
      );
      this.crouching = blocked; // 撞到就继续潜行
    }
    const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');

    // 目标方向
    let fx = 0;
    let fz = 0;
    if (input.down('KeyW')) fz += 1;
    if (input.down('KeyS')) fz -= 1;
    if (input.down('KeyA')) fx -= 1;
    if (input.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      fx /= len;
      fz /= len;
    }

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // yaw=0 面向 -Z
    const wishX = fx * cos - fz * sin;
    const wishZ = -fx * sin - fz * cos;

    this.sprinting = wantSprint && !this.crouching && fz > 0.1;

    const baseSpeed = this.crouching ? 1.9 : this.sprinting ? 5.7 : 4.35;
    const speed = this.inWater ? baseSpeed * 0.6 : baseSpeed;
    const accel = this.onGround ? 42 : 9;

    this.vel.x = moveTowards(this.vel.x, wishX * speed, accel * dt);
    this.vel.z = moveTowards(this.vel.z, wishZ * speed, accel * dt);

    // 重力与跳跃
    const gravity = this.inWater ? 9 : 27;
    this.vel.y -= gravity * dt;
    if (this.inWater) {
      this.vel.y = Math.max(this.vel.y, -3.2);
      if (input.down('Space')) this.vel.y = 4.2;
    } else if (input.justPressed('Space') && this.onGround) {
      this.vel.y = 8.4;
      this.onGround = false;
    }
    this.vel.y = clamp(this.vel.y, -48, 20);

    // 分轴移动
    const wasGround = this.onGround;
    const baseY = this.pos.y; // 本帧基准高度：两个轴共用，避免每轴各抬一次
    this.onGround = false;

    this.moveHorizontal('x', this.vel.x * dt, baseY, wasGround);
    this.moveHorizontal('z', this.vel.z * dt, baseY, wasGround);
    this.moveVertical(this.vel.y * dt);

    if (this.onGround && !wasGround && this.vel.y < -12) {
      // 落地
      this.vel.y = 0;
    }

    // 脚下检测
    if (!this.onGround) {
      this.onGround = this.collides(this.pos.x, this.pos.y - 0.02, this.pos.z);
    }

    // 环境检测
    this.inWater = false;
    this.checkLava(dt);

    // 脚步
    if (this.onGround) {
      this.stepDistance += Math.hypot(this.vel.x, this.vel.z) * dt;
    }
  }

  /** 判定是否踩在岩浆里。 */
  checkLava(dt) {
    const w = this.world;
    const y = Math.floor(this.pos.y + 0.1);
    const id = w.get(Math.floor(this.pos.x), y, Math.floor(this.pos.z));
    if (id !== 14) {
      this.lavaTimer = 0;
      return;
    }
    // 岩浆每 0.5 秒灼烧一次（不破坏无敌帧，否则会被瞬间秒杀且没有死亡结算）
    this.lavaTimer = (this.lavaTimer || 0) + dt;
    if (this.lavaTimer >= 0.5) {
      this.lavaTimer = 0;
      this.applyDamage(4, '岩浆');
    }
  }

  /* -------------------------------------------------------------- */
  /*                            碰撞解算                             */
  /* -------------------------------------------------------------- */

  /** 当前身体高度（潜行时更低）。 */
  get bodyHeight() {
    return this.crouching ? 1.5 : this.height;
  }

  /** 碰撞包围盒（供投射物命中判定使用）。 */
  hitBox() {
    const hw = this.halfWidth;
    const h = this.bodyHeight;
    return {
      minX: this.pos.x - hw,
      maxX: this.pos.x + hw,
      minY: this.pos.y,
      maxY: this.pos.y + h,
      minZ: this.pos.z - hw,
      maxZ: this.pos.z + hw,
    };
  }

  /**
   * 玩家包围盒是否与实心方块重叠。
   * @param {number} x @param {number} y @param {number} z
   */
  collides(x, y, z) {
    return bodyCollides(this.world, x, y, z, this.halfWidth, this.bodyHeight);
  }

  /**
   * 水平移动并解算碰撞；遇到 1 格高的台阶会自动抬升。
   *
   * 抬升规则（避免「贴着墙无限往上爬」）：
   *  1. 只抬到本帧基准高度 baseY + 1 —— 两个轴共用同一个基准，
   *     否则斜着撞墙角时两个轴各抬一次，一帧能升 2 格；
   *  2. 只有站在地面上（wasGround）时才允许抬升；
   *  3. 抬升后脚下必须有方块支撑。
   *
   * @param {'x'|'z'} axis @param {number} delta
   * @param {number} [baseY] 本帧基准高度
   * @param {boolean} [wasGround] 上一帧是否站在地面
   */
  moveHorizontal(axis, delta, baseY = this.pos.y, wasGround = this.onGround) {
    if (delta === 0) return;
    const before = this.pos[axis];
    const beforeY = this.pos.y;

    // 先尝试直接移动
    this.pos[axis] = before + delta;
    if (
      correctAxis(this.world, this.pos, axis, delta, this.halfWidth, this.bodyHeight) === null
    ) {
      return; // 没有碰撞
    }

    // 被挡住：尝试抬高 1 格自动上台阶
    if (!wasGround) {
      this.pos[axis] = before;
      this.pos.y = beforeY;
      this.vel[axis] = 0;
      return;
    }
    this.pos[axis] = before + delta;
    this.pos.y = baseY + 1.0;
    const stepped = correctAxis(
      this.world,
      this.pos,
      axis,
      delta,
      this.halfWidth,
      this.bodyHeight
    );
    const supported =
      stepped === null &&
      !this.collides(this.pos.x, this.pos.y, this.pos.z) &&
      hasGroundUnder(this.world, this.pos, this.halfWidth);
    if (supported) {
      // 跨上台阶时保留水平速度，否则走楼梯会一顿一顿的
      this.vel.y = Math.max(this.vel.y, 0);
      this.onGround = true;
      return;
    }
    this.pos[axis] = before;
    this.pos.y = beforeY;
    this.vel[axis] = 0;
  }

  /**
   * 垂直移动。
   * @param {number} delta
   */
  moveVertical(delta) {
    // 没有位移时不需要解算（delta=0 会让 correctAxis 误判成「向下」）
    if (delta === 0) return;
    const before = this.pos.y;
    this.pos.y += delta;
    const hit = correctAxis(
      this.world,
      this.pos,
      'y',
      delta,
      this.halfWidth,
      this.bodyHeight
    );
    if (hit !== null) {
      if (delta < 0) {
        this.onGround = true;
        this.vel.y = 0;
      } else {
        this.vel.y = 0;
      }
      this.pos.y = hit;
    } else if (delta < 0) {
      // 轻微吸附，避免贴地抖动
      if (this.collides(this.pos.x, this.pos.y - 0.08, this.pos.z)) {
        this.pos.y = before;
        this.onGround = true;
        this.vel.y = 0;
      }
    }
  }

  /* -------------------------------------------------------------- */
  /*                            生命状态                             */
  /* -------------------------------------------------------------- */

  /**
   * 受到伤害。
   * @param {number} amount @param {string} [source]
   * @returns {boolean} 是否致死
   */
  applyDamage(amount, source = '未知') {
    if (this.invulnerable > 0 || this.health <= 0) return false;
    const real = amount * (1 - this.armorReduction);
    this.health = Math.max(0, this.health - real);
    this.invulnerable = 0.45;
    this.lastDamageSource = source;
    if (this.health <= 0) return true;
    return false;
  }

  /** @param {number} amount */
  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** @param {number} dt */
  updateVitals(dt) {
    if (this.invulnerable > 0) this.invulnerable -= dt;

    this.hungerTimer += dt;
    if (this.hungerTimer > 4) {
      this.hungerTimer = 0;
      if (this.hunger > 0) {
        this.hunger = Math.max(0, this.hunger - 1);
        this.saturation = Math.max(0, this.saturation - 0.5);
      }
    }

    // 饱食度足够时缓慢回血
    if (this.hunger >= 17 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer > 3.5) {
        this.regenTimer = 0;
        this.heal(1);
        this.saturation = Math.max(0, this.saturation - 1);
      }
    } else {
      this.regenTimer = 0;
    }
  }

  /* -------------------------------------------------------------- */
  /*                          经验与附魔                             */
  /* -------------------------------------------------------------- */

  /** 升到下一级所需的经验。 */
  xpToNext() {
    return 7 + this.level * 2;
  }

  /**
   * 获得经验。
   * @param {number} amount
   * @returns {number} 本次升的级数
   */
  addXp(amount) {
    this.xp += Math.max(0, amount);
    let gained = 0;
    let needed = this.xpToNext();
    while (this.xp >= needed) {
      this.xp -= needed;
      this.level++;
      gained++;
      needed = this.xpToNext();
    }
    return gained;
  }

  /**
   * 消耗经验等级（附魔用）。
   * @param {number} amount
   * @returns {number} 实际消耗的等级
   */
  spendLevels(amount) {
    let left = Math.max(0, amount);
    while (left > 0 && this.level > 0) {
      this.level--;
      left--;
    }
    // 等级降低后升级门槛也变低，可能立刻补回一级
    let needed = this.xpToNext();
    while (this.xp >= needed) {
      this.xp -= needed;
      this.level++;
      needed = this.xpToNext();
    }
    return amount - left;
  }

  /**
   * 某件物品的附魔列表。
   * @param {string|null} itemId
   * @returns {{id:string, level:number}[]}
   */
  getEnchants(itemId) {
    if (!itemId) return [];
    return this.enchants[itemId] || [];
  }

  /**
   * 给某件物品附加一个附魔（同 id 则升级）。
   * @param {string} itemId @param {string} enchantId @param {number} level
   */
  addEnchant(itemId, enchantId, level) {
    if (!itemId) return;
    const list = this.enchants[itemId] ? [...this.enchants[itemId]] : [];
    const found = list.find((e) => e.id === enchantId);
    if (found) {
      found.level = Math.max(found.level, level);
    } else {
      list.push({ id: enchantId, level });
    }
    this.enchants[itemId] = list;
  }

  /* -------------------------------------------------------------- */
  /*                            物品栏                               */
  /* -------------------------------------------------------------- */

  /**
   * 把物品加入快捷栏或背包。
   * @param {string} id @param {number} [count]
   * @returns {boolean} 是否成功加入
   */
  giveItem(id, count = 1) {
    const def = { id, count, durability: 100 };
    // 堆叠上限看物品自己的定义（防具是 1，箭是 64）
    const max = ITEMS[id]?.maxStack ?? 64;
    // 先尝试堆叠
    for (const slot of this.hotbar) {
      if (slot && slot.id === id && slot.count < max) {
        const add = Math.min(max - slot.count, count);
        slot.count += add;
        count -= add;
        if (count <= 0) return true;
      }
    }
    for (let i = 0; i < 9; i++) {
      if (!this.hotbar[i]) {
        const add = Math.min(max, count);
        this.hotbar[i] = { ...def, count: add };
        count -= add;
        if (count <= 0) return true;
      }
    }
    return count <= 0;
  }

  /**
   * 统计快捷栏中某个物品的总数。
   * @param {string} id
   */
  countItem(id) {
    let total = 0;
    for (const slot of this.hotbar) {
      if (slot && slot.id === id) total += slot.count;
    }
    return total;
  }

  /**
   * 从快捷栏任意槽位消耗物品。
   * @param {string} id @param {number} [count]
   * @returns {boolean} 是否成功消耗
   */
  consumeItem(id, count = 1) {
    if (this.countItem(id) < count) return false;
    let remaining = count;
    for (let i = 0; i < 9 && remaining > 0; i++) {
      const slot = this.hotbar[i];
      if (!slot || slot.id !== id) continue;
      const take = Math.min(slot.count, remaining);
      slot.count -= take;
      remaining -= take;
      if (slot.count <= 0) this.hotbar[i] = null;
    }
    return remaining === 0;
  }

  /**
   * 消耗手持物品。
   * @param {number} [count]
   * @returns {boolean} 是否成功消耗
   */
  consumeHeld(count = 1) {
    const slot = this.heldSlot;
    if (!slot || slot.count < count) return false;
    slot.count -= count;
    if (slot.count <= 0) this.hotbar[this.selected] = null;
    return true;
  }

  /** 切换快捷栏。 */
  selectSlot(index) {
    this.selected = clamp(index, 0, 8);
  }

  /* -------------------------------------------------------------- */
  /*                              防具                               */
  /* -------------------------------------------------------------- */

  /**
   * 最大生命值：基础值 + 护甲「生命」附魔的加成。
   */
  get maxHealth() {
    return this.baseMaxHealth + this.armorVitality;
  }

  /**
   * 当前防御点数：三个槽位的防御值 + 坚韧附魔加成。
   */
  get armorPoints() {
    let points = 0;
    for (const name of ARMOR_SLOT_NAMES) {
      const item = this.armorSlots[name];
      if (!item) continue;
      points += ITEMS[item.id]?.defense || 0;
      points += enchantSummary(this.getEnchants(item.id)).armorBonus;
    }
    return points;
  }

  /**
   * 综合减伤比例（0 ~ MAX_ARMOR_REDUCTION）。
   * 防御点数按 4% 一档，再加上「保护」附魔的百分比。
   */
  get armorReduction() {
    let protection = 0;
    for (const name of ARMOR_SLOT_NAMES) {
      const item = this.armorSlots[name];
      if (!item) continue;
      protection += enchantSummary(this.getEnchants(item.id)).protection;
    }
    return Math.min(MAX_ARMOR_REDUCTION, this.armorPoints * 0.04 + protection);
  }

  /**
   * 护甲「生命」附魔提供的最大生命加成。
   */
  get armorVitality() {
    let bonus = 0;
    for (const name of ARMOR_SLOT_NAMES) {
      const item = this.armorSlots[name];
      if (!item) continue;
      bonus += enchantSummary(this.getEnchants(item.id)).vitality;
    }
    return bonus;
  }

  /**
   * 护甲「荆棘」附魔提供的反弹伤害。
   */
  get armorThorns() {
    let thorns = 0;
    for (const name of ARMOR_SLOT_NAMES) {
      const item = this.armorSlots[name];
      if (!item) continue;
      thorns += enchantSummary(this.getEnchants(item.id)).thorns;
    }
    return thorns;
  }

  /**
   * 穿上某件防具。槽位里已有更好的就拒绝换上。
   * @param {{id:string, count?:number, durability?:number}} item
   * @returns {boolean} 是否成功穿上
   */
  equipArmor(item) {
    const def = ITEMS[item.id];
    if (!def || def.type !== 'armor' || !def.slot) return false;
    const current = this.armorSlots[def.slot];
    const currentPoints = current ? ITEMS[current.id]?.defense || 0 : 0;
    if (current && currentPoints >= (def.defense || 0)) return false;
    // 换下来的那件先放回快捷栏，放不下就不换
    if (current && !this.giveItem(current.id, current.count || 1)) return false;
    this.armorSlots[def.slot] = {
      id: item.id,
      count: 1,
      durability: item.durability ?? 100,
    };
    // 多余的（count > 1）也放回快捷栏，不能丢掉
    const count = Math.max(1, item.count || 1);
    if (count > 1) this.giveItem(item.id, count - 1);
    this.clampHealth();
    return true;
  }

  /**
   * 从快捷栏穿上防具；槽位里已有更好的会拒绝换上，
   * 否则直接和槽位里那件交换（同防御值也允许换，避免玩家被卡死）。
   * @param {number} index 快捷栏下标
   * @returns {boolean} 是否成功
   */
  equipFromHotbar(index) {
    const item = this.hotbar[index];
    if (!item) return false;
    const def = ITEMS[item.id];
    if (!def || def.type !== 'armor' || !def.slot) return false;
    const current = this.armorSlots[def.slot];
    if (current && (ITEMS[current.id]?.defense || 0) > (def.defense || 0)) return false;
    this.armorSlots[def.slot] = {
      id: item.id,
      count: 1,
      durability: item.durability ?? 100,
    };
    if (current) {
      // 旧的换到快捷栏这一格
      this.hotbar[index] = {
        id: current.id,
        count: current.count || 1,
        durability: current.durability ?? 100,
      };
    } else if ((item.count || 1) > 1) {
      // 还剩的留在快捷栏里，不能整叠丢掉
      this.hotbar[index] = { ...item, count: item.count - 1 };
    } else {
      this.hotbar[index] = null;
    }
    this.clampHealth();
    return true;
  }

  /**
   * 卸下某个部位的防具，放回快捷栏。
   * @param {'head'|'chest'|'legs'} slotName
   * @returns {object|null} 被卸下的物品；快捷栏放不下时返回 null 且不卸
   */
  unequipArmor(slotName) {
    const item = this.armorSlots[slotName];
    if (!item) return null;
    if (!this.giveItem(item.id, item.count || 1)) return null;
    this.armorSlots[slotName] = null;
    this.clampHealth();
    return item;
  }

  /**
   * 快捷栏里的所有防具（装备面板用它列出可换的装备）。
   * @returns {{index:number, item:object}[]}
   */
  armorInHotbar() {
    const out = [];
    this.hotbar.forEach((item, index) => {
      if (item && ITEMS[item.id]?.type === 'armor') out.push({ index, item });
    });
    return out;
  }

  /** 换了带「生命」附魔的护甲后，血量上限会变，这里把血量收进新上限。 */
  clampHealth() {
    this.health = Math.min(this.health, this.maxHealth);
  }

  /** 相机同步。 */
  syncCamera() {
    const eye = this.crouching ? this.crouchEyeHeight : this.eyeHeight;
    this.camera.position.set(this.pos.x, this.pos.y + eye, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** 获取当前视线方向。 */
  lookDirection(out = new THREE.Vector3()) {
    return out.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }
}
