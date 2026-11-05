"""HUD 生命 / 饥饿条测试。

回归重点：
  1. 每颗心代表 2 点生命 —— 之前调用方把点数先除以 2 换算成「心数」，
     而绘制函数又按「半格 = 1 点」处理，等于除以两次，满血时只亮 5 颗心。
  2. 小数血量（护甲减伤会造成）不能被画成空心。
  3. 血条变长时（护甲「生命」附魔）不能被中间的经验条盖住。
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    if not ok:
        failures.append(name)


# 在页面里算出的 HUD 状态与像素统计
PROBE = """async () => {
  const m = await import('/src/render/hud.js');
  const hud = window.game.hud;
  const p = window.game.player;
  const layout = m.computeVitalsLayout(p, hud.width, hud.height, hud.scale);
  const ctx = hud.canvas.getContext('2d');

  const countIn = (x, y, w, h, match) => {
    const d = ctx.getImageData(
      Math.floor(x * hud.dpr), Math.floor(y * hud.dpr),
      Math.ceil(w * hud.dpr), Math.ceil(h * hud.dpr)
    ).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (match(d[i], d[i + 1], d[i + 2], d[i + 3])) n++;
    }
    return n;
  };

  // 红心：#e02b2b
  const isRed = (r, g, b, a) => r > 200 && g < 90 && b < 90 && a > 200;
  // 鸡腿：#c8873c
  const isFood = (r, g, b, a) =>
    r > 170 && r < 230 && g > 105 && g < 165 && b > 30 && b < 95 && a > 200;

  const rowWidth = (n) => n * (layout.iconSize + layout.rowGap);
  const iconH = m.HEART_MASK.length * hud.scale;
  const maskPixels = m.HEART_MASK.join('').split('X').length - 1;
  const foodMaskPixels = m.FOOD_MASK.join('').split('X').length - 1;
  const unit = maskPixels * hud.scale * hud.scale * hud.dpr * hud.dpr;
  const foodUnit = foodMaskPixels * hud.scale * hud.scale * hud.dpr * hud.dpr;

  return {
    health: p.health,
    maxHealth: p.maxHealth,
    mainFills: layout.heart.fills,
    overflowFills: layout.overflow.fills,
    mainRed: countIn(layout.heart.x, layout.heart.y, rowWidth(layout.heart.fills.length), iconH, isRed),
    overflowRed: layout.overflow.fills.length
      ? countIn(layout.overflow.x, layout.overflow.y, rowWidth(layout.overflow.fills.length), iconH, isRed)
      : 0,
    foodOrange: countIn(layout.food.x, layout.food.y, rowWidth(layout.food.fills.length), iconH, isFood),
    unit,
    foodUnit,
    geometry: {
      heartRight: layout.heart.x + rowWidth(layout.heart.fills.length) - layout.rowGap,
      hotbarRight: layout.hotbarX + layout.total,
      heartLeft: layout.heart.x,
      xpRight: layout.xp.x + layout.xp.w,
      overflowBottom: layout.overflow.y + iconH,
      armorTop: layout.armor.y,
      overflowRight: layout.overflow.fills.length
        ? layout.overflow.x + rowWidth(layout.overflow.fills.length) - layout.rowGap
        : null,
    },
  };
}"""


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )

        # ---------- 1. 填充状态计算 ----------
        fills = page.evaluate(
            """async () => {
              const m = await import('/src/render/hud.js');
              return {
                full: m.heartRowFills(20, 20),
                half: m.heartRowFills(10, 20),
                odd: m.heartRowFills(11, 20),
                frac: m.heartRowFills(1.5, 20),
                fracHigh: m.heartRowFills(19.1, 20),
                dead: m.heartRowFills(0, 20),
                over: m.heartRowFills(24, 24),
                nan: m.heartRowFills(NaN, 20),
                nanMax: m.heartRowFills(20, NaN),
                foodFull: m.foodRowFill(20),
                foodEmpty: m.foodRowFill(0),
                foodNan: m.foodRowFill(NaN),
              };
            }"""
        )
        check(
            "满血（20/20）画满 10 颗心",
            fills["full"]["main"] == [2] * 10 and fills["full"]["overflow"] == [],
            str(fills["full"]),
        )
        check(
            "半血（10/20）画 5 颗心",
            fills["half"]["main"] == [2] * 5 + [0] * 5,
            str(fills["half"]),
        )
        check(
            "奇数血（11/20）有一颗半心",
            fills["odd"]["main"] == [2] * 5 + [1] + [0] * 4,
            str(fills["odd"]),
        )
        check(
            "小数血（1.5）也有一颗半心，不能全空",
            fills["frac"]["main"] == [1] + [0] * 9,
            str(fills["frac"]),
        )
        check(
            "小数血（19.1）显示 9 颗满 + 1 颗半",
            fills["fracHigh"]["main"] == [2] * 9 + [1],
            str(fills["fracHigh"]),
        )
        check(
            "血量 0 时全部为空",
            fills["dead"]["main"] == [0] * 10,
            str(fills["dead"]),
        )
        check(
            "超过 20 点的部分单独一行（24 点 = 10 + 2 颗）",
            fills["over"]["main"] == [2] * 10 and fills["over"]["overflow"] == [2] * 2,
            str(fills["over"]),
        )
        check(
            "NaN 输入不崩（血量 NaN 画空、上限 NaN 按当前血量画）",
            fills["nan"]["main"] == [0] * 10 and fills["nanMax"]["main"] == [2] * 10,
            str({"nan": fills["nan"], "nanMax": fills["nanMax"]}),
        )
        check(
            "饥饿满（20）画满 10 根鸡腿",
            fills["foodFull"] == [2] * 10,
            str(fills["foodFull"]),
        )
        check(
            "饥饿空（0）全为空",
            fills["foodEmpty"] == [0] * 10 and fills["foodNan"] == [0] * 10,
            str(fills["foodEmpty"]),
        )

        # ---------- 2. 布局：血条不能压到经验条 / 溢出行不能压到防具槽 ----------
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(600)
        geo = page.evaluate(PROBE)["geometry"]
        check(
            "血条右边缘与快捷栏右边缘对齐",
            abs(geo["heartRight"] - geo["hotbarRight"]) <= 2,
            str(geo),
        )
        check(
            "血条不与经验条重叠",
            geo["heartLeft"] > geo["xpRight"],
            f"血条左缘 {geo['heartLeft']} vs 经验条右缘 {geo['xpRight']}",
        )

        # ---------- 3. 像素级：满血时真的有 10 颗红心 ----------
        state = page.evaluate(PROBE)
        expected = 10 * state["unit"]
        check(
            "满血时 HUD 上有 10 颗完整红心",
            abs(state["mainRed"] - expected) <= expected * 0.05,
            f"实际 {state['mainRed']} 像素，期望约 {expected}",
        )
        check(
            "饥饿满时 HUD 上有 10 根鸡腿",
            abs(state["foodOrange"] - 10 * state["foodUnit"]) <= state["foodUnit"] * 0.1,
            f"实际 {state['foodOrange']} 像素，期望约 {10 * state['foodUnit']}",
        )

        # 锁死回血：不然饥饿够时会把血量慢慢涨回来，断言会飘
        page.evaluate("window.game.player.hunger = 0; window.game.player.regenTimer = 0;")

        page.evaluate("window.game.player.health = 10")
        page.wait_for_timeout(300)
        state = page.evaluate(PROBE)
        check(
            "掉到半血时红心数量减半",
            abs(state["mainRed"] - expected / 2) <= expected * 0.05,
            f"半血 {state['mainRed']} 像素，满血 {expected} 像素",
        )

        # 小数血量不能画成空条
        page.evaluate("window.game.player.health = 1.5")
        page.wait_for_timeout(300)
        state = page.evaluate(PROBE)
        check(
            "1.5 血时是半颗心（红像素少于一颗整心，但不能是 0）",
            0 < state["mainRed"] < state["unit"],
            f"红像素 {state['mainRed']}，一颗整心 {state['unit']}",
        )

        # ---------- 4. 血条变长（「生命」附魔）时不被经验条盖住 ----------
        page.evaluate("window.game.player.baseMaxHealth = 32; window.game.player.health = 32")
        page.wait_for_timeout(300)
        state = page.evaluate(PROBE)
        check(
            "上限 32 点时主行仍是 10 颗、溢出 6 颗单独一行（12 点）",
            len(state["mainFills"]) == 10 and len(state["overflowFills"]) == 6,
            str(state),
        )
        check(
            "溢出行的红心真的画出来了",
            abs(state["overflowRed"] - 6 * state["unit"]) <= state["unit"] * 0.1,
            f"溢出行红像素 {state['overflowRed']}，期望约 {6 * state['unit']}",
        )
        check(
            "溢出行不压到防具槽",
            state["geometry"]["overflowBottom"] <= state["geometry"]["armorTop"],
            str(state["geometry"]),
        )
        check(
            "溢出行与主行右边缘对齐",
            state["geometry"]["overflowRight"] == state["geometry"]["heartRight"],
            str(state["geometry"]),
        )
        check(
            "血条左缘仍在经验条右侧",
            state["geometry"]["heartLeft"] > state["geometry"]["xpRight"],
            str(state["geometry"]),
        )

        # 有「生命」附魔但血不满：多出来的心仍然占位（MC 同款）
        page.evaluate("window.game.player.health = 20")
        page.wait_for_timeout(300)
        state = page.evaluate(PROBE)
        check(
            "上限 32 点但只有 20 血时，溢出 6 颗空心仍然占位",
            state["overflowFills"] == [0] * 6 and state["overflowRed"] == 0,
            str(state["overflowFills"]),
        )

        check("无页面错误", not errors, str(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} 项失败")
        sys.exit(1)
    print("\n全部通过")


if __name__ == "__main__":
    main()
