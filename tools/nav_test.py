"""导航指引测试：小地图分层、目标标记、边缘箭头。

回归重点：
  1. 小地图只显示当前层的房间 —— 之前四层叠在一起，玩家根本认不出自己在哪。
  2. 目标要在图上醒目，并且区分同层 / 不在同层。
  3. 目标不在画面内时，屏幕边缘要有指向它的箭头。
"""
import math
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    if not ok:
        failures.append(name)


# 造一份假的地牢地图：两层、每层两个房间，外加走廊、竖井、箱子等
FAKE_MAP = """() => {
  const room = (cx, cz, halfW, halfD, floorY, floor, name) =>
    ({ cx, cz, halfW, halfD, floorY, floor, name });
  return {
    rooms: [
      room(32, 32, 6, 8, 58, 0, '大厅'),
      room(96, 32, 6, 7, 58, 0, '宝库'),
      room(64, 64, 6, 5, 42, 1, '刷怪间'),
      room(128, 96, 8, 8, 26, 2, '墓穴'),
    ],
    corridors: [
      { x1: 32, z1: 32, x2: 96, z2: 32, y: 58 },
      { x1: 96, z1: 32, x2: 96, z2: 32, y: 42 },
    ],
    stairs: [{ from: { x: 40, y: 58, z: 40 }, to: { x: 96, y: 42, z: 96 } }],
    arena: { x: 80, z: 80, half: 23, floorY: 12 },
    enemies: [
      { x: 50, z: 50, floorY: 58 },
      { x: 70, z: 70, floorY: 42 },
    ],
    chests: [
      { x: 60, z: 60, floorY: 58 },
      { x: 80, z: 80, floorY: 12 },
    ],
    enchantSpots: [{ x: 70, z: 70, floorY: 58 }],
    player: { x: 34, z: 34, yaw: 0, y: 58, floorY: 58 },
    floorIndex: 0,
    floorY: 58,
    floorCount: 4,
  };
}"""

OPTS = {"x0": 100, "y0": 20, "size": 300, "scale": 300 / 144, "uiScale": 2, "time": 0}


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

        # ---------- 1. 小地图只显示当前层 ----------
        layout = page.evaluate(
            """async (args) => {
              const m = await import('/src/render/hud-nav.js');
              const map = args.map;
              const opts = args.opts;
              const sameFloor = m.buildMinimapLayout(map, {
                x: 96, y: 58, z: 32, label: '下行阶梯', distance: 62,
                sameFloor: true, floorIndex: 0,
              }, opts);
              const otherFloor = m.buildMinimapLayout(
                { ...map, floorIndex: 1, floorY: 42, player: { ...map.player, floorY: 42, y: 42 } },
                {
                  x: 96, y: 58, z: 32, label: '下行阶梯', distance: 62,
                  sameFloor: false, floorIndex: 0,
                },
                opts
              );
              // 竖井场景：玩家高度在两层之间（层序号仍算上层）
              const inShaft = m.buildMinimapLayout(
                { ...map, player: { ...map.player, y: 52, floorY: 52 } },
                {
                  x: 96, y: 58, z: 32, label: '下行阶梯', distance: 62,
                  sameFloor: true, floorIndex: 0,
                },
                opts
              );
              // 竞技场的正向用例：最底层才有
              const bottom = m.buildMinimapLayout(
                { ...map, floorIndex: 3, floorY: 12, player: { ...map.player, y: 12, floorY: 12 } },
                { x: 80, y: 12, z: 80, label: '末影龙', distance: 20, sameFloor: true, floorIndex: 3 },
                opts
              );
              return { sameFloor, otherFloor, inShaft, bottom };
            }""",
            {"map": page.evaluate(FAKE_MAP), "opts": OPTS},
        )
        rooms = layout["sameFloor"]["rooms"]
        check(
            "小地图只画当前层的房间",
            len(rooms) == 2 and all(r["name"] in ("大厅", "宝库") for r in rooms),
            str([r["name"] for r in rooms]),
        )
        check(
            "当前所在房间被高亮并给出名字",
            len(rooms) == 2
            and rooms[0]["isCurrent"]
            and layout["sameFloor"]["currentRoomName"] == "大厅",
            str(layout["sameFloor"]["currentRoomName"]),
        )
        check(
            "目标所在房间被标出来",
            any(r["isObjective"] for r in rooms),
            str([(r["name"], r["isObjective"]) for r in rooms]),
        )
        check(
            "走廊按层过滤",
            len(layout["sameFloor"]["corridors"]) == 1
            and len(layout["otherFloor"]["corridors"]) == 1,
            f"同层 {len(layout['sameFloor']['corridors'])} 条，"
            f"另一层 {len(layout['otherFloor']['corridors'])} 条",
        )
        check(
            "竖井只取当前层的入口",
            len(layout["sameFloor"]["shafts"]) == 1
            and len(layout["otherFloor"]["shafts"]) == 0,
            str(layout["otherFloor"]["shafts"]),
        )
        check(
            "竞技场只在最底层出现",
            layout["sameFloor"]["arena"] is None
            and layout["otherFloor"]["arena"] is None,
            str(layout["sameFloor"]["arena"]),
        )
        check(
            "敌人按层过滤",
            len(layout["sameFloor"]["enemies"]) == 1
            and len(layout["otherFloor"]["enemies"]) == 1,
            str(layout["sameFloor"]["enemies"]),
        )
        check(
            "箱子按层过滤",
            len(layout["sameFloor"]["chests"]) == 1
            and len(layout["otherFloor"]["chests"]) == 0,
            str(layout["sameFloor"]["chests"]),
        )
        check(
            "附魔台按层过滤",
            len(layout["sameFloor"]["enchants"]) == 1
            and len(layout["otherFloor"]["enchants"]) == 0,
            str(layout["sameFloor"]["enchants"]),
        )
        check(
            "目标不在同层时能区分出来",
            layout["sameFloor"]["objective"]["onSameFloor"] is True
            and layout["otherFloor"]["objective"]["onSameFloor"] is False,
            str(layout["otherFloor"]["objective"]),
        )
        check(
            "目标标记带上了所在层（小地图上的 ↓/↑ 要靠它）",
            layout["sameFloor"]["objective"]["floorIndex"] == 0
            and layout["otherFloor"]["objective"]["floorIndex"] == 0,
            str(layout["sameFloor"]["objective"]),
        )
        check(
            "玩家在竖井里（高度在两层之间）时路网不会消失",
            len(layout["inShaft"]["corridors"]) == 1
            and len(layout["inShaft"]["shafts"]) == 1
            and len(layout["inShaft"]["enemies"]) == 1
            and len(layout["inShaft"]["chests"]) == 1,
            f"走廊 {len(layout['inShaft']['corridors'])}，竖井 {len(layout['inShaft']['shafts'])}，"
            f"敌人 {len(layout['inShaft']['enemies'])}，箱子 {len(layout['inShaft']['chests'])}",
        )
        check(
            "竞技场在最底层会出现",
            layout["bottom"]["arena"] is not None
            and layout["bottom"]["arena"]["w"] > 0
            and layout["bottom"]["arena"]["h"] > 0,
            str(layout["bottom"]["arena"]),
        )

        # ---------- 2. 屏幕边缘箭头 ----------
        edge = page.evaluate(
            """async (args) => {
              const m = await import('/src/render/hud-nav.js');
              const opts = { width: 1280, height: 720, scale: 2, yaw: 0 };
              return {
                visible: m.buildEdgeMarker({
                  x: 0, y: 0, z: 0, label: '目标', distance: 30,
                  screen: { x: 640, y: 360, visible: true, dirX: 0.3, dirY: 0 },
                }, opts),
                right: m.buildEdgeMarker({
                  x: 0, y: 0, z: 0, label: '目标', distance: 30,
                  screen: { x: 1200, y: 360, visible: false, dirX: 1, dirY: 0 },
                }, opts),
                noDir: m.buildEdgeMarker({
                  x: 0, y: 0, z: 0, label: '目标', distance: 30,
                  screen: { x: 1200, y: 360, visible: false },
                }, opts),
                blocked: m.buildEdgeMarker({
                  x: 0, y: 0, z: 0, label: '目标', distance: 30,
                  screen: { x: 1200, y: 200, visible: false, dirX: 1, dirY: 0.1 },
                }, {
                  ...opts,
                  obstacles: [{ x: 944, y: 32, w: 308, h: 308 }],
                }),
                behind: m.buildEdgeMarker({
                  x: 0, y: 0, z: 0, label: '目标', distance: 30,
                  screen: { x: 640, y: 360, visible: false, dirX: 0, dirY: 0 },
                }, opts),
                behindRight: m.buildEdgeMarker({
                  x: 0, y: 0, z: 0, label: '目标', distance: 30,
                  screen: { x: 100, y: 360, visible: false, dirX: 0.7, dirY: 0 },
                }, opts),
                none: m.buildEdgeMarker(null, opts),
              };
            }""",
            {},
        )
        check("目标在画面内时不画边缘箭头", edge["visible"] is None, str(edge["visible"]))
        check(
            "没有相机基底方向量时不画箭头（镜像坐标会指反，宁可不画）",
            edge["noDir"] is None,
            str(edge["noDir"]),
        )
        check(
            "箭头落点小地图面板里时会被挪开",
            edge["blocked"] is not None and edge["blocked"]["x"] < 944,
            str(edge["blocked"]),
        )
        check(
            "目标在右边时箭头贴在右边",
            edge["right"] is not None and edge["right"]["x"] > 1000,
            str(edge["right"]),
        )
        check(
            "目标在正后方时箭头指向屏幕下方（提示转身），不是继续往前",
            edge["behind"] is not None and edge["behind"]["y"] > 360,
            str(edge["behind"]),
        )
        check(
            "目标在右后方时箭头仍指向右（镜像投影会指反，这里要钉住）",
            edge["behindRight"] is not None and edge["behindRight"]["x"] > 640,
            str(edge["behindRight"]),
        )
        check("没有目标时不画边缘箭头", edge["none"] is None, str(edge["none"]))

        # ---------- 2b. 罗盘箭头的相对角度（早先写成减 yaw，会指反） ----------
        bearing = page.evaluate(
            """async () => {
              const m = await import('/src/render/hud-nav.js');
              const HALF = Math.PI / 2;
              return {
                right: m.objectiveBearingAngle(1, 0, 0),
                ahead: m.objectiveBearingAngle(1, 0, -HALF),
                behind: m.objectiveBearingAngle(0, 1, 0),
                left: m.objectiveBearingAngle(0, -1, 0),
              };
            }"""
        )
        check(
            "目标在右边时箭头指向右（+90°）",
            abs(bearing["right"] - math.pi / 2) < 1e-6,
            str(bearing["right"]),
        )
        check(
            "玩家已经面向目标时箭头指正前方（0°）",
            abs(bearing["ahead"]) < 1e-6,
            str(bearing["ahead"]),
        )
        check(
            "目标在身后时箭头指后（±180°）",
            abs(abs(bearing["behind"]) - math.pi) < 1e-6,
            str(bearing["behind"]),
        )
        check(
            "目标在正前方（-z）时箭头指正前方",
            abs(bearing["left"]) < 1e-6,
            str(bearing["left"]),
        )

        # ---------- 3. 真实游戏里的数据 ----------
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(800)
        live = page.evaluate(
            """() => {
              const g = window.game;
              const obj = g.buildObjectiveState();
              return {
                objective: obj,
                floors: g.dungeon.rooms.map((r) => r.floor),
                roomNames: g.mapRooms.map((r) => r.name),
                hasName: g.mapRooms.every(
                  (r) => typeof r.name === 'string' && r.name.length > 0
                ),
                mapRoomNames: g.mapRooms.map((r) => r.name),
                chestCount: g.chestSpots.length,
                playerFloor: g.player.pos.y,
              };
            }"""
        )
        floor_at = page.evaluate(
            """async () => {
              const m = await import('/src/core/floors.js');
              return {
                top: m.floorIndexAt(58),
                topInShaft: m.floorIndexAt(52),
                mid: m.floorIndexAt(50),
                second: m.floorIndexAt(42),
                bottom: m.floorIndexAt(12),
                below: m.floorIndexAt(0),
              };
            }"""
        )
        check(
            "层号判定：地面高度对应本层，竖井里算上一层",
            floor_at["top"] == 0
            and floor_at["topInShaft"] == 0
            and floor_at["mid"] == 0
            and floor_at["second"] == 1
            and floor_at["bottom"] == 3,
            str(floor_at),
        )
        check(
            "目标状态里有距离、层差和屏幕投影",
            live["objective"] is not None
            and isinstance(live["objective"]["distance"], (int, float))
            and isinstance(live["objective"]["sameFloor"], bool)
            and live["objective"]["screen"] is not None,
            str(live["objective"]),
        )
        check(
            "目标带上了可见性判定",
            isinstance(live["objective"]["screen"]["visible"], bool),
            str(live["objective"]["screen"]),
        )
        # 转身面向目标后，它就应该在画面里了（要等一帧，相机才会跟着转）
        page.evaluate(
            """() => {
              const g = window.game;
              const o = g.objective;
              const p = g.player.pos;
              g.player.yaw = Math.atan2(-(o.x - p.x), -(o.z - p.z));
              g.player.pitch = 0;
            }"""
        )
        page.wait_for_timeout(300)
        faced = page.evaluate("() => window.game.buildObjectiveState().screen")
        check(
            "转身面向目标后 visible 变成 true",
            faced["visible"] is True,
            str(faced),
        )
        check(
            "每个房间都有中文名",
            live["hasName"] and len(set(live["roomNames"])) >= 2,
            str(live["roomNames"]),
        )
        check("箱子坐标被缓存了", live["chestCount"] > 0, f"{live['chestCount']} 个箱子")

        # ---------- 4. HUD 上真的画出了目标条 ----------
        bar = page.evaluate(
            """() => {
              const c = document.getElementById('hud');
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              const w = c.width;
              let yellow = 0;
              for (let y = 200; y < 270; y++) {          // 目标条所在的纵向区间
                for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) {
                  const i = (y * w + x) * 4;
                  if (d[i] > 200 && d[i + 1] > 180 && d[i + 2] < 200 && d[i + 3] > 200) yellow++;
                }
              }
              return yellow;
            }"""
        )
        check("顶部目标条被画出来了（黄色文字像素）", bar > 100, f"{bar} 个黄色像素")


        # ---------- 4b. 真实游戏：相机基底方向的符号 ----------
        # 先把相机转到固定朝向（要等一帧，相机才会跟着转）
        page.evaluate("() => { window.game.player.yaw = 0; }")
        page.wait_for_timeout(250)
        dirs = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player.pos;
              const saved = { ...g.objective };
              const at = (o) => {
                g.objective = o;
                return g.buildObjectiveState().screen;
              };
              // yaw=0 → 面朝 -z，+x 是右手边
              const right = at({ x: p.x + 10, y: p.y - 5, z: p.z, label: '测试' });
              const left = at({ x: p.x - 10, y: p.y - 5, z: p.z, label: '测试' });
              const above = at({ x: p.x, y: p.y + 5, z: p.z - 10, label: '测试' });
              g.objective = saved;
              return { right, left, above };
            }"""
        )
        check(
            "目标在右手边时 dirX 为正（叉乘顺序不能反）",
            dirs["right"]["dirX"] > 0.5 and dirs["right"]["dirY"] < 0,
            str(dirs["right"]),
        )
        check(
            "目标在左手边时 dirX 为负",
            dirs["left"]["dirX"] < -0.5,
            str(dirs["left"]),
        )
        check(
            "目标在上方时 dirY 为正",
            dirs["above"]["dirY"] > 0.2,
            str(dirs["above"]),
        )

        # ---------- 4c. 在竖井里往下走时，目标应该是井底 ----------
        shaft = page.evaluate(
            """() => {
              const g = window.game;
              const s = g.dungeon.stairs[0];
              if (!s || !s.shaft) return null;
              g.player.setPosition(s.shaft.cx + 0.5, s.from.y - 4, s.shaft.cz + 0.5);
              g.updateObjective();
              const inShaft = { ...g.objective };
              g.player.setPosition(s.shaft.cx + 0.5, s.from.y, s.shaft.cz + 0.5);
              g.updateObjective();
              const onPlatform = { ...g.objective };
              return { to: s.to, inShaft, onPlatform };
            }"""
        )
        check(
            "在竖井里往下走时目标是井底出口",
            shaft is not None
            and abs(shaft["inShaft"]["x"] - shaft["to"]["x"]) < 0.01
            and abs(shaft["inShaft"]["z"] - shaft["to"]["z"]) < 0.01,
            str(shaft),
        )
        check(
            "还没下井时目标是井口",
            shaft is not None
            and abs(shaft["onPlatform"]["x"] - shaft["to"]["x"]) > 0.01,
            str(shaft["onPlatform"] if shaft else None),
        )

        # ---------- 4d. ↓/↑ 箭头是纯函数 ----------
        arrows = page.evaluate(
            """async () => {
              const m = await import('/src/render/hud-nav.js');
              return {
                below: m.floorArrow(2, 0),
                above: m.floorArrow(0, 2),
                same: m.floorArrow(1, 1),
                unknown: m.floorArrow(null, 0),
              };
            }"""
        )
        check(
            "目标在下面标 ↓、在上面标 ↑、同层不标",
            arrows["below"] == " ↓"
            and arrows["above"] == " ↑"
            and arrows["same"] == ""
            and arrows["unknown"] == "",
            str(arrows),
        )

        check("无页面错误", not errors, str(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} 项失败")
        sys.exit(1)
    print("\n全部通过")


if __name__ == "__main__":
    main()
