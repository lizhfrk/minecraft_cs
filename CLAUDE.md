# CLAUDE.md · MINECRAFT: 地下城突袭

面向 **AI agent / 新接手开发者** 的入口文档。用户向的手册在 [README.md](README.md)。

> 本项目是《我的世界》题材的**第一人称地牢射击游戏**（Three.js + 原生 ES module + Vite）。
> **零外部资源** —— 所有贴图是 Canvas 逐像素画的，音效是 WebAudio 合成的，地牢是算法生成的。
> 不要引入 `.png` / `.mp3` / 模型文件，除非同时改掉「无外部资源」这个前提。

---

## 1. 三分钟跑起来

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 12 个套件 167 项断言（约 4 分钟）
npm run build        # 生产构建
```

**测试全部依赖 `npm run dev` 在跑**（`tools/*.py` 打的是 `http://localhost:5173`）。
跑测试时**不要同时改源文件** —— Vite 的 HMR 会重载页面，`window.game` 会变成 undefined，
测试会以 `TypeError: Cannot set properties of undefined` 失败（这个坑踩过两次）。

进阶文档：
- 架构与数据流 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 测试体系与新增套件 → [docs/TESTING.md](docs/TESTING.md)

> ⚠️ **本项目还没有纳入版本控制**（目录下没有 `.git`）。
> 改代码前没有 diff 可看、改坏了没法回滚 —— 动 `main.js` / `dungeon.js` 这种大文件之前，
> 先 `cp` 一份备份，或者先 `git init` 再动手。

---

## 2. 目录地图

```
src/
├── main.js              游戏主类（约 2100 行）：状态机、战斗、交互、UI 面板
├── core/
│   ├── input.js         键鼠输入 + 指针锁定
│   ├── audio.js         WebAudio 程序化音效（单例 audio）
│   ├── difficulty.js    难度预设（刷怪上限 / 间隔 / 伤害倍率）
│   ├── characters.js    可选主角（史蒂夫 / 杰杰 / 麦琪）+ localStorage
│   ├── floors.js        楼层高度 FLOOR_Y 与 floorIndexAt()
│   └── utils.js         RNG、clamp/lerp/damp、体素射线步进
├── world/
│   ├── blocks.js        方块注册表（贴图 / 硬度 / 光照 / 碰撞）
│   ├── atlas.js         16×16 像素纹理图集（Canvas 逐像素绘制）
│   ├── materials.js     世界着色器（烘焙光照 + 火把 + 距离雾）
│   ├── mesher.js        体素网格化（AO 环境光遮蔽 + 平滑光照）
│   ├── physics.js       AABB 碰撞解算 + 自动上台阶
│   ├── world.js         体素存储 + 天光/块光 BFS 传播
│   └── dungeon.js       地牢生成（房间 / 走廊 / 螺旋竖井 / 竞技场）
├── entities/
│   ├── player.js        玩家移动、生命、快捷栏、经验、防具槽
│   ├── enemies.js       四种小怪的 AI、刷怪笼、难度门控
│   ├── dragon.js        末影龙与末影水晶
│   ├── projectiles.js   箭与龙息火球
│   ├── pickups.js       掉落物
│   └── models.js        方块实体模型
├── weapons/
│   ├── items.js         物品注册表（含 desc 说明与防具）
│   ├── weapons.js       武器数值
│   └── enchants.js      附魔定义与效果
└── render/
    ├── hud.js           HUD 主类（Canvas 2D）
    ├── hud-vitals.js    血条 / 饥饿条的纯逻辑（可单测）
    ├── hud-nav.js       导航的纯逻辑（小地图布局、边缘箭头）
    ├── hud-minimap.js   小地图 / 目标条 / 边缘箭头的绘制
    ├── portrait.js      主菜单角色像素立绘
    ├── viewmodel.js     第一人称手持模型
    └── particles.js     粒子特效

tools/*.py               Playwright 测试与截图脚本（见 docs/TESTING.md）
index.html               所有 DOM UI（菜单 / 指南 / 装备面板 / 附魔台）
```

**行数红线**：单个文件 **< 800 行**，单个函数 **< 50 行**（项目规范）。
（`README.md` 里也有一份 src 树，两处内容重复 —— **以本文件为准**，改了记得同步。）
**当前已超标**：`main.js`（2000 行出头）、`world/dungeon.js`（1064）、`world/atlas.js`（911）；
`main.js` 里的 `renderEquipmentPanel` / `updateObjective` / `populateRooms` / `setupUI` /
`renderHud` / `handleActions` 也都超过 50 行。新代码不要往里堆，
往 `core/` `render/` 的小模块下沉。

---

## 3. 帧循环（`main.js` 的 `update(dt)`）

```
handleGlobalKeys()
if (state === 'playing'):
    player.update(dt, input)      →  血量 <= 0 直接进死亡结算（兜底，别删）
    handleKeys() / handleActions(dt)
    enemies.update → projectiles.update → pickups.update → dragon.update
    particles.update
    updateObjective()              →  决定当前目标（下行阶梯 / 水晶 / 末影龙）
    updateAtmosphere()              →  雾色、雾距
updateViewModel(dt)                →  第一人称模型的摆动 / 拉弓
renderHud()                        →  每帧重建 HUD 状态快照并绘制
```

渲染是**两个场景**：世界场景 + 第一人称模型场景（`viewmodel.js`），后者用 `clearDepth()` 单独画。

---

## 4. ⚠️ 雷区（改之前先读这段）

这些是**改错了不会报错、只会让游戏悄悄变怪**的地方。每一条都是本项目真实踩过的坑。

### 4.1 血条 / 饥饿条的「1 格 = 2 点」单位
`hud-vitals.js` 的 `rowFill(value, maxValue)` 里，`value` 是**点数**（不是心数）。
调用方再除以 2 就是「除以两次」—— 满血 20 点只会亮 5 颗心。**永远直接传点数。**
护甲减伤会让血量变成小数（17.9），半格判定用 `> 0` 而不是 `=== 1`，否则 1.5 血会画成空条。

### 4.2 HUD 状态是每帧重建的**快照**
`hud.render({...})` 的入参是 `main.js` 每帧现拼的对象。**不要在 HUD 里缓存游戏状态**。
静态数据（房间 / 走廊 / 附魔台 / 竞技场 / 箱子）在 `init()` 里缓存成 `this.mapRooms` 等，
每帧只重建会动的部分（敌人数组）。

### 4.3 测试里不要 `import('/src/main.js')`
Vite 在源文件变更后会给入口脚本加上 `?t=<时间戳>`，此时再 `import('/src/main.js')`
在浏览器眼里是**另一个模块实例** → 入口重新执行一遍 → `window.game` 被换成新实例，
而新实例的 `player` 要等 `init()`（异步）才建好，于是下一条断言就炸在
`Cannot read properties of undefined (reading 'pos')` 上。
URL 完全一致时浏览器会走模块缓存、不会重复执行 —— 所以这个坑**时有时无**，更难查。
要测 main.js 里的纯函数，就把它们挪到独立模块（`src/core/floors.js` 就是这么拆出来的）。

### 4.4 楼层判定有两个语义，别混
- `floorIndexAt(y)`：取**离 y 最近**的一层，平局归**上层**（玩家在竖井里算上一层）
- 小地图的楼层过滤要用 `map.floorY`（该层的**标准层高** `FLOOR_Y[floorIndex]`），
  **不是**玩家实时高度 —— 否则玩家在竖井里时整张地图的路网会消失

### 4.5 竖井几何：`stairs[].from` 不是井身
`from` 是**房间墙角的门洞**；井身是 5×5 的柱体，记在 `stairs[].shaft = {cx, cz, half}`。
判断「玩家是不是正在井下」必须用 `shaft`，用 `from` 会永远判不成立。
注意：**找不到井位时的兜底路径**（`carveDescentFallback`）push 的 stairs **没有 `shaft` 字段**，
读之前先判空。

### 4.6 yaw / 相机基底约定
- 玩家朝向：`forward = (-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))`（pitch=0 时就是 `(-sin yaw, 0, -cos yaw)`）
- 玩家的「地图方位角」= `-yaw`；目标相对角度 = `atan2(dx, -dz) + yaw`（**是加号**）
- 相机右轴 = `forward × up`；目标在相机背后时 NDC 投影是**镜像**的，
  拿它算屏幕方向会**指到反方向** —— 必须用相机基底分量 `dirX/dirY`（见 `projectToScreen`）

### 4.7 房间用 `r.floor`（层序号）过滤，不要用 `floorY`
不同层的房间可能占同一个格子，只有层序号能区分。

### 4.8 `world.meta` 不会自动清理
箱子/附魔台的战利品写在 `world.meta`（房间里的箱子**和入口的补给箱**都走这条路径），
挖掉方块时**不会**自动删。
地图上的标记要手动同步（见 `breakBlock` 里对 `chestSpots` / `mapEnchantSpots` 的处理）。

### 4.9 常量要有单一来源
楼层高度 → `core/floors.js`；难度 → `core/difficulty.js`；角色 → `core/characters.js`；
物品与防具 → `weapons/items.js`；附魔 → `weapons/enchants.js`。
**别复制第二份**（曾出现过 `dungeon.js` 和 `main.js` 各一份 `FLOOR_Y`）。

### 4.10 改了 `index.html` 的指南板块数，要同步 `tools/help_test.py`
那个测试把「板块数 / 键位数」写死了。

### 4.11 动态文本一律 `textContent`，`innerHTML` 只插常量表里的名字和数字
HUD 是纯 Canvas（用 `fillText`）；DOM 面板里的动态文本用 `textContent`。
`main.js` 里的 `innerHTML` 只允许插值**常量表**里的名字（物品名 / 附魔名）与**数字**，
不要把玩家可控的文本拼进去。

---

## 5. 代码约定

- ES module + 纯 JS，JSDoc 标注公开 API；常量用 `UPPER_SNAKE`，函数 `camelVar`
- 导出函数要写清**单位**（点数 / 格 / 米）和**返回值语义** —— 本项目一半的 bug 都出在单位上
- 纯逻辑优先做成**无外部依赖的纯函数**并导出（`hud-vitals.js` 零依赖、`hud-nav.js` 只依赖 `core/floors.js`、
  `core/floors.js` 零依赖），这样才能脱离画布直接断言
- 不提交外部资源文件；不用 `console.log`（用 `notify()`）

---

## 6. 加一个测试套件

1. 在 `tools/` 新建 `xxx_test.py`，照抄 `tools/nav_test.py` 的骨架
   （`sync_playwright` → `page.goto` → 等 `#loading` 隐藏 → 断言 → 非零退出码）
2. `package.json` 加 `"test:xxx": "python3 tools/xxx_test.py"`，并串进 `test` 链
3. **纯函数**用 `page.evaluate("async () => { const m = await import('/src/xxx.js'); ... }")` 直接测
4. **画面**用读 `#hud` canvas 像素的方式断言（`getImageData`），采样区要用布局函数给的**精确坐标**，
   不要用 `0.78h` 这种魔法比例
5. 跑 `python3 tools/xxx_test.py` 确认，再跑全量 `npm test`

细节见 [docs/TESTING.md](docs/TESTING.md)。

---

## 7. 当前状态

**已实现**：四层程序化地牢 + 末影龙 BOSS、剑/斧/弓三种武器、经验与附魔台（武器 + 防具）、
防具三部位与升级、刷怪上限与三档难度、三位可选主角、完整物品图鉴与操作指南、
小地图分层导航与目标指引、连通风水（100 种子回归）。

**已知限制**（有意为之，不是 bug）：
- 没有存档，刷新即重开（可加 `?seed=`）
- 敌人 AI 是直线追击，没有寻路
- 没有摔落伤害
- 没做移动端触控 / 手柄

**进行中 / 可接手的方向**：
- `main.js` 体积治理（拆 UI 面板与战斗逻辑）
- 敌人寻路（迷宫式房间 + 走廊拓扑）
- 更多主角 / 武器 / 附魔
- 存档系统
