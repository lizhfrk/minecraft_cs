/**
 * 可选主角：史蒂夫 / 杰杰 / 麦琪。
 *
 * 形象与配色参照 MineCrasher（2.5D 像素清关游戏）里的同名角色，
 * 逐像素取自那边的调色板：史蒂夫是经典方块人，杰杰是红卫衣少年，
 * 麦琪是背上背着龟壳的小乌龟。
 *
 * 每个角色影响两处外观：
 *  - 第一人称手臂（袖子与皮肤颜色）；
 *  - 主菜单里的像素立绘。
 *
 * @module core/characters
 */

/**
 * @typedef {object} CharacterDef
 * @property {string} id 唯一 id
 * @property {string} name 显示名
 * @property {string} desc 一句话介绍
 * @property {string} perk 特殊能力（起始补给）
 * @property {{item:string, count:number}[]} bonus 额外的起始物品
 * @property {object} palette 配色
 * @property {object} arm 第一人称手臂的配色
 */

/** @type {Record<string, CharacterDef>} */
export const CHARACTERS = {
  steve: {
    id: 'steve',
    name: '史蒂夫',
    desc: '经典方块人，大胡子矿工',
    perk: '均衡 —— 标准装备',
    bonus: [],
    palette: {
      hair: '#3F2A14',
      hairDk: '#2A1A08',
      skin: '#FEA768',
      skinDk: '#C8854A',
      skinHand: '#FEA768',
      skinLight: '#FFC48C',
      beard: '#3F2A14',
      eyeWhite: '#FFFFFF',
      eyeIris: '#5C5C8A',
      eyePupil: '#161942',
      shirt: '#02B5DF',
      shirtDk: '#0186A8',
      shirtLight: '#4CC9EA',
      shirtCuff: '#0186A8',
      belt: '#6B3A0A',
      beltBuckle: '#D4A028',
      pants: '#333B7A',
      pantsDk: '#1F2456',
      pantsMid: '#262D61',
      shoe: '#5A5A5A',
      shoeTip: '#7A7A7A',
    },
    arm: {
      sleeve: '#02B5DF',
      sleeveDk: '#0186A8',
      sleeveLight: '#4CC9EA',
      cuff: '#0186A8',
      skin: '#FEA768',
      skinDk: '#C8854A',
      skinLight: '#FFC48C',
    },
  },
  jiejie: {
    id: 'jiejie',
    name: '杰杰',
    desc: '红色卫衣少年，机械发明家',
    perk: '机械发明家 —— 起始多带铁锭 ×3、火把 ×4',
    bonus: [
      { item: 'iron', count: 3 },
      { item: 'torch', count: 4 },
    ],
    palette: {
      hair: '#5C342C',
      hairHi: '#615543',
      skin: '#FEBC99',
      skinDk: '#C89878',
      skinHand: '#E3BB88',
      skinLight: '#FFD9BB',
      beard: null,
      eyeWhite: '#FCFFFF',
      eyeIris: '#84C2D7',
      eyeIrisDeep: '#63CDF4',
      eyeShine: '#E5E4FF',
      eyePupil: '#1A1A26',
      shirt: '#AC0000',
      shirtDk: '#1D0000',
      shirtHem: '#200000',
      shirtLight: '#D42A2A',
      shirtCuff: '#FFFFFF',
      inner: '#FEFCFD',
      innerDk: '#C8C8D0',
      belt: '#000500',
      pants: '#101010',
      pantsDk: '#1A1A1A',
      pantsMid: '#262626',
      shoe: '#FF00ED',
      shoeDeep: '#CC1E91',
      shoeTip: '#FEFFFF',
    },
    arm: {
      sleeve: '#AC0000',
      sleeveDk: '#1D0000',
      sleeveLight: '#D42A2A',
      cuff: '#FFFFFF',
      skin: '#FEBC99',
      skinDk: '#C89878',
      skinLight: '#FFD9BB',
    },
  },
  maiqi: {
    id: 'maiqi',
    name: '麦琪',
    desc: '绿色小乌龟，植物好朋友',
    perk: '植物好朋友 —— 起始多带面包 ×2、治疗药水 ×1',
    bonus: [
      { item: 'bread', count: 2 },
      { item: 'potion', count: 1 },
    ],
    palette: {
      hair: null,
      // 麦琪的「皮肤」就是龟的身体绿
      skin: '#4EAC32',
      skinDk: '#3E9826',
      skinEdge: '#2E831C',
      skinLight: '#58B63C',
      skinShine: '#6ACC4A',
      beard: null,
      eye: '#0A0A0A',
      eyeWhite: '#0A0A0A',
      eyeIris: '#0A0A0A',
      eyePupil: '#0A0A0A',
      eyeShine: '#FFFFFF',
      mouth: '#D42828',
      tongue: '#FF5050',
      mouthDk: '#8A1818',
      shell: '#81740B',
      shellDk: '#66620B',
      shellHi: '#A89D14',
      shellDkr: '#4A4408',
      shirt: '#4EAC32',
      shirtDk: '#3E9826',
      shirtLight: '#6ACC4A',
      shirtCuff: '#81740B',
      belt: '#4A4408',
      pants: '#3E9826',
      pantsDk: '#2E831C',
      shoe: '#3E9826',
      shoeTip: '#2E831C',
    },
    arm: {
      // 肩膀上是龟壳，其余是绿色的手脚
      sleeve: '#81740B',
      sleeveDk: '#66620B',
      sleeveLight: '#A89D14',
      cuff: '#4EAC32',
      skin: '#4EAC32',
      skinDk: '#3E9826',
      skinLight: '#58B63C',
    },
  },
};

/** 默认角色。 */
export const DEFAULT_CHARACTER = 'steve';

/** 角色在本地存储里的键。 */
const STORAGE_KEY = 'mc-cs-character';

/**
 * 读取玩家上次选择的角色。
 * @returns {CharacterDef}
 */
export function loadCharacter() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && Object.hasOwn(CHARACTERS, saved)) return CHARACTERS[saved];
  } catch {
    // localStorage 不可用（隐私模式等），退回默认角色
  }
  return CHARACTERS[DEFAULT_CHARACTER];
}

/**
 * 记住玩家选择的角色。
 * @param {string} id
 */
export function saveCharacter(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 存不进去也不影响本次游戏
  }
}
