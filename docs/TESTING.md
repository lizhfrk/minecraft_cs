# 测试体系

本项目用 **Playwright + Python** 做端到端测试：脚本驱动真实浏览器跑真实游戏，
通过 `window.game` 读取游戏内部状态做断言。

> **前置条件**：`npm run dev` 必须在跑。所有脚本都打 `http://localhost:5173`。

---

## 1. 跑

```bash
npm test                # 全量：13 个套件，约 5 分钟
npm run test:nav        # 单个套件
python3 tools/nav_test.py   # 也可以直接跑
npm run test:seeds      # 100 个种子的地牢回归（慢，没串进 test 链）
```

全量链路（`package.json` 的 `test`，13 个套件）：

```
connectivity → gameplay → soak → physics → enchant → regression
→ help → spawn → armor → character → hud → nav → skeleton
```

`test:seeds` 单独跑（100 个种子 × 完整 BFS，太慢，没串进 `test` 链）。
改地牢生成算法后**务必单独跑一次**。

---

## 2. 各套件覆盖什么

| 套件 | 脚本 | 检查 | 覆盖 |
|---|---|---|---|
| `test:connectivity` | `check_connectivity.py` | 房间/竖井/竞技场 | **BFS 模拟玩家移动能力**（可上 1 格台阶、可下落、被非实心方块阻挡），确保每个房间、每段竖井、竞技场入口都可达 |
| `test:seeds` | `check_seeds.py` | 100 个种子 | 连通性在 100 个种子上重复（12 个固定 + 88 个连续编号，**全是确定值不是随机**）—— 竖井挖穿走廊、竞技场没开门这类问题都会在这里暴露 |
| `test:gameplay` | `gameplay_test.py` | 11 | 玩法闭环：弓箭命中、BOSS 击杀、死亡重生、进食、开箱、挖掘放置 |
| `test:soak` | `soak_test.py` | 7 | 真实键鼠输入、移动/跳跃/攻击/爬台阶、长时间运行稳定性 |
| `test:physics` | `physics_test.py` | 6 | 物理回归：实体不会飞起来、台阶仍能跨上 |
| `test:enchant` | `enchant_test.py` | 12 | 经验与附魔：附魔台、锋利、火焰、无限、穿透 |
| `test:regression` | `regression_test.py` | 6 | 玩法回归：敌人射箭、岩浆致死、开箱、附魔台、界面状态 |
| `test:help` | `help_test.py` | 8 | 操作指南的三个入口 + **板块数/键位数/图鉴条目数** |
| `test:spawn` | `spawn_test.py` | 16 | 刷怪上限：三档难度下怪物数不超限、不叠格、难度可记忆 |
| `test:armor` | `armor_test.py` | 29 | 防具：装备槽、减伤、附魔、荆棘、自动穿戴、掉落 |
| `test:character` | `character_test.py` | 11 | 主角：立绘、切换、手臂配色、起始补给、选择记忆 |
| `test:hud` | `hud_test.py` | 23 | HUD：满血必须是满格、奇数血半格、小数血、变长血条、几何对齐 |
| `test:nav` | `nav_test.py` | 38 | 导航：小地图分层、目标标记、边缘箭头、罗盘方向、竖井目标 |
| `test:skeleton` | `skeleton_test.py` | 11 | 骷髅手感：近战够得到、15 米外箭能命中、不隔墙放箭、箭矢供给、困难难度数值 |

非测试脚本：

```bash
python3 tools/beauty_shots.py   # 各场景取景截图
python3 tools/check_ui.py       # 难度选择 / 手持物品面板 / 物品图鉴 截图
python3 tools/smoke_test.py     # 冒烟测试 + 截图
python3 tools/dump_atlas.py     # 导出纹理图集
python3 tools/dump_slice.py     # 导出某个方块的贴图切片（调试用）
```

---

## 3. 脚本骨架

> `check_connectivity.py` 与 `check_seeds.py` 是**老式脚本**，不走下面的 `check()` 框架
> （它们直接打印并 `sys.exit(0/1)`，所以它们的检查项不计入「178 项断言」）。
> 其余套件都照抄 `tools/nav_test.py`：

```python
"""套件说明。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    if not ok:
        failures.append(name)


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="domcontentloaded")
        # 等地牢生成完（#loading 带上 hidden 属性）
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        # ... 断言 ...
        check("无页面错误", not errors, str(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} 项失败")
        sys.exit(1)
    print("\n全部通过")


if __name__ == "__main__":
    main()
```

要点：
- 失败要**非零退出码**，否则 CI / `npm test` 链发现不了
- 收集 `pageerror` —— JS 报错会让后面的断言全变成假失败
- 用 `page.wait_for_timeout` 而不是固定 sleep 之外的东西；等待条件用 `wait_for_function`

---

## 4. 三种断言方式

### 4.1 读游戏内部状态（首选）

`window.game` 暴露了主类实例：

```python
page.evaluate("() => window.game.player.health")
page.evaluate("() => window.game.buildObjectiveState().screen")
page.evaluate("() => window.game.dungeon.stairs[0].shaft")
```

### 4.2 直接测纯函数模块

纯逻辑模块用 `import()` 在页面里加载后直接调：

```python
page.evaluate("""async () => {
  const m = await import('/src/render/hud-nav.js');
  return m.buildMinimapLayout(map, objective, opts);
}""")
```

⚠️ **不要 `import('/src/main.js')`** —— Vite 会给入口脚本加 `?t=<时间戳>`，
此时这个 import 在浏览器眼里是**另一个模块实例**：入口重新执行、`window.game` 被换掉，
新实例的 `player` 还没建好（`init()` 是异步的），下一条断言就炸在
`Cannot read properties of undefined (reading 'pos')`。
URL 完全一致时走模块缓存、不会重复执行 —— 所以这个坑**时有时无**。
要测 main.js 里的纯函数就把它挪到独立模块（`src/core/floors.js` 就是这么拆出来的）。

### 4.3 读 canvas 像素（画面的断言）

HUD 是 Canvas 2D，只能靠像素断言：

```python
page.evaluate("""() => {
  const c = document.getElementById('hud');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i+1] < 90 && d[i+2] < 90 && d[i+3] > 200) n++;
  }
  return n;
}""")
```

**采样区要用布局函数给出的精确坐标**，别用 `0.78h` 这种魔法比例 —— HUD 上任何一处
新增的红色元素都会污染采样。比如 `hud_test.py` 是先调 `computeVitalsLayout()` 拿到
心形的精确矩形，再去数那个矩形里的红像素。

---

## 5. 陷阱

| 坑 | 说明 |
|---|---|
| **测试期间不要改源文件** | Vite HMR 会重载页面，`window.game` 变 undefined，报 `TypeError: Cannot set properties of undefined` |
| **别在测试里 import 入口模块** | 见 4.2 |
| **相机要等一帧** | 改 `player.yaw` 后相机不会立刻跟着转，要 `wait_for_timeout(200)` 再断言投影 |
| **回血会改血量** | 断言血量前先 `player.hunger = 0` 或 `player.regenTimer = 0` 锁死 |
| **种子相关的断言别写死** | 「目标在身后」这类取决于随机房间选择，改种子就红 |
| **别硬编码期望像素数** | 从导出的掩码现场数格子（`HEART_MASK.join('').split('X').length - 1`），别写死 47 |
| **`dpr` 影响像素** | 期望值要乘 `scale * scale * dpr * dpr` |
| **改 `index.html` 板块数** | `tools/help_test.py` 把板块数 / 键位数写死了，要同步 |

---

## 6. 新增套件

1. `tools/xxx_test.py` —— 照第 3 节骨架
2. `package.json`：
   ```json
   "test:xxx": "python3 tools/xxx_test.py"
   ```
   并把 `test:xxx` 串进 `test` 链
3. 纯逻辑优先做成**无依赖的纯函数并导出**，这样能脱离画布断言
4. 跑 `python3 tools/xxx_test.py` → 再跑全量 `npm test`
5. 在 [../CLAUDE.md](../CLAUDE.md) 的套件表里补一行
