/**
 * 游戏主循环与玩法逻辑。
 * @module main
 */
import * as THREE from 'three';

import { World } from './world/world.js';
import { Dungeon, ARENA_CENTER, ARENA_HALF, ARENA_FLOOR_Y } from './world/dungeon.js';
import { buildAtlas } from './world/atlas.js';
import { createWorldMaterials } from './world/materials.js';
import { WorldMesher } from './world/mesher.js';
import { BLOCK, BLOCKS, BLOCK_DROPS } from './world/blocks.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { DIFFICULTIES, ROOM_POP, loadDifficulty, saveDifficulty } from './core/difficulty.js';
import { CHARACTERS, loadCharacter, saveCharacter } from './core/characters.js';
import { RNG, rayBoxDistance, raycastVoxels, clamp, lerp } from './core/utils.js';
import { FLOOR_Y, floorIndexAt } from './core/floors.js';

import { Player } from './entities/player.js';
import { EnemyManager, ENEMY_TYPES } from './entities/enemies.js';
import { ProjectileManager } from './entities/projectiles.js';
import { PickupManager } from './entities/pickups.js';
import { Dragon } from './entities/dragon.js';

import { HUD } from './render/hud.js';
import { ViewModel } from './render/viewmodel.js';
import { Particles } from './render/particles.js';
import { drawCharacterPortrait } from './render/portrait.js';

import { ITEMS, itemDesc } from './weapons/items.js';
import { weaponOf, bowCharge } from './weapons/weapons.js';
import {
  ENCHANTS,
  MAX_ENCHANTS,
  enchantKind,
  enchantLevel,
  enchantSummary,
  rollOptions,
} from './weapons/enchants.js';

const REACH = 4.6;

/** 防具槽的顺序（面板与 HUD 一致）。 */
const ARMOR_SLOT_ORDER = ['legs', 'chest', 'head'];

/** 防具槽的中文名。 */
const ARMOR_SLOT_LABELS = { head: '头盔', chest: '胸甲', legs: '护腿' };

/** 怪物掉的防具：越深的层越可能掉高级货。 */
const ARMOR_DROP_POOLS = [
  ['leather_helmet', 'leather_chestplate', 'leather_leggings'],
  ['leather_chestplate', 'iron_helmet', 'iron_chestplate', 'iron_leggings'],
  ['iron_chestplate', 'iron_leggings', 'diamond_helmet', 'diamond_chestplate'],
  ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings'],
];

/** 按 id 取 DOM 元素。 */
const $ = (id) => document.getElementById(id);

/** 附魔等级 → 罗马数字。 */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
function romanLevel(level) {
  return ROMAN[level] || String(level);
}

class Game {
  constructor() {
    this.state = 'menu';
    this.clock = new THREE.Clock();
    this.rng = new RNG(Date.now() & 0xffffffff);
    this.audio = audio;
    /** 当前难度（core/difficulty）。刷怪频率、怪物上限与伤害都由它决定。 */
    this.difficulty = loadDifficulty();
    /** 物品注册表（调试与测试用）。 */
    this.itemDefs = ITEMS;
    /** 当前主角（core/characters）。影响第一人称手臂与起始补给。 */
    this.character = loadCharacter();

    this.notifications = [];
    this.killFeed = [];
    this.hitmarker = 0;
    this.hitmarkerKill = false;
    this.damageFlash = 0;
    this.crosshairSpread = 0;
    this.crosshairOnEnemy = false;
    this.lowHealth = 0;
    this.hint = '';

    this.mining = null;
    this.attackCooldown = 0;
    this.drawTime = 0;
    this.charging = false;
    this.footTimer = 0;
    this.arenaTriggered = false;
    this.kills = 0;

    // 屏幕投影用的临时向量（每帧复用，避免反复分配）
    this.tmpForward = new THREE.Vector3();
    this.tmpOffset = new THREE.Vector3();
    this.tmpRight = new THREE.Vector3();
    this.tmpPoint = new THREE.Vector3();
  }

  /* ============================================================== */
  /*                            初始化                              */
  /* ============================================================== */

  async init() {
    this.setupRenderer();
    this.setupScene();

    this.atlas = buildAtlas();
    this.world = new World(160, 80, 160);
    // 允许用 ?seed=xxxx 生成不同的地牢
    const params = new URLSearchParams(window.location.search);
    const seedParam = Number.parseInt(params.get('seed') || '', 10);
    this.seed = Number.isFinite(seedParam) ? seedParam : 20261026;
    this.dungeon = new Dungeon(this.world, this.seed);
    this.dungeon.generate();
    /** 箱子的世界坐标（小地图标注用）。扫描一次，之后只读。 */
    this.chestSpots = this.collectChestSpots();
    /** 小地图用的静态数据：房间与附魔台。生成后就不再变了。 */
    this.mapRooms = this.dungeon.rooms.map((r) => ({
      cx: r.cx,
      cz: r.cz,
      halfW: r.halfW,
      halfD: r.halfD,
      floorY: r.floorY,
      floor: r.floor,
      name: roomLabel(r),
    }));
    this.mapEnchantSpots = (this.dungeon.enchantSpots || []).map((s) => ({
      x: s.x,
      z: s.z,
      floorY: s.y,
    }));
    /** 小地图上的竞技场（固定不变）。 */
    this.mapArena = {
      x: ARENA_CENTER.x,
      z: ARENA_CENTER.z,
      half: ARENA_HALF,
      floorY: ARENA_FLOOR_Y,
    };

    this.materials = createWorldMaterials(this.atlas.texture);
    this.mesher = new WorldMesher(
      this.world,
      this.atlas,
      this.materials.opaque,
      this.materials.transparent
    );
    await this.buildMeshes();

    this.player = new Player(this.world, this.camera);
    this.enemies = new EnemyManager(this.world, this.scene);
    this.enemies.setAssets({
      zombieFace: this.atlas.entity('zombie_face'),
      skeletonFace: this.atlas.entity('skeleton_face'),
      creeperFace: this.atlas.entity('creeper_face'),
    });
    this.projectiles = new ProjectileManager(this.world, this.scene);
    this.pickups = new PickupManager(this.scene, this.atlas.flatTexture, this.atlas.rect);
    this.particles = new Particles(this.scene);
    this.viewModel = new ViewModel(this.atlas);
    this.hud = new HUD(document.getElementById('hud'), this.atlas);

    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    // 游戏中点击画面可重新锁定鼠标（键盘关闭指南后浏览器可能拒绝自动锁定）
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });

    this.setupUI();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  setupRenderer() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070b);
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 260);
    this.scene.add(this.camera);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const hemi = new THREE.HemisphereLight(0x8fa4c4, 0x2a2018, 0.45);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.22);
    dir.position.set(0.4, 1, 0.3);
    this.scene.add(dir);

    // 玩家手提火把的动态光源
    this.torchLight = new THREE.PointLight(0xffc98a, 1.1, 12, 1.8);
    this.camera.add(this.torchLight);
  }

  /** 分批构建网格，避免长时间阻塞主线程。 */
  async buildMeshes() {
    const total = this.mesher.chunkCountX * this.mesher.chunkCountZ;
    let done = 0;
    const bar = document.getElementById('load-bar');
    const label = document.getElementById('load-label');
    for (let cz = 0; cz < this.mesher.chunkCountZ; cz++) {
      for (let cx = 0; cx < this.mesher.chunkCountX; cx++) {
        this.mesher.buildChunk(cx, cz);
        done++;
      }
      if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
      if (label) label.textContent = `正在生成地牢… ${Math.round((done / total) * 100)}%`;
      await new Promise((r) => setTimeout(r, 0));
    }
    this.scene.add(this.mesher.group);
  }

  /**
   * 在房间里预置敌人。
   *
   * 预算是硬性目标：逐轮分配，每轮先给每个房间最多补一只，直到预算用完。
   * 轮转保证普通房间也能分到怪 —— 否则刷怪间特别多的地图上其它房间会全空。
   * 同一格子里不会叠两只怪 —— 叠在一起会同时打你，看着也很吓人。
   */
  populateRooms() {
    const pop = ROOM_POP[this.difficulty.id] || ROOM_POP.normal;
    /** 已经占用的格子。 */
    const taken = new Set();
    let budget = pop.budget;

    const isDense = (room) => room.theme === 'mob' || room.theme === 'crypt';
    const rooms = this.dungeon.rooms.slice(1);
    // 刷怪间与墓穴排在前面（那里本来就是刷怪笼的所在地），同层内保持原有顺序
    const ordered = [...rooms].sort((a, b) => Number(isDense(b)) - Number(isDense(a)));
    const perRoom = ordered.map((room) => (isDense(room) ? pop.denseMax : pop.sparseMax));
    const placedIn = ordered.map(() => 0);

    /** 在房间里找一个能站的空格子放一只怪；放不下返回 false。 */
    const placeIn = (room) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const type = this.randomEnemyType(room.theme);
        const ox = room.cx + this.rng.int(-room.halfW + 1, room.halfW - 1);
        const oz = room.cz + this.rng.int(-room.halfD + 1, room.halfD - 1);
        if (this.world.get(ox, room.floorY, oz) !== 0) continue;
        const key = `${ox},${room.floorY},${oz}`;
        if (taken.has(key)) continue;
        taken.add(key);
        const enemy = this.enemies.spawn(type, ox + 0.5, room.floorY, oz + 0.5);
        // 房间预置的怪不会被远距离回收
        enemy.persistent = true;
        return true;
      }
      return false;
    };

    // 第一轮：每轮给每个房间最多补一只，预算用完为止
    let progress = true;
    while (budget > 0 && progress) {
      progress = false;
      for (let i = 0; i < ordered.length && budget > 0; i++) {
        if (placedIn[i] >= perRoom[i]) continue;
        if (placeIn(ordered[i])) {
          placedIn[i]++;
          budget--;
          progress = true;
        }
      }
    }

    // 房间不够分时，放宽每房上限把剩下的预算用完
    while (budget > 0) {
      let placed = false;
      for (const room of ordered) {
        if (budget <= 0) break;
        if (placeIn(room)) {
          budget--;
          placed = true;
        }
      }
      if (!placed) break;
    }
  }

  /**
   * 随机选择敌人类型。
   * @param {string} [theme]
   */
  randomEnemyType(theme) {
    if (theme === 'mob') return this.rng.chance(0.5) ? 'skeleton' : 'zombie';
    if (theme === 'crypt') return this.rng.chance(0.45) ? 'creeper' : 'skeleton';
    if (theme === 'mines') return this.rng.chance(0.4) ? 'spider' : 'zombie';
    return this.rng.pick(['zombie', 'zombie', 'skeleton', 'creeper', 'spider']);
  }

  /* ============================================================== */
  /*                              UI                                */
  /* ============================================================== */

  setupUI() {
    this.screens = {
      menu: $('menu'),
      pause: $('pause'),
      dead: $('dead'),
      win: $('win'),
      loading: $('loading'),
      help: $('help'),
      enchant: $('enchant'),
      equipment: $('equipment'),
    };

    $('btn-play').addEventListener('click', () => this.startGame());
    $('btn-howto').addEventListener('click', () => this.openHelp());
    $('btn-help').addEventListener('click', () => this.openHelp());
    $('btn-help-close').addEventListener('click', () => this.closeHelp());
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-restart').addEventListener('click', () => this.restart());
    $('btn-restart2').addEventListener('click', () => this.restart());
    $('btn-respawn').addEventListener('click', () => this.respawn());
    $('btn-again').addEventListener('click', () => this.restart());
    $('btn-enchant-close').addEventListener('click', () => this.closeEnchant());
    $('btn-equip-close').addEventListener('click', () => this.closeEquipment());
    // 装备面板用事件委托：点「装备」「卸下」「附魔」
    $('equip-body')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'equip') this.equipFromBag(Number(btn.dataset.index));
      else if (act === 'unequip') this.unequipFromSlot(btn.dataset.slot);
      else if (act === 'enchant') this.enchantFromEquipmentPanel(btn.dataset.item);
    });
    // 难度选择：点击即切换，并记住选择
    $('difficulty-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.diff-btn');
      if (!btn) return;
      this.setDifficulty(btn.dataset.diff);
    });
    this.syncDifficultyUI();
    // 主角选择：点卡片即切换
    $('character-picker')?.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card');
      if (!card) return;
      this.setCharacter(card.dataset.char);
    });
    this.syncCharacterUI();
    this.renderItemDex();
    // 附魔选项用事件委托，点击卡片即可附魔
    $('enchant-options').addEventListener('click', (e) => {
      const btn = e.target.closest('.enchant-option');
      if (!btn || btn.disabled) return;
      const opt = this.enchantOptions.find((o) => o.id === btn.dataset.id);
      if (opt) this.applyEnchant(opt);
    });
  }

  /**
   * 切换难度。开局前可以随意改，开局后只影响之后的刷怪与伤害。
   * @param {string} id
   */
  setDifficulty(id) {
    const diff = DIFFICULTIES[id];
    if (!diff) return;
    this.difficulty = diff;
    saveDifficulty(id);
    this.syncDifficultyUI();
  }

  /**
   * 切换主角。开局前可以随意改，第一人称手臂会立刻换掉。
   * @param {string} id
   */
  setCharacter(id) {
    const char = CHARACTERS[id];
    if (!char) return;
    this.character = char;
    saveCharacter(id);
    this.syncCharacterUI();
    this.viewModel?.setCharacter(id);
  }

  /** 画三张角色卡片的立绘，并让选中项高亮。 */
  syncCharacterUI() {
    const picker = $('character-picker');
    if (!picker) return;
    picker.querySelectorAll('.char-card').forEach((card) => {
      const id = card.dataset.char;
      const active = id === this.character.id;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
      const canvas = card.querySelector('.char-portrait');
      if (canvas) drawCharacterPortrait(canvas, id, 8);
    });
  }

  /** 让难度按钮与说明文字跟当前难度保持一致。 */
  syncDifficultyUI() {
    const picker = $('difficulty-picker');
    if (!picker) return;
    picker.querySelectorAll('.diff-btn').forEach((btn) => {
      const active = btn.dataset.diff === this.difficulty.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const desc = $('difficulty-desc');
    if (desc) desc.textContent = this.difficulty.desc;
  }

  showScreen(name) {
    for (const key of Object.keys(this.screens)) {
      const el = this.screens[key];
      if (el) el.hidden = key !== name;
    }
  }

  /** 打开操作指南（覆盖在当前界面之上）。 */
  openHelp() {
    if (this.state === 'help') return;
    this.helpReturn = this.state;
    // 先切状态再解除指针锁定，避免锁定回调把游戏误判为「暂停」
    this.state = 'help';
    this.showScreen('help');
    if (this.helpReturn === 'playing') this.input.exitLock();
  }

  /** 关闭操作指南，回到打开前的界面。 */
  closeHelp() {
    if (this.state !== 'help') return;
    const back = this.helpReturn === 'playing' ? 'playing' : this.helpReturn || 'menu';
    this.helpReturn = null;
    this.state = back;
    this.showScreen(back === 'playing' ? null : this.screenFor(back));
    if (back === 'playing') {
      // 键盘关闭时没有用户手势，指针锁定可能被浏览器拒绝 —— 稍后提示玩家点击画面
      this.input.requestLock();
      this.lockHintAt = performance.now() + 500;
    } else if (back === 'enchanting') {
      // 从附魔界面打开的指南：回到附魔界面并刷新内容
      this.renderEnchantPanel();
    }
  }

  /** 游戏状态 → 对应的界面元素 id。 */
  screenFor(state) {
    if (state === 'paused') return 'pause';
    if (state === 'dead') return 'dead';
    if (state === 'won') return 'win';
    if (state === 'menu') return 'menu';
    if (state === 'enchanting') return 'enchant';
    if (state === 'equipment') return 'equipment';
    return null;
  }

  /* ============================================================== */
  /*                              装备                               */
  /* ============================================================== */

  /**
   * 打开装备面板。
   */
  openEquipment() {
    if (this.state === 'equipment') return;
    this.equipReturn = this.state;
    this.state = 'equipment';
    this.input.exitLock();
    this.showScreen('equipment');
    this.renderEquipmentPanel();
  }

  /** 关闭装备面板，回到打开前的界面。 */
  closeEquipment() {
    if (this.state !== 'equipment') return;
    const back = this.equipReturn || 'playing';
    this.equipReturn = null;
    this.state = back;
    this.showScreen(back === 'playing' ? null : this.screenFor(back));
    if (back === 'playing') {
      this.input.requestLock();
      this.lockHintAt = performance.now() + 500;
    }
  }

  /** 从背包（快捷栏）里穿上某件防具。 */
  equipFromBag(index) {
    if (!this.player.equipFromHotbar(index)) {
      this.notify('身上那件更好 —— 没有换上');
      return;
    }
    this.renderEquipmentPanel();
  }

  /** 卸下某个部位的防具。 */
  unequipFromSlot(slotName) {
    const item = this.player.unequipArmor(slotName);
    if (!item) {
      this.notify('快捷栏放不下了 —— 先腾个位置');
      return;
    }
    this.renderEquipmentPanel();
  }

  /**
   * 从装备面板发起附魔。仍然要求站在附魔台旁边。
   * @param {string} itemId 要附魔的防具 id
   */
  enchantFromEquipmentPanel(itemId) {
    if (!this.nearEnchantTable()) {
      this.notify('要走到附魔台旁边才能附魔');
      return;
    }
    this.enchantFromEquipment = true;
    this.openEnchant(itemId);
  }

  /**
   * 渲染装备面板：三个已穿戴的槽位 + 背包里的防具。
   */
  renderEquipmentPanel() {
    const slotsRoot = $('equip-slots');
    const listRoot = $('equip-list');
    const summary = $('equip-summary');
    if (!slotsRoot || !listRoot || !summary) return;
    const player = this.player;

    slotsRoot.innerHTML = '';
    for (const slotName of ARMOR_SLOT_ORDER) {
      const item = player.armorSlots[slotName];
      const def = item ? ITEMS[item.id] : null;
      const row = document.createElement('div');
      row.className = `equip-slot${item ? ' is-filled' : ''}`;

      const icon = this.buildItemIcon(def ? def.icon : null, 40);
      row.appendChild(icon);

      const text = document.createElement('div');
      text.className = 'equip-text';
      const name = document.createElement('span');
      name.className = 'equip-name';
      name.textContent = def ? def.label : ARMOR_SLOT_LABELS[slotName];
      const stat = document.createElement('span');
      stat.className = 'equip-stat';
      if (def) {
        // 防御值要把「坚韧」附魔的加成算进去，和底部总览对得上
        const bonus = player.getEnchants(item.id).reduce((sum, e) => {
          const ed = ENCHANTS[e.id];
          return sum + (ed && ed.id === 'toughness' ? e.level : 0);
        }, 0);
        const points = (def.defense || 0) + bonus;
        stat.textContent = `${ARMOR_SLOT_LABELS[slotName]} · 防御 ${points}`;
      } else {
        stat.textContent = '空';
      }
      text.appendChild(name);
      text.appendChild(stat);

      // 已有的附魔
      for (const e of player.getEnchants(item ? item.id : null)) {
        const ed = ENCHANTS[e.id];
        if (!ed) continue;
        const chip = document.createElement('span');
        chip.className = 'equip-chip';
        chip.textContent = `${ed.name} ${romanLevel(e.level)}`;
        text.appendChild(chip);
      }
      row.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'equip-actions';
      if (item) {
        const ench = document.createElement('button');
        ench.className = 'mc-btn mini';
        ench.dataset.act = 'enchant';
        ench.dataset.item = item.id;
        ench.textContent = '附魔';
        actions.appendChild(ench);

        const un = document.createElement('button');
        un.className = 'mc-btn mini';
        un.dataset.act = 'unequip';
        un.dataset.slot = slotName;
        un.textContent = '卸下';
        actions.appendChild(un);
      }
      row.appendChild(actions);
      slotsRoot.appendChild(row);
    }

    // 背包里的防具
    listRoot.innerHTML = '';
    const bag = player.armorInHotbar();
    if (bag.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'equip-empty';
      empty.textContent = '背包里没有防具 —— 箱子（E）和怪物掉落里能找到。';
      listRoot.appendChild(empty);
    }
    for (const { index, item } of bag) {
      const def = ITEMS[item.id];
      const row = document.createElement('div');
      row.className = 'equip-bag-item';
      row.appendChild(this.buildItemIcon(def.icon, 32));
      const text = document.createElement('div');
      text.className = 'equip-text';
      const name = document.createElement('span');
      name.className = 'equip-name';
      name.textContent = def.label + (item.count > 1 ? ` ×${item.count}` : '');
      const stat = document.createElement('span');
      stat.className = 'equip-stat';
      stat.textContent = `${ARMOR_SLOT_LABELS[def.slot]} · 防御 ${def.defense}`;
      text.appendChild(name);
      text.appendChild(stat);
      row.appendChild(text);
      const btn = document.createElement('button');
      btn.className = 'mc-btn mini';
      btn.dataset.act = 'equip';
      btn.dataset.index = String(index);
      btn.textContent = '装备';
      row.appendChild(btn);
      listRoot.appendChild(row);
    }

    // 总览
    const reduction = Math.round(player.armorReduction * 100);
    summary.innerHTML =
      `总防御 <b>${player.armorPoints}</b> 点 · 减伤 <b>${reduction}%</b>` +
      ` · 最大生命 <b>${player.maxHealth}</b>`;
  }

  /**
   * 造一个画着物品图标的 canvas。
   * @param {string|null} icon 图集里的纹理名
   * @param {number} size 像素
   * @returns {HTMLCanvasElement}
   */
  buildItemIcon(icon, size) {
    const canvas = document.createElement('canvas');
    canvas.className = 'equip-icon';
    canvas.width = size;
    canvas.height = size;
    if (!icon) return canvas;
    const rect = this.atlas.tileRect(icon);
    if (!rect) return canvas;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas.canvas, rect.sx, rect.sy, rect.w, rect.h, 0, 0, size, size);
    return canvas;
  }

  /* ============================================================== */
  /*                            附魔台                               */
  /* ============================================================== */

  /** 附近是否有可用的附魔台。 */
  nearEnchantTable() {
    const p = this.player.pos;
    for (const spot of this.dungeon.enchantSpots) {
      const d = Math.hypot(p.x - spot.x, (p.y - spot.y) * 0.6, p.z - spot.z);
      if (d < 3.5) return spot;
    }
    return null;
  }

  /**
   * 打开附魔界面。
   * @param {string} [targetId] 指定要附魔的物品（默认是手上的）
   */
  openEnchant(targetId = null) {
    const player = this.player;
    const itemId = targetId || player.heldItem;
    this.enchantTarget = itemId;
    const kind = enchantKind(itemId);
    this.enchantOptions = kind
      ? rollOptions(this.rng, kind, player.getEnchants(itemId))
      : [];
    this.state = 'enchanting';
    this.input.exitLock();
    this.showScreen('enchant');
    this.renderEnchantPanel();
    if (!kind) {
      this.notify('附魔台只能给剑、斧、弓和防具附魔');
    }
  }

  /** 关闭附魔界面。 */
  closeEnchant() {
    if (this.state !== 'enchanting') return;
    // 从装备面板进来的，回到装备面板
    const back = this.enchantFromEquipment ? 'equipment' : 'playing';
    this.enchantFromEquipment = false;
    this.enchantTarget = null;
    this.state = back;
    this.showScreen(back === 'playing' ? null : this.screenFor(back));
    if (back === 'equipment') {
      this.renderEquipmentPanel();
      return;
    }
    this.input.requestLock();
    this.lockHintAt = performance.now() + 500;
  }

  /**
   * 应用一条附魔。
   * @param {{id:string, level:number, levelCost:number, material:string, materialCount:number}} opt
   */
  applyEnchant(opt) {
    const player = this.player;
    const itemId = this.enchantTarget || player.heldItem;
    const current = player.getEnchants(itemId);
    const def = ENCHANTS[opt.id];
    if (!def) return;

    if (!current.some((e) => e.id === opt.id) && current.length >= MAX_ENCHANTS) {
      this.notify(`这件装备最多只能有 ${MAX_ENCHANTS} 条附魔`);
      return;
    }
    if (player.level < opt.levelCost) {
      this.notify(`经验等级不足：需要 ${opt.levelCost} 级`);
      return;
    }
    if (player.countItem(opt.material) < opt.materialCount) {
      const label = ITEMS[opt.material]?.label || opt.material;
      this.notify(`材料不足：需要 ${label} × ${opt.materialCount}`);
      return;
    }

    player.spendLevels(opt.levelCost);
    player.consumeItem(opt.material, opt.materialCount);
    player.addEnchant(itemId, opt.id, opt.level);

    audio.chestOpen();
    this.notify(`附魔成功：${def.name} ${romanLevel(opt.level)}`);
    this.enchantOptions = rollOptions(this.rng, enchantKind(itemId), player.getEnchants(itemId));
    this.renderEnchantPanel();
  }

  /** 渲染附魔界面。 */
  renderEnchantPanel() {
    const player = this.player;
    const itemId = this.enchantTarget || player.heldItem;
    const def = ITEMS[itemId];
    const list = player.getEnchants(itemId);
    const kind = enchantKind(itemId);

    $('enchant-item-name').textContent = def ? def.label : '未选择装备';

    const chips = list.length
      ? list.map((e) => {
          const ed = ENCHANTS[e.id];
          return `<span class="enchant-chip">${ed ? ed.name : e.id} ${romanLevel(e.level)}</span>`;
        })
      : '<span class="enchant-chip empty">暂无附魔</span>';
    $('enchant-current').innerHTML = chips;

    $('enchant-level').textContent = `Lv.${player.level}`;
    $('enchant-xp-text').textContent = `${player.xp} / ${player.xpToNext()}`;
    $('enchant-xp-fill').style.width = `${Math.min(
      100,
      (player.xp / Math.max(1, player.xpToNext())) * 100
    )}%`;

    this.drawEnchantIcon(def ? def.icon : 'item_iron_sword');

    const box = $('enchant-options');
    box.innerHTML = '';
    if (!kind) {
      box.innerHTML =
        '<div class="enchant-option" style="cursor:default;opacity:.8">' +
        '<span class="ench-opt-name">无法附魔</span>' +
        '<span class="ench-opt-desc">选中的不是剑、斧、弓或防具 —— 按 1-9 切换手上的装备</span>' +
        '</div>';
      return;
    }
    for (const opt of this.enchantOptions) {
      const matLabel = ITEMS[opt.material]?.label || opt.material;
      const enoughLevel = player.level >= opt.levelCost;
      const enoughMat = player.countItem(opt.material) >= opt.materialCount;
      const btn = document.createElement('button');
      btn.className = 'enchant-option';
      btn.dataset.id = opt.id;
      btn.disabled = !(enoughLevel && enoughMat);
      btn.innerHTML =
        `<span class="ench-opt-name">${opt.name} ${romanLevel(opt.level)}</span>` +
        `<span class="ench-opt-desc">${opt.desc}</span>` +
        `<span class="ench-opt-cost">${opt.levelCost} 级 · ${matLabel} × ${opt.materialCount}</span>`;
      box.appendChild(btn);
    }
  }

  /** 在附魔面板里画当前武器图标。 */
  drawEnchantIcon(icon) {
    const canvas = document.getElementById('enchant-icon');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    const rect = this.atlas.tileRect(icon);
    if (!rect) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas.canvas, rect.sx, rect.sy, rect.w, rect.h, 4, 4, 40, 40);
  }

  /**
   * 渲染操作指南里的「物品图鉴」：按类别列出全部物品的图标、名称与用途。
   */
  renderItemDex() {
    const root = $('item-dex');
    if (!root || !this.atlas) return;
    root.innerHTML = '';

    // 图鉴条目总数（写进说明里，免得以后加物品忘了改文案）
    const count = $('dex-count');
    if (count) count.textContent = String(Object.keys(ITEMS).length);

    const groups = [
      { title: '武器与工具', match: (d) => d.type === 'weapon' || d.type === 'tool' },
      { title: '防具', match: (d) => d.type === 'armor' },
      { title: '弹药与消耗品', match: (d) => d.type === 'ammo' || d.type === 'food' },
      { title: '附魔材料', match: (d) => d.type === 'material' },
      { title: '方块与建材', match: (d) => d.type === 'block' },
    ];

    for (const group of groups) {
      const items = Object.entries(ITEMS).filter(([, def]) => group.match(def));
      if (items.length === 0) continue;

      const section = document.createElement('div');
      section.className = 'dex-group';

      const title = document.createElement('h4');
      title.className = 'dex-group-title';
      title.textContent = group.title;
      section.appendChild(title);

      const list = document.createElement('div');
      list.className = 'dex-list';
      for (const [id, def] of items) {
        list.appendChild(this.buildDexItem(id, def));
      }
      section.appendChild(list);
      root.appendChild(section);
    }
  }

  /**
   * 造一条物品图鉴条目（图标 canvas + 名称 + 说明）。
   * @param {string} id @param {import('./weapons/items.js').ItemDef} def
   * @returns {HTMLElement}
   */
  buildDexItem(id, def) {
    const row = document.createElement('div');
    row.className = 'dex-item';

    const canvas = document.createElement('canvas');
    canvas.className = 'dex-icon';
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const rect = this.atlas.tileRect(def.icon);
    if (rect) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.atlas.canvas, rect.sx, rect.sy, rect.w, rect.h, 0, 0, 32, 32);
    }

    const text = document.createElement('div');
    text.className = 'dex-text';
    const name = document.createElement('span');
    name.className = 'dex-name';
    name.textContent = def.label;
    const desc = document.createElement('span');
    desc.className = 'dex-desc';
    desc.textContent = itemDesc(id);
    text.appendChild(name);
    text.appendChild(desc);

    row.appendChild(canvas);
    row.appendChild(text);
    return row;
  }

  /**
   * 收集地牢里所有箱子的坐标（小地图标注用）。
   *
   * 箱子没有单独列表，只在 world.meta 里记着战利品，
   * 所以这里把 meta 反解成坐标扫一遍 —— 只在地牢生成后跑一次。
   *
   * @returns {{x:number, z:number, floorY:number}[]}
   */
  collectChestSpots() {
    const w = this.world;
    const spots = [];
    for (const [index, meta] of w.meta) {
      if (!meta || meta.type !== 'chest') continue;
      const x = index % w.width;
      const z = Math.floor(index / w.width) % w.depth;
      const y = Math.floor(index / (w.width * w.depth));
      spots.push({ x, z, floorY: y });
    }
    return spots;
  }

  startGame() {
    audio.init();
    this.showScreen(null);
    this.state = 'playing';
    this.input.requestLock();
    if (!this.started) {
      this.started = true;
      // 房间里的初始怪物在这里才生成 —— 这样主菜单里选的难度对这一局立即生效
      this.populateRooms();
      const sp = this.dungeon.spawnPoint;
      this.player.setPosition(sp.x, sp.y, sp.z);
      this.player.giveItem('iron_sword');
      this.player.giveItem('bow');
      this.player.giveItem('stone_axe');
      this.player.giveItem('arrow', 32);
      this.player.giveItem('bread', 6);
      this.player.giveItem('torch', 12);
      // 角色自带的额外补给
      for (const bonus of this.character.bonus || []) {
        this.player.giveItem(bonus.item, bonus.count);
      }
      this.player.selectSlot(0);
    }
    // 第一人称手臂换成所选角色的
    this.viewModel.setCharacter(this.character.id);
    this.notify(`深入地牢，击败末影龙！ —— 你扮演的是${this.character.name}`);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.showScreen(null);
    this.input.requestLock();
  }

  restart() {
    window.location.reload();
  }

  onPlayerDeath(cause) {
    this.state = 'dead';
    this.input.exitLock();
    document.getElementById('death-cause').textContent = `被${cause}击败`;
    this.showScreen('dead');
    audio.defeat();
  }

  respawn() {
    const cp = this.checkpoint || this.dungeon.spawnPoint;
    this.player.setPosition(cp.x, cp.y, cp.z);
    this.player.health = this.player.maxHealth;
    this.player.hunger = 20;
    // 护甲留着 —— 死了就全掉光太惩罚了
    this.player.stats.kills = 0;
    this.state = 'playing';
    this.showScreen(null);
    this.input.requestLock();
    this.notify('你在检查点重生了');
  }

  onDragonDefeated() {
    this.state = 'won';
    this.input.exitLock();
    const s = this.player.stats;
    document.getElementById('win-stats').textContent =
      `用时 ${Math.floor(this.elapsed / 60)} 分 ${Math.floor(this.elapsed % 60)} 秒 · ` +
      `击杀 ${s.kills} 个敌人 · 射出 ${s.arrowsFired} 支箭 · 挖掘 ${s.blocksMined} 个方块`;
    this.showScreen('win');
    audio.victory();
  }

  /* ============================================================== */
  /*                            主循环                              */
  /* ============================================================== */

  start() {
    this.clock.start();
    this.elapsed = 0;
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.update(dt);
      this.render();
      this.input.endFrame();
    };
    loop();
  }

  update(dt) {
    this.handleGlobalKeys();

    if (this.state === 'playing') {
      this.elapsed = (this.elapsed || 0) + dt;
      this.player.update(dt, this.input);
      // 兜底：任何伤害来源把血打光都必须进入死亡结算
      if (this.player.health <= 0) {
        this.onPlayerDeath(this.player.lastDamageSource || '未知');
        return;
      }
      this.handleKeys();
      this.handleActions(dt);
      this.enemies.update(dt, this.player, this);
      this.projectiles.update(dt, this);
      this.pickups.update(dt, this.player, this);
      if (this.dragon) this.dragon.update(dt, this.player, this);
      this.particles.update(dt);
      this.updateObjective();
      this.updateAtmosphere();
    } else if (this.state === 'menu') {
      // 菜单里也让场景缓缓转动作为背景
      this.camera.rotation.y += dt * 0.05;
    }

    // 提示与计时
    for (let i = this.notifications.length - 1; i >= 0; i--) {
      this.notifications[i].life -= dt;
      if (this.notifications[i].life <= 0) this.notifications.splice(i, 1);
    }
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].life -= dt;
      if (this.killFeed[i].life <= 0) this.killFeed.splice(i, 1);
    }
    if (this.hitmarker > 0) this.hitmarker -= dt * 2.2;
    if (this.damageFlash > 0) this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.crosshairSpread = Math.max(0, this.crosshairSpread - dt * 2.4);
    this.lowHealth = this.player && this.player.health < 6 ? 1 - this.player.health / 6 : 0;

    this.updateViewModel(dt);
    this.renderHud();

    // 指针锁定失败时提示玩家点击画面恢复操作
    if (this.lockHintAt && performance.now() > this.lockHintAt) {
      this.lockHintAt = 0;
      if (this.state === 'playing' && !this.input.locked) {
        this.notify('点击画面锁定鼠标');
      }
    }
  }

  render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewModel.scene, this.viewModel.camera);
  }

  /* ============================================================== */
  /*                            输入处理                            */
  /* ============================================================== */

  /** 全局快捷键：无论处于哪个界面都生效。 */
  handleGlobalKeys() {
    const input = this.input;
    if (input.justPressed('KeyH')) {
      if (this.state === 'help') this.closeHelp();
      else this.openHelp();
      return;
    }
    if (input.justPressed('KeyF')) {
      if (this.state === 'equipment') this.closeEquipment();
      else if (this.state === 'playing') this.openEquipment();
      return;
    }
    if (this.state === 'help' && input.justPressed('Escape')) {
      this.closeHelp();
      return;
    }
    if (this.state === 'equipment' && input.justPressed('Escape')) {
      this.closeEquipment();
      return;
    }
    if (this.state === 'enchanting' && input.justPressed('Escape')) {
      this.closeEnchant();
      return;
    }
    // 附魔界面里也能切换武器
    if (this.state === 'enchanting') {
      for (let i = 0; i < 9; i++) {
        if (input.justPressed(`Digit${i + 1}`)) {
          this.player.selectSlot(i);
          this.viewModel.setItem(this.player.heldItem);
          // 没有指定附魔目标时，跟着手上的东西走
          if (!this.enchantTarget) this.refreshEnchantOptions();
        }
      }
    }
  }

  /** 重新生成附魔选项并刷新面板。 */
  refreshEnchantOptions() {
    const itemId = this.enchantTarget || this.player.heldItem;
    const kind = enchantKind(itemId);
    this.enchantOptions = kind
      ? rollOptions(this.rng, kind, this.player.getEnchants(itemId))
      : [];
    this.renderEnchantPanel();
  }

  handleKeys() {
    const input = this.input;
    const player = this.player;

    for (let i = 0; i < 9; i++) {
      if (input.justPressed(`Digit${i + 1}`)) {
        player.selectSlot(i);
        this.viewModel.setItem(player.heldItem);
      }
    }
    if (input.justPressed('KeyQ')) {
      const next = this.findWeaponSlot(1);
      if (next >= 0) {
        player.selectSlot(next);
        this.viewModel.setItem(player.heldItem);
      }
    }
    if (input.justPressed('KeyR')) {
      const bow = player.hotbar.findIndex((s) => s && s.id === 'bow');
      if (bow >= 0) {
        player.selectSlot(bow);
        this.viewModel.setItem(player.heldItem);
      }
    }
    if (input.justPressed('KeyE')) this.interact();
    if (input.wheel !== 0) {
      const dir = input.wheel > 0 ? 1 : -1;
      player.selectSlot((player.selected + dir + 9) % 9);
      this.viewModel.setItem(player.heldItem);
    }
    // 攻击键：切换手中物品时同步模型
    if (player.heldItem !== this.viewModel.currentItem) {
      this.viewModel.setItem(player.heldItem);
    }
  }

  /** 找到下一个武器槽位。 */
  findWeaponSlot(dir) {
    const p = this.player;
    for (let i = 1; i <= 9; i++) {
      const idx = (p.selected + dir * i + 18) % 9;
      const slot = p.hotbar[idx];
      if (slot && weaponOf(slot.id)) return idx;
    }
    return -1;
  }

  handleActions(dt) {
    const input = this.input;
    const player = this.player;
    const held = player.heldItem;
    const weapon = held ? weaponOf(held) : null;

    // 拉弓
    if (weapon && weapon.kind === 'bow') {
      if (input.buttons[0]) {
        if (!this.charging) {
          this.charging = true;
          this.drawTime = 0;
          audio.bowDraw();
        }
        this.drawTime += dt;
      } else if (this.charging) {
        this.charging = false;
        this.fireArrow(weapon);
        this.drawTime = 0;
      }
    } else if (this.charging) {
      this.charging = false;
      this.drawTime = 0;
    }

    // 近战 / 挖掘
    if (!weapon || weapon.kind !== 'bow') {
      if (input.buttonPressed[0]) {
        this.handlePrimaryAction(weapon);
      }
      if (input.buttons[0]) {
        // 瞄准目标改变时中断挖掘
        if (this.mining) {
          const aim = this.targetBlock();
          if (
            !aim ||
            aim.x !== this.mining.x ||
            aim.y !== this.mining.y ||
            aim.z !== this.mining.z
          ) {
            this.mining = null;
          }
        }
        if (this.mining) this.continueMining(dt, weapon);
      } else {
        this.mining = null;
      }
    }

    // 右键放置方块 / 进食
    if (input.buttonPressed[1]) {
      this.useRightClick();
    }
  }

  /** 左键：优先攻击敌人，否则挖掘方块。 */
  handlePrimaryAction(weapon) {
    const player = this.player;
    const melee = weapon && weapon.kind === 'melee' ? weapon : null;
    if (melee && this.attackCooldown <= 0) {
      const hit = this.findMeleeTarget(melee.range);
      if (hit) {
        this.attackCooldown = melee.cooldown;
        this.viewModel.swing(melee.swingTime);
        audio.swordSwing();
        this.applyMeleeHit(hit, melee);
        return;
      }
    }
    // 挖掘
    const block = this.targetBlock();
    if (block) {
      this.mining = { x: block.x, y: block.y, z: block.z, progress: 0 };
    }
  }

  /** 近战命中判定（命中框略微放宽，手感更接近《我的世界》）。 */
  findMeleeTarget(range) {
    const origin = this.camera.position;
    const dir = this.player.lookDirection();
    let best = null;
    let bestDist = Infinity;

    const test = (target, box) => {
      if (!target) return;
      // 稍微放宽命中框，避免必须精确对准模型中心
      const padded = {
        minX: box.minX - 0.28,
        maxX: box.maxX + 0.28,
        minY: box.minY - 0.12,
        maxY: box.maxY + 0.12,
        minZ: box.minZ - 0.28,
        maxZ: box.maxZ + 0.28,
      };
      const d = rayBoxDistance(origin, dir, padded);
      if (d < bestDist && d <= range) {
        bestDist = d;
        best = target;
      }
    };

    for (const e of this.enemies.enemies) {
      if (e.dead) continue;
      test(e, e.box);
    }
    if (this.dragon && this.dragon.alive) {
      test(this.dragon, this.dragon.hitBox());
    }
    return best ? { target: best, distance: bestDist } : null;
  }

  /**
   * 应用近战伤害。
   * @param {{target:any, distance:number}} hit @param {any} weapon
   */
  applyMeleeHit(hit, weapon) {
    const player = this.player;
    const target = hit.target;
    const dir = new THREE.Vector3(
      target.pos.x - player.pos.x,
      0,
      target.pos.z - player.pos.z
    ).normalize();

    // 附魔加成
    const ench = enchantSummary(player.getEnchants(player.heldItem));
    let damage = weapon.damage + ench.damage;
    if (ench.undeadBonus > 0 && (target.type === 'zombie' || target.type === 'skeleton')) {
      damage += ench.undeadBonus;
    }
    const knockback = weapon.knockback + ench.knockback;

    if (target === this.dragon) {
      if (!this.dragon.perched) {
        this.notify('末影龙在空中 —— 用箭射击，或等它栖息');
        this.hitmarker = 0.5;
        return;
      }
      const dmg = damage * 2.2;
      this.dragon.takeDamage(dmg, dir, this);
      this.hitmarker = 0.9;
      this.hitmarkerKill = this.dragon.hp <= 0;
      player.stats.damageDealt += dmg;
      this.spawnParticles(target.pos, 0x9b59d0, 8);
      return;
    }

    const died = target.takeDamage(damage, knockback, dir);
    this.hitmarker = 0.9;
    this.hitmarkerKill = died;
    player.stats.damageDealt += damage;
    audio.swordHit();
    this.spawnParticles(target.center, 0x8a2b2b, 6);
    // 火焰附魔：点燃
    if (ench.burn > 0) {
      target.burn = { timer: ench.burn * 3, tick: 1, dps: ench.burn };
      this.spawnParticles(target.center, 0xff7a1a, 6, { speed: 1.5 });
    }
    if (died) this.onEnemyKilled(target);
  }

  /** 继续挖掘。 */
  continueMining(dt, weapon) {
    const m = this.mining;
    if (!m) return;
    const current = this.world.get(m.x, m.y, m.z);
    if (current === 0) {
      this.mining = null;
      return;
    }
    const hardness = BLOCKS[current].hardness;
    if (hardness < 0) {
      this.mining = null;
      return;
    }
    const speed = (weapon && weapon.miningSpeed ? weapon.miningSpeed : 1) / Math.max(0.35, hardness);
    m.progress += dt * speed;
    if (Math.random() < dt * 12) {
      this.spawnParticles(
        new THREE.Vector3(m.x + 0.5, m.y + 0.5, m.z + 0.5),
        0x9a9a9a,
        1,
        { speed: 1.4, size: 0.08, life: 0.4 }
      );
    }
    if (m.progress >= 1) {
      this.breakBlock(m.x, m.y, m.z);
      this.mining = null;
    }
  }

  /** 破坏方块。 */
  breakBlock(x, y, z) {
    const id = this.world.get(x, y, z);
    if (id === 0) return;
    const def = BLOCKS[id];
    if (def.hardness < 0) return;
    this.world.set(x, y, z, 0);
    this.player.stats.blocksMined++;
    audio.blockBreak();
    this.spawnParticles(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), 0x8a8a8a, 10, {
      speed: 2.4,
    });

    const dropName = BLOCK_DROPS[def.name];
    if (dropName) {
      const itemId = dropName === 'cobblestone' ? 'cobblestone_item' : `block_${dropName}`;
      if (ITEMS[itemId]) {
        this.pickups.spawn(itemId, 1, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
      }
    }
    // 附魔台被挖掉后同步移除记录，否则站在原地按 E 还能打开附魔界面
    if (id === BLOCK.ENCHANTING_TABLE) {
      this.dungeon.enchantSpots = this.dungeon.enchantSpots.filter(
        (s) => Math.floor(s.x) !== x || Math.floor(s.y) !== y || Math.floor(s.z) !== z
      );
      this.mapEnchantSpots = this.mapEnchantSpots.filter(
        (s) => Math.floor(s.x) !== x || Math.floor(s.floorY) !== y || Math.floor(s.z) !== z
      );
    }
    // 箱子被挖掉后小地图上也不能再标着
    if (id === BLOCK.CHEST) {
      this.chestSpots = this.chestSpots.filter(
        (c) => c.x !== x || c.z !== z || c.floorY !== y
      );
    }
    this.mesher.rebuildAround(x, y, z);
    if (def.light > 0) this.relight(x, y, z);
  }

  /** 右键：放置方块 / 进食。 */
  useRightClick() {
    const player = this.player;
    const held = player.heldItem;
    if (!held) return;
    const def = ITEMS[held];
    if (!def) return;
    if (def.type === 'food') {
      this.eatFood(def);
      return;
    }
    if (def.type !== 'block') return;
    this.placeBlock(def);
  }

  /**
   * 进食。
   * @param {import('../weapons/items.js').ItemDef} def
   */
  eatFood(def) {
    const player = this.player;
    if (player.hunger >= 20 && player.health >= player.maxHealth) {
      this.notify('现在还不饿');
      return;
    }
    player.hunger = Math.min(20, player.hunger + 6);
    player.saturation = Math.min(10, player.saturation + 3);
    player.heal(def.heal || 4);
    player.consumeHeld(1);
    audio.eat();
    this.notify(`吃掉了 ${def.label}`);
  }

  /**
   * 放置方块。
   * @param {import('../weapons/items.js').ItemDef} def
   */
  placeBlock(def) {
    const player = this.player;
    const target = this.targetBlock(true);
    if (!target) return;
    const x = target.x + target.nx;
    const y = target.y + target.ny;
    const z = target.z + target.nz;
    if (!this.world.inBounds(x, y, z)) return;
    if (this.world.get(x, y, z) !== 0) return;
    // 不能放在自己身上
    const px = Math.floor(player.pos.x);
    const py = Math.floor(player.pos.y);
    const pz = Math.floor(player.pos.z);
    if (px === x && pz === z && (py === y || py + 1 === y)) return;

    const blockId = this.blockIdOf(def.block);
    if (blockId === undefined) return;
    this.world.set(x, y, z, blockId);
    player.consumeHeld(1);
    audio.blockPlace();
    this.mesher.rebuildAround(x, y, z);
    if (BLOCKS[blockId].light > 0) this.relight(x, y, z);
  }

  /** 方块名 → 方块 id。 */
  blockIdOf(name) {
    for (let i = 0; i < BLOCKS.length; i++) {
      if (BLOCKS[i].name === name) return i;
    }
    return undefined;
  }

  /** 射线瞄准的方块。 */
  targetBlock(withNormal = false) {
    const origin = this.camera.position;
    const dir = this.player.lookDirection();
    const hit = raycastVoxels(this.world, origin, dir, REACH, (x, y, z) => {
      const id = this.world.get(x, y, z);
      return id !== 0 && BLOCKS[id].solid;
    });
    if (!hit) return null;
    if (withNormal) return hit;
    return { x: hit.x, y: hit.y, z: hit.z };
  }

  /** 发射箭。 */
  fireArrow(weapon) {
    const player = this.player;
    const ench = enchantSummary(player.getEnchants('bow'));
    if (!ench.infinite && player.countItem('arrow') <= 0) {
      this.notify('没有箭了！去宝箱里找找，或击杀骷髅掉落箭矢');
      return;
    }
    const charge = bowCharge(this.drawTime, weapon.drawTime);
    const speed = lerp(weapon.minSpeed, weapon.maxSpeed, charge);
    const damage = lerp(1.5, weapon.damage + ench.damage, charge);
    const dir = player.lookDirection();
    const origin = this.camera.position.clone().addScaledVector(dir, 0.6);

    // 多重射击：一次射出多支箭
    const shots = Math.max(1, ench.multishot);
    for (let i = 0; i < shots; i++) {
      const spread = (i - (shots - 1) / 2) * 0.055;
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
      this.projectiles.spawnArrow(origin, d, speed, damage, true, player, ench.pierce);
    }
    if (!ench.infinite) player.consumeItem('arrow', 1);
    player.stats.arrowsFired++;
    audio.bowRelease();
    this.viewModel.kick(0.8);
    this.crosshairSpread = 1;
  }

  /** 与方块/实体交互（打开箱子 / 使用附魔台）。 */
  interact() {
    const target = this.targetBlock();
    if (target) {
      const id = this.world.get(target.x, target.y, target.z);
      if (id === BLOCK.ENCHANTING_TABLE) {
        this.openEnchant();
        return;
      }
      if (id === BLOCK.CHEST) {
        this.openChest(target);
        return;
      }
    }
    // 没瞄准方块时，若附近有附魔台也能使用
    if (this.nearEnchantTable()) this.openEnchant();
  }

  /** 打开箱子并发放战利品（背包满时剩余物品保留在箱子里）。 */
  openChest(target) {
    const key = this.world.index(target.x, target.y, target.z);
    const meta = this.world.meta.get(key);
    if (!meta || meta.opened) {
      this.notify('这个箱子已经空了');
      return;
    }
    audio.chestOpen();
    const remaining = [];
    for (const entry of meta.loot) {
      if (this.player.giveItem(entry.item, entry.count)) {
        this.notify(`获得 ${entry.count} × ${ITEMS[entry.item]?.label || entry.item}`);
      } else {
        remaining.push(entry); // 快捷栏放不下 → 留在箱子里
      }
    }
    meta.loot = remaining;
    meta.opened = remaining.length === 0;
    if (remaining.length > 0) {
      this.notify('快捷栏已满 —— 放不下的东西还留在箱子里');
    }
  }

  /* ============================================================== */
  /*                          战斗回调                              */
  /* ============================================================== */

  /**
   * @param {any} enemy @param {number} damage @param {THREE.Vector3} dir @param {number} knockback
   */
  onEnemyHit(enemy, damage, dir, knockback) {
    const died = enemy.takeDamage(damage, knockback, dir);
    this.hitmarker = 0.9;
    this.hitmarkerKill = died;
    this.player.stats.damageDealt += damage;
    audio.swordHit();
    this.spawnParticles(enemy.center, 0x8a2b2b, 5);
    if (died) this.onEnemyKilled(enemy);
  }

  /** 敌人死亡。 */
  onEnemyKilled(enemy) {
    this.player.stats.kills++;
    this.kills++;
    const def = ENEMY_TYPES[enemy.type];
    this.killFeed.unshift({
      text: `你击杀了 ${def.label}`,
      life: 4,
      color: '#ffd0d0',
    });
    audio.zombieGroan();
    this.spawnParticles(enemy.center, 0x4a7a3a, 16, { speed: 3 });
    // 经验（附魔台消耗）
    if (def.xp) {
      const levels = this.player.addXp(def.xp);
      if (levels > 0) {
        this.notify(`升级！经验等级 Lv.${this.player.level}`);
      }
    }
    for (const drop of def.drops || []) {
      if (!this.rng.chance(drop.chance)) continue;
      const count = drop.count ? this.rng.int(drop.count[0], drop.count[1]) : 1;
      if (!ITEMS[drop.item]) continue;
      this.pickups.spawn(drop.item, count, enemy.pos.clone().setY(enemy.pos.y + 0.4));
    }
    // 护具掉落：越深的层越可能掉高级货（苦力怕自带爆炸，不掉）
    if (enemy.type !== 'creeper' && this.rng.chance(0.1)) {
      const depth = Math.max(0, FLOOR_Y.findIndex((y) => enemy.pos.y >= y - 4));
      const pool = ARMOR_DROP_POOLS[Math.min(depth, ARMOR_DROP_POOLS.length - 1)];
      this.pickups.spawn(this.rng.pick(pool), 1, enemy.pos.clone().setY(enemy.pos.y + 0.4));
    }
  }

  /** 苦力怕爆炸。 */
  explodeCreeper(creeper) {
    const pos = creeper.pos.clone().setY(creeper.pos.y + 0.6);
    audio.explode();
    this.spawnParticles(pos, 0x5cb544, 30, { speed: 6, size: 0.24 });
    this.spawnParticles(pos, 0xffffff, 12, { speed: 8, size: 0.18, life: 0.4 });

    const player = this.player;
    const d = player.pos.distanceTo(pos);
    if (d < 4.2) {
      const falloff = 1 - d / 4.2;
      const died = player.applyDamage(9 * falloff * this.difficulty.damageScale, '苦力怕');
      this.damageFlash = 0.8;
      this.onPlayerHurt('苦力怕');
      if (died) this.onPlayerDeath('苦力怕');
    }
    // 波及其他敌人
    for (const e of this.enemies.enemies) {
      if (e === creeper || e.dead) continue;
      const ed = e.pos.distanceTo(pos);
      if (ed < 4.2) {
        const dir = new THREE.Vector3().subVectors(e.pos, pos).normalize();
        const died = e.takeDamage(9 * (1 - ed / 4.2), 6, dir);
        if (died) this.onEnemyKilled(e);
      }
    }
    creeper.dead = true;
    // 自爆的苦力怕同样计入击杀：给经验、掉金锭
    this.onEnemyKilled(creeper);
    creeper.dispose();
  }

  /** 龙息爆炸。 */
  explodeFireball(pos, damage) {
    audio.explode();
    this.spawnParticles(pos, 0xff7b2a, 22, { speed: 5, size: 0.22 });
    const player = this.player;
    const d = player.pos.distanceTo(pos);
    if (d < 3.4) {
      const died = player.applyDamage(damage * (1 - d / 3.4), '末影龙');
      this.damageFlash = 0.8;
      this.onPlayerHurt('末影龙');
      if (died) this.onPlayerDeath('末影龙');
    }
  }

  /** 骷髅射箭。 */
  spawnEnemyArrow(enemy, player) {
    const origin = new THREE.Vector3(
      enemy.pos.x,
      enemy.pos.y + enemy.def.height * 0.75,
      enemy.pos.z
    );
    const dir = new THREE.Vector3(
      player.pos.x - origin.x,
      player.pos.y + 1.1 - origin.y,
      player.pos.z - origin.z
    );
    const dist = dir.length();
    dir.normalize();
    dir.y += dist * 0.018;
    dir.normalize();
    // 骷髅的箭也要吃难度伤害倍率，否则远程怪的威胁不随难度变化
    const damage = (enemy.def.arrowDamage ?? 4) * this.difficulty.damageScale;
    this.projectiles.spawnArrow(origin, dir, 16, damage, false, enemy, 0, enemy.def.label);
    audio.skeletonRattle();
  }

  /** 末影龙受击。 */
  onDragonHit(damage, dir, projectile) {
    if (!this.dragon || !this.dragon.alive) return;
    this.dragon.takeDamage(damage, dir, this);
    this.hitmarker = 0.9;
    this.hitmarkerKill = this.dragon.hp <= 0;
    this.player.stats.damageDealt += damage;
    this.spawnParticles(this.dragon.pos, 0x9b59d0, 6);
  }

  /** 末影水晶受击。 */
  onCrystalHit(crystal, dir) {
    if (!this.dragon) return;
    this.dragon.onCrystalDestroyed(crystal, this);
    this.hitmarker = 0.9;
  }

  /** 玩家受伤提示。 */
  onPlayerHurt(source) {
    this.damageFlash = Math.max(this.damageFlash, 0.55);
    this.crosshairSpread = 1;
  }

  /* ============================================================== */
  /*                          辅助逻辑                              */
  /* ============================================================== */

  /** 构造一个 THREE.Vector3（调试脚本可用）。 */
  vec(x, y, z) {
    return new THREE.Vector3(x, y, z);
  }

  /** 场景中所有可被投射物命中的末影水晶。 */
  get crystals() {
    return this.dragon ? this.dragon.crystals : [];
  }

  /** 顶部方块的 y 坐标（找不到返回 null）。 */
  solidTopAt(x, z, y) {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    for (let by = Math.floor(y) + 1; by >= Math.floor(y) - 6; by--) {
      if (this.world.isSolid(fx, by, fz)) return by + 1;
    }
    return null;
  }

  /** 重新计算光照并重建受影响的区块。 */
  relight(x, y, z) {
    this.world.computeSkyLight();
    this.world.computeBlockLight();
    this.mesher.rebuildAround(x, y, z);
  }

  /** 触发粒子。 */
  spawnParticles(pos, color, count, opts) {
    this.particles.spawn(pos, color, count, opts);
  }

  /** 提示消息。 */
  notify(text, color = '#ffffff') {
    this.notifications.unshift({ text, life: 4, color });
    if (this.notifications.length > 5) this.notifications.pop();
  }

  /**
   * 目标状态：位置 + 距离 + 是否同层 + 屏幕投影。
   *
   * 距离和层差每帧都可能变（玩家在动），所以放在这里算，
   * 而不是塞进 updateObjective 里。
   *
   * @returns {object|null}
   */
  buildObjectiveState() {
    const obj = this.objective;
    const player = this.player;
    if (!obj || !player) return null;
    const p = player.pos;
    const playerFloor = floorIndexAt(p.y);
    const objFloor = floorIndexAt(obj.y);
    return {
      x: obj.x,
      y: obj.y,
      z: obj.z,
      label: obj.label,
      distance: Math.hypot(obj.x - p.x, obj.y - p.y, obj.z - p.z),
      sameFloor: objFloor === playerFloor,
      floorIndex: objFloor,
      screen: this.projectToScreen(obj.x, obj.y, obj.z),
    };
  }

  /**
   * 把世界坐标投影到屏幕（CSS 像素）。
   *
   * 目标在相机背后时 project() 会把 x/y 镜像 —— 镜像坐标不能拿来指示方向
   * （会指到反方向），所以额外给一组「相机基底」方向量：
   * 目标方向在相机右轴 / 上轴上的分量，边缘箭头用这个。
   *
   * @param {number} x @param {number} y @param {number} z
   * @returns {{x:number, y:number, visible:boolean, dirX:number, dirY:number}}
   */
  projectToScreen(x, y, z) {
    const camDir = this.camera.getWorldDirection(this.tmpForward);
    const toPoint = this.tmpOffset.set(x, y, z).sub(this.camera.position);
    const inFront = toPoint.dot(camDir) > 0;

    // 相机右轴 = forward × up
    this.tmpRight.crossVectors(camDir, this.camera.up).normalize();
    const len = toPoint.length() || 1;
    const dirX = toPoint.dot(this.tmpRight) / len;
    const dirY = toPoint.dot(this.camera.up) / len;

    const ndc = this.tmpPoint.set(x, y, z).project(this.camera);
    const visible =
      inFront && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1;
    // 目标与相机同深度时 w = 0，投影会发散成 Infinity —— 兜底成 0
    const sx = Number.isFinite(ndc.x) ? (ndc.x * 0.5 + 0.5) * window.innerWidth : 0;
    const sy = Number.isFinite(ndc.y) ? (-ndc.y * 0.5 + 0.5) * window.innerHeight : 0;
    return {
      x: sx,
      y: sy,
      visible,
      dirX,
      dirY,
    };
  }

  /** 更新当前目标。 */
  updateObjective() {
    const player = this.player;
    if (!player) return;

    // 检查点：进入新房间时更新（找一块没有方块占用的地面，避免重生卡进方块里）
    const room = this.dungeon.nearestRoom(player.pos.x, player.pos.y, player.pos.z);
    if (room && room !== this.currentRoom) {
      this.currentRoom = room;
      this.checkpoint = this.findFreeSpot(room);
      this.notify(`发现新区域：${roomLabel(room)}`);
    }

    // 进入竞技场 → 唤醒末影龙
    if (!this.arenaTriggered) {
      const d = Math.hypot(
        player.pos.x - ARENA_CENTER.x,
        player.pos.z - ARENA_CENTER.z
      );
      if (d < ARENA_HALF + 2 && player.pos.y < ARENA_FLOOR_Y + 8) {
        this.arenaTriggered = true;
        this.spawnDragon();
      }
    }

    // BOSS 战：目标切换为最近的一颗末影水晶
    if (this.dragon && this.dragon.alive) {
      const crystals = this.dragon.crystals.filter((c) => c.alive);
      if (crystals.length > 0) {
        let best = null;
        let bestD = Infinity;
        for (const c of crystals) {
          const d = c.pos.distanceToSquared(player.pos);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        this.objective = {
          x: best.pos.x,
          y: best.pos.y,
          z: best.pos.z,
          label: '末影水晶',
        };
        this.hint = '用箭射碎末影水晶，阻断末影龙回血（碎后会掉落治疗水晶，需要再射一次）';
      } else {
        this.objective = {
          x: this.dragon.pos.x,
          y: this.dragon.pos.y,
          z: this.dragon.pos.z,
          label: '末影龙',
        };
        this.hint = '水晶已清空！用箭射击末影龙，等它栖息时也可以冲上去砍';
      }
      return;
    }

    this.hint = '';

    // 判定所在层（竖井里算上一层，指向的阶梯不会提前跳级）
    const floor = floorIndexAt(player.pos.y);

    const stairs = this.dungeon.stairs || [];
    const stair = stairs[floor];
    // 已经在竖井里往下走 → 目标是井底（阶梯出口），别让玩家回头找井口。
    // 判据是「人在井身柱体内 + 高度在两层之间」，不能只看离井口多近。
    const shaft = stairs.find(
      (st) =>
        st.shaft &&
        Math.abs(player.pos.x - st.shaft.cx) <= st.shaft.half + 0.5 &&
        Math.abs(player.pos.z - st.shaft.cz) <= st.shaft.half + 0.5 &&
        player.pos.y < st.from.y - 1.5 &&
        player.pos.y > st.to.y - 1
    );

    if (shaft) {
      this.objective = { x: shaft.to.x, y: shaft.to.y, z: shaft.to.z, label: '下行阶梯' };
    } else if (floor < stairs.length) {
      this.objective = { ...stair.from, label: '下行阶梯' };
    } else {
      this.objective = {
        x: ARENA_CENTER.x,
        y: ARENA_FLOOR_Y,
        z: ARENA_CENTER.z,
        label: '末影龙祭坛',
      };
    }

    // 上下文提示：附魔台 / 箭矢耗尽
    if (this.nearEnchantTable()) {
      this.hint = '按 E 使用附魔台 —— 消耗经验等级与材料升级武器';
    } else if (
      player.hotbar.some((s) => s && s.id === 'bow') &&
      player.countItem('arrow') <= 0
    ) {
      this.hint = '没有箭矢了！击杀骷髅或搜刮箱子（E）可以补充';
    }
  }

  /**
   * 在房间里找一块空地（用作检查点 / 重生点）。
   * @param {any} room
   * @returns {{x:number,y:number,z:number}}
   */
  findFreeSpot(room) {
    const w = this.world;
    const y = room.floorY;
    const cells = room.cells || [];
    for (const c of cells) {
      if (w.get(c.x, y, c.z) === 0 && w.get(c.x, y + 1, c.z) === 0 && w.isSolid(c.x, y - 1, c.z)) {
        return { x: c.x + 0.5, y, z: c.z + 0.5 };
      }
    }
    return { x: room.cx + 0.5, y, z: room.cz + 0.5 };
  }

  /** 创建末影龙。 */
  spawnDragon() {
    this.dragon = new Dragon(
      this.world,
      this.scene,
      {
        dragonBody: this.atlas.entity('dragon_body'),
        dragonWing: this.atlas.entity('dragon_wing'),
        crystal: this.atlas.entity('crystal'),
      },
      ARENA_CENTER,
      ARENA_FLOOR_Y,
      this.dungeon.crystalSpots
    );
    this.dragon.activate(this);
  }

  /** 根据玩家位置切换环境氛围。 */
  updateAtmosphere() {
    const uniforms = this.materials.uniforms;
    const p = this.player.pos;
    const inArena =
      Math.hypot(p.x - ARENA_CENTER.x, p.z - ARENA_CENTER.z) < ARENA_HALF + 4 &&
      p.y < ARENA_FLOOR_Y + 20;
    if (inArena) {
      uniforms.fogColor.value.set(0x1a0b2a).convertSRGBToLinear();
      uniforms.fogNear.value = 8;
      uniforms.fogFar.value = 70;
      this.scene.background.set(0x0a0512);
    } else {
      uniforms.fogColor.value.set(0x090c12).convertSRGBToLinear();
      uniforms.fogNear.value = 6;
      uniforms.fogFar.value = 48;
      this.scene.background.set(0x05070b);
    }
    // 玩家火把位置
    uniforms.torchPos.value.copy(this.camera.position);
  }

  /** 手持模型更新。 */
  updateViewModel(dt) {
    const player = this.player;
    if (!player) return;
    const speed = Math.hypot(player.vel.x, player.vel.z);
    // 手臂亮度跟随玩家所在位置的光照
    this.viewModel.setLight(this.lightLevelAt(player.pos.x, player.pos.y, player.pos.z));
    this.viewModel.update(dt, {
      moving: speed > 0.4 && player.onGround,
      speed,
      drawAmount: this.charging ? bowCharge(this.drawTime, 1) : 0,
      charging: this.charging,
      sprinting: player.sprinting,
    });
  }

  /**
   * 某点的环境亮度（0-1）。
   * @param {number} x @param {number} y @param {number} z
   */
  lightLevelAt(x, y, z) {
    const w = this.world;
    const bx = Math.floor(x);
    const by = Math.floor(y + 1);
    const bz = Math.floor(z);
    if (!w.inBounds(bx, by, bz)) return 1;
    const i = w.index(bx, by, bz);
    const light = Math.max(w.skyLight[i] || 0, w.blockLight[i] || 0);
    return Math.min(1, Math.max(0.25, light / 15));
  }

  /** 渲染 HUD。 */
  renderHud() {
    if (!this.player || !this.hud) return;
    // 准星命中检测
    const dir = this.player.lookDirection();
    const origin = this.camera.position;
    let onEnemy = false;
    for (const e of this.enemies.enemies) {
      if (e.dead) continue;
      if (rayBoxDistance(origin, dir, e.box) < 4) {
        onEnemy = true;
        break;
      }
    }
    if (!onEnemy && this.dragon && this.dragon.alive) {
      if (rayBoxDistance(origin, dir, this.dragon.hitBox()) < 4) onEnemy = true;
    }
    this.crosshairOnEnemy = onEnemy;

    const floorIndex = floorIndexAt(this.player.pos.y);
    this.hud.render({
      player: this.player,
      dragon: this.dragon,
      notifications: this.notifications,
      killFeed: this.killFeed,
      crosshairSpread: this.crosshairSpread,
      crosshairOnEnemy: this.crosshairOnEnemy,
      hitmarker: this.hitmarker,
      hitmarkerKill: this.hitmarkerKill,
      damageFlash: this.damageFlash,
      lowHealth: this.lowHealth,
      objective: this.buildObjectiveState(),
      hint: this.hint,
      minimap: {
        rooms: this.mapRooms,
        stairs: this.dungeon.stairs || [],
        corridors: this.dungeon.corridorSegments || [],
        arena: this.mapArena,
        enemies: this.enemies.enemies.map((e) => ({
          x: e.pos.x,
          z: e.pos.z,
          floorY: e.pos.y,
        })),
        chests: this.chestSpots,
        enchantSpots: this.mapEnchantSpots,
        player: {
          x: this.player.pos.x,
          z: this.player.pos.z,
          yaw: this.player.yaw,
          // 玩家实时高度（判断「是不是就在这个房间里」）
          y: this.player.pos.y,
        },
        floorIndex: floorIndex,
        // 该层的标准层高：小地图的楼层过滤全靠它，玩家在竖井里也不会把路网弄丢
        floorY: FLOOR_Y[floorIndex],
        floorCount: FLOOR_Y.length,
      },
    });
  }

  /** 调整尺寸。 */
  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.viewModel) this.viewModel.resize(w, h);
    if (this.hud) this.hud.resize();
  }
}

/**
 * 房间名称。
 * @param {any} room
 */
function roomLabel(room) {
  const map = {
    hall: '大厅',
    treasure: '宝库',
    mob: '刷怪间',
    lava: '熔岩窟',
    library: '藏书室',
    mines: '矿坑',
    crypt: '墓穴',
  };
  return map[room.theme] || '房间';
}

/* ------------------------------------------------------------------ */
/*                              启动                                 */
/* ------------------------------------------------------------------ */

const game = new Game();

game
  .init()
  .then(() => {
    const loading = document.getElementById('loading');
    if (loading) loading.hidden = true;
    game.showScreen('menu');
    game.start();
    // 菜单背景：把相机放在入口房间
    const sp = game.dungeon.spawnPoint;
    game.player.setPosition(sp.x, sp.y + 0.2, sp.z);
    game.player.yaw = 0.6;
    game.player.pitch = -0.05;
    game.player.syncCamera();
  })
  .catch((err) => {
    const label = document.getElementById('load-label');
    if (label) label.textContent = `加载失败：${err.message}`;
    throw err;
  });

window.game = game;
