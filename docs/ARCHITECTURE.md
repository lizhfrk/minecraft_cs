# 架构说明

面向开发者的深入说明。入口与雷区见 [../CLAUDE.md](../CLAUDE.md)。

---

## 1. 全景

```
                    ┌──────────────────────────────────────────┐
  index.html  ────► │  main.js : Game                          │
  (DOM 面板)         │  状态机 menu/playing/paused/help/...    │
                    └───┬───────────────┬───────────────┬─────┘
                        │               │               │
              ┌─────────▼──────┐ ┌──────▼──────┐ ┌──────▼───────┐
              │ world/         │ │ entities/   │ │ render/      │
              │  体素世界      │ │  玩家/怪/龙 │ │  HUD/手持模型│
              │  网格化        │ │  箭/掉落物  │ │  粒子        │
              └─────────┬──────┘ └──────┬──────┘ └──────┬───────┘
                        │               │               │
              ┌─────────▼───────────────▼───────────────▼──────┐
              │ weapons/  物品 · 武器数值 · 附魔                 │
              └─────────────────────┬───────────────────────────┘
                                    │
              ┌─────────────────────▼───────────────────────────┐
              │ core/  输入 · 音效 · 难度 · 角色 · 楼层 · 工具   │
              └─────────────────────────────────────────────────┘
```

**依赖方向基本是单向的**：`core` ← `world`/`entities`/`weapons` ← `render` ← `main`。
唯一的例外：`entities/` 里的 `player.js` / `enemies.js` 会 import `world/physics.js`
（碰撞解算），所以严格说是 `entities → world/physics`。
`core/` 下的 6 个模块**全部零依赖**（互不 import，也不 import 外部模块），
所以可以单独 import 进来做单测。

---

## 2. 世界生成（`world/dungeon.js`）

一次 `new Dungeon(world, seed).generate()` 的顺序：

```
fillRock()            填满岩石，底部基岩
buildFloors()         4 层，房间数 4/4/4/2（第 4 层只有 2 个，中央 2×2 单元留给竞技场），
                      共 14 个房间（4×4 单元网格，单元 32 格）
  └ createRoom()      挖房间、按主题选地板/墙/天花板材质
  └ decorateRoom()    火把、箱子、矿脉、刷怪笼、岩浆池
  └ connectFloor()    最小生成树连走廊（L 形，3 格宽）
  └ carveDescent()    往下一层：找竖井位置 → 挖 5×5 井身 → 螺旋台阶
                      竖井放在房间**斜对角**外侧，避免压坏地板和走廊
  └ placeEnchantingTable() 前三层各一座附魔台（避开岩浆房，脚下必须是实地）
buildArena()          最底层：末影石地面 + 黑曜石围墙 + 10 根水晶柱 + 末影蛋
carveDescentToArena() 最底层 → 竞技场的通道
punchArenaDoors()     走廊穿过竞技场围墙时开洞
decorateEntrance()    入口房间：工作台、熔炉、补给箱、出生点
world.relight()       天光/块光 BFS 泛洪
```

关键数据：

| 字段 | 含义 |
|---|---|
| `rooms[]` | 所有房间，`floor` = 层序号（0=第 1 层），`floorY` = 地板高度 |
| `stairs[]` | `{from: 房间墙角门洞, to: 井底出口, shaft: {cx,cz,half} 井身, nextY}` |
| `corridorSegments[]` | 轴对齐的走廊线段 `{x1,z1,x2,z2,y}` —— 小地图画路网用 |
| `enchantSpots[]` | 附魔台坐标 |
| `crystalSpots[]` | 竞技场水晶柱坐标 |

竖井的 `from`（门洞）和 `shaft`（井身）是**两个不同的位置** —— 判断「玩家在不在井下」要用 `shaft`。

---

## 3. 渲染管线

```
atlas.js  buildAtlas()
   Canvas 逐像素画 16×16 贴图 → 打包成一张纹理图集
   ├─ tileRect(name)   → 方块贴图 UV
   └─ entity(name)     → 实体 16×16 贴图（打包时共用一张 sheet，最终每个实体是独立的 CanvasTexture）

mesher.js  WorldMesher
   按 16×16 的区块（chunk）遍历体素
   ├─ 只输出可见面（faceVisible）
   ├─ 烘焙光照：world.computeSkyLight() + computeBlockLight()（BFS 泛洪）
   ├─ 顶点 AO（相邻方块遮挡）+ 平滑光照（4 邻域平均）
   └─ 颜色乘进顶点色（materials.js 的着色器再叠火把光与雾）

viewmodel.js  第一人称模型
   独立场景 → renderer.clearDepth() 后单独渲染 → 不与世界产生深度冲突
```

方块改动后调 `mesher.rebuildAround(x, y, z)` 重建附近区块；
光照改动后调 **`game.relight(x, y, z)`**（`main.js` 里的封装 = 重算天光/块光 + 重建网格）——
不要直接调 `world.relight()`，那样会漏掉网格重建。

---

## 4. HUD 契约

`main.js` 每帧调 `hud.render(state)`，`state` 是**现拼的快照**：

```js
{
  player, dragon, notifications, killFeed,
  crosshairSpread, crosshairOnEnemy, hitmarker, hitmarkerKill,
  damageFlash, lowHealth,
  objective: {                      // buildObjectiveState() 产出
    x, y, z, label,
    distance,                        // 3D 直线距离（米）
    sameFloor, floorIndex,           // 目标是否同层 / 目标所在层
    screen: { x, y, visible, dirX, dirY },  // 屏幕投影 + 相机基底方向量
  },
  hint,                             // 底部提示条文字
  minimap: {
    rooms: [{cx,cz,halfW,halfD,floorY,floor,name}],
    corridors, stairs, arena,
    enemies: [{x,z,floorY}], chests, enchantSpots,
    player: {x, z, yaw, y},
    floorIndex, floorY,              // floorY = 该层的标准层高
    floorCount,
  },
}
```

HUD 内部拆成三层，**纯逻辑与绘制分离**，这样纯逻辑可以脱离画布直接断言：

| 文件 | 内容 | 可测性 |
|---|---|---|
| `hud-vitals.js` | `heartRowFills` / `foodRowFill` / `computeVitalsLayout` | 纯函数，直接 import 测 |
| `hud-nav.js` | `buildMinimapLayout` / `buildEdgeMarker` / `objectiveBearingAngle` / `floorArrow` | 纯函数 |
| `hud-minimap.js` | 小地图、目标条、边缘箭头的绘制 | 靠像素断言 |
| `hud.js` | HUD 主类，其余绘制（血条、快捷栏、BOSS 条、通知、击杀信息…） | 靠像素断言 |

**单位约定**（最容易出错的地方）：
- 血条 / 饥饿条：**1 格 = 2 点**
- 距离：**米**
- 小地图：`MAP_SPAN = 144` 世界单位铺满面板，`MAP_ORIGIN = 8` 是覆盖区起点

---

## 5. 实体模型

| 类 | 文件 | 要点 |
|---|---|---|
| `Player` | `entities/player.js` | AABB 碰撞、生命/饥饿/经验、`armorSlots{head,chest,legs}`、附魔挂在 `this.enchants[id]` |
| `EnemyManager` | `entities/enemies.js` | 四种小怪 + 刷怪笼；刷怪有**四道门**（附近上限 / 单笼上限 / 不叠格不贴脸 / 间隔+浮动） |
| `Dragon` | `entities/dragon.js` | 末影龙 + 10 颗末影水晶，飞行时瞬移 |
| `ProjectileManager` | `entities/projectiles.js` | 箭（有重力）与龙息火球 |
| `PickupManager` | `entities/pickups.js` | 掉落物；防具在 `count === 1` 时自动穿戴 |

刷怪上限与难度预设都在 `core/difficulty.js`，改怪多不要去改 `enemies.js` 的常量。

---

## 6. 玩法数据

| 内容 | 位置 |
|---|---|
| 物品（含 `desc` 说明、防具 `defense`） | `weapons/items.js` |
| 武器数值 | `weapons/weapons.js` |
| 附魔（`kind: 'armor'` 的 4 条防具附魔） | `weapons/enchants.js` |
| 难度（刷怪上限 / 间隔 / 伤害倍率） | `core/difficulty.js` |
| 角色外观与起始补给 | `core/characters.js` |
| 楼层高度 | `core/floors.js` |

物品图鉴、指南文案在 `index.html`（DOM）与 `hud.js`（Canvas）两处。

---

## 7. 持久化

`localStorage`，两个键：

| 键 | 内容 | 模块 |
|---|---|---|
| `mc-cs-difficulty` | 难度 id | `core/difficulty.js` |
| `mc-cs-character` | 角色 id | `core/characters.js` |

读取时用 `Object.hasOwn(CHARACTERS, saved)` 防原型污染；隐私模式下 `localStorage` 抛异常要 try/catch。

---

## 8. 渲染顺序（`hud.js` 的 `render(state)`）

```
受击红晕 → 低血量心跳 → 准星 → 快捷栏 → 手持物品面板 → 血条/防具/饥饿/经验
→ BOSS 血条 → 通知 → 击杀信息 → 顶部罗盘箭头 → 顶部目标条 → 小地图 → 屏幕边缘箭头 → 底部提示条
```

后画的盖先画的 —— 摆放 HUD 元素时要记住这个顺序：

- **击杀信息**被挪到了**屏幕下方**（y = 210*s）来避开右上角的小地图 ——
  注意 z-order 上小地图仍画在击杀信息**之后**（会盖住它），所以两者只能靠**错开位置**解决；
- **边缘箭头**画在**小地图之后**，万一重叠也看得见；
- **底部提示条**最后画，会盖住它下面的一切。
