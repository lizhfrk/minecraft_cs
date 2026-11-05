"""回归测试：修复过的玩法 bug 不再复现。

覆盖：
  1. 骷髅的箭能打中玩家（之前投射物根本不与玩家碰撞，骷髅完全无害）
  2. 敌人的箭不会打死玩家自己的小怪（之前会白送经验与掉落）
  3. 岩浆致死会进入死亡结算（之前只扣血不结算，0 血假死）
  4. 快捷栏满时开箱，物品保留在箱子里（之前直接丢失）
  5. 附魔台被挖掉后不能再使用
  6. 在附魔界面按 H 打开指南再关闭，能正确回到附魔界面
"""
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
        page = browser.new_page(viewport={"width": 1024, "height": 640})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(600)

        # ---------- 1. 骷髅的箭能打中玩家 ----------
        arrow = page.evaluate(
            """() => {
              const g = window.game;
              g.enemies.clear();
              g.projectiles.clear();
              const sp = g.dungeon.spawnPoint;
              const e = g.enemies.spawn('skeleton', sp.x, sp.y, sp.z - 6);
              g.player.health = 20;
              g.player.invulnerable = 0;
              g.spawnEnemyArrow(e, g.player);
              for (let i = 0; i < 60; i++) g.projectiles.update(1 / 60, g);
              return { hp: g.player.health, alive: g.player.health > 0 };
            }"""
        )
        check(
            "骷髅的箭能打中玩家",
            arrow["hp"] < 20,
            f"玩家血量 20 -> {arrow['hp']}",
        )

        # ---------- 2. 敌人的箭不会打死玩家的小怪 ----------
        friendly = page.evaluate(
            """() => {
              const g = window.game;
              g.enemies.clear();
              g.projectiles.clear();
              const sp = g.dungeon.spawnPoint;
              // 骷髅在玩家正前方，僵尸站在骷髅与玩家之间
              const skel = g.enemies.spawn('skeleton', sp.x, sp.y, sp.z - 6);
              const zomb = g.enemies.spawn('zombie', sp.x, sp.y, sp.z - 3);
              const hp0 = zomb.hp;
              const kills0 = g.player.stats.kills;
              g.spawnEnemyArrow(skel, g.player);
              for (let i = 0; i < 60; i++) g.projectiles.update(1 / 60, g);
              return { hp0, hp1: zomb.hp, kills0, kills1: g.player.stats.kills };
            }"""
        )
        check(
            "敌人的箭不会误伤玩家的小怪",
            friendly["hp1"] == friendly["hp0"] and friendly["kills1"] == friendly["kills0"],
            str(friendly),
        )

        # ---------- 3. 岩浆致死进入死亡结算 ----------
        lava = page.evaluate(
            """() => {
              const g = window.game;
              g.state = 'playing';
              g.player.health = 2;
              g.player.invulnerable = 0;
              // 把玩家放到岩浆里：直接改坐标到岩浆方块上
              const w = g.world;
              // 用坐标反查：遍历世界找到岩浆
              let lavaPos = null;
              for (let y = 0; y < w.height && !lavaPos; y++) {
                for (let z = 0; z < w.depth && !lavaPos; z++) {
                  for (let x = 0; x < w.width; x++) {
                    if (w.get(x, y, z) === 14) { lavaPos = { x, y, z }; break; }
                  }
                }
              }
              if (!lavaPos) return { error: 'no lava in world' };
              g.player.setPosition(lavaPos.x + 0.5, lavaPos.y, lavaPos.z + 0.5);
              g.player.health = 2;
              g.player.invulnerable = 0;
              // 跑 2 秒，岩浆每 0.5 秒扣 4 点血
              for (let i = 0; i < 120; i++) g.update(1 / 60);
              return { state: g.state, hp: g.player.health };
            }"""
        )
        check(
            "岩浆致死会进入死亡结算",
            lava.get("state") == "dead" and lava.get("hp", 1) <= 0,
            str(lava),
        )

        # ---------- 4. 快捷栏满时开箱，物品留在箱子里 ----------
        chest = page.evaluate(
            """() => {
              const g = window.game;
              g.state = 'playing';
              // 造一个箱子并塞满战利品
              const sp = g.dungeon.spawnPoint;
              const x = Math.floor(sp.x), z = Math.floor(sp.z), y = Math.floor(sp.y);
              let placed = null;
              for (let dx = -3; dx <= 3 && !placed; dx++) {
                for (let dz = -3; dz <= 3 && !placed; dz++) {
                  if (g.world.get(x + dx, y, z + dz) === 0) placed = { x: x + dx, y, z: z + dz };
                }
              }
              if (!placed) return { error: 'no spot' };
              g.world.set(placed.x, placed.y, placed.z, 16);
              const key = g.world.index(placed.x, placed.y, placed.z);
              const loot = [{ item: 'arrow', count: 12 }, { item: 'gold', count: 3 }];
              g.world.meta.set(key, { type: 'chest', loot });
              // 填满快捷栏
              for (let i = 0; i < 9; i++) g.player.hotbar[i] = { id: 'cobblestone_item', count: 64 };
              g.openChest(placed);
              const meta = g.world.meta.get(key);
              return { opened: meta.opened, left: meta.loot.length };
            }"""
        )
        check(
            "快捷栏满时开箱，物品保留在箱子里",
            chest.get("opened") is False and chest.get("left", 0) == 2,
            str(chest),
        )

        # ---------- 5. 挖掉附魔台后不能再使用 ----------
        mined = page.evaluate(
            """() => {
              const g = window.game;
              g.state = 'playing';
              const spots = g.dungeon.enchantSpots;
              if (!spots.length) return { error: 'no spot' };
              const s = spots[0];
              const x = Math.floor(s.x), y = Math.floor(s.y), z = Math.floor(s.z);
              g.breakBlock(x, y, z);
              const stillThere = g.dungeon.enchantSpots.some(
                (p) => Math.floor(p.x) === x && Math.floor(p.y) === y && Math.floor(p.z) === z
              );
              g.player.setPosition(s.x + 1, s.y, s.z);
              const near = g.nearEnchantTable();
              return { stillThere, near: !!near };
            }"""
        )
        check(
            "挖掉附魔台后不能再使用",
            mined.get("stillThere") is False and mined.get("near") is False,
            str(mined),
        )

        # ---------- 6. 附魔界面 → 指南 → 回到附魔界面 ----------
        flow = page.evaluate(
            """() => {
              const g = window.game;
              g.state = 'playing';
              g.player.selectSlot(0);
              g.openEnchant();
              const s1 = g.state;
              g.openHelp();
              const s2 = g.state;
              g.closeHelp();
              const s3 = g.state;
              const helpHidden = document.getElementById('help').hidden;
              const enchantVisible = !document.getElementById('enchant').hidden;
              g.closeEnchant();
              return { s1, s2, s3, helpHidden, enchantVisible, final: g.state };
            }"""
        )
        check(
            "附魔界面 → 指南 → 正确回到附魔界面",
            flow["s1"] == "enchanting"
            and flow["s2"] == "help"
            and flow["s3"] == "enchanting"
            and flow["helpHidden"]
            and flow["enchantVisible"]
            and flow["final"] == "playing",
            str(flow),
        )

        browser.close()

    if errors:
        print("\n运行时错误:")
        for e in errors[:5]:
            print(" ", e)
        failures.append("runtime errors")
    print("\n结果:", "全部通过" if not failures else f"失败: {failures}")
    sys.exit(0 if not failures else 1)


main()
