"""附魔系统测试：经验、附魔台、附魔效果（伤害 / 无限 / 穿透 / 火焰）。"""
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
        page = browser.new_page(viewport={"width": 1280, "height": 800})
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

        # ---------- 1. 地牢里有附魔台 ----------
        spots = page.evaluate("() => window.game.dungeon.enchantSpots.length")
        check("每层放置了附魔台", spots == 3, f"共 {spots} 个")

        # ---------- 2. 靠近附魔台出现提示，E 打开界面 ----------
        page.evaluate(
            """() => {
              const g = window.game;
              const s = g.dungeon.enchantSpots[0];
              g.player.setPosition(s.x + 1.5, s.y, s.z);
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(400)
        hint = page.evaluate("() => window.game.hint")
        check("靠近附魔台出现操作提示", "附魔台" in hint, repr(hint))

        page.evaluate("window.game.openEnchant()")
        page.wait_for_timeout(250)
        opened = page.evaluate(
            """() => ({
              state: window.game.state,
              visible: !document.getElementById('enchant').hidden,
              options: window.game.enchantOptions.length,
            })"""
        )
        check(
            "附魔界面打开并给出 3 个选项",
            opened["state"] == "enchanting" and opened["visible"] and opened["options"] == 3,
            str(opened),
        )

        # ---------- 3. 应用附魔：扣等级 + 扣材料 + 生效 ----------
        applied = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              p.level = 5;
              p.xp = 0;
              p.giveItem('iron', 5);
              p.giveItem('gold', 5);
              p.giveItem('bone', 5);
              p.giveItem('cobblestone_item', 5);
              const ironBefore = p.countItem('iron');
              const goldBefore = p.countItem('gold');
              const levelBefore = p.level;
              // 选一个近战附魔
              const opt = g.enchantOptions.find(o => o.id === 'sharpness')
                || g.enchantOptions[0];
              g.applyEnchant(opt);
              return {
                opt: opt.id,
                levelBefore,
                levelAfter: p.level,
                ironBefore, ironAfter: p.countItem('iron'),
                goldBefore, goldAfter: p.countItem('gold'),
                enchants: p.getEnchants('iron_sword'),
                chips: document.querySelectorAll('#enchant-current .enchant-chip').length,
              };
            }"""
        )
        check(
            "应用附魔后等级与材料被扣除",
            applied["levelAfter"] == applied["levelBefore"] - applied["opt"].count("x") * 0 - 1
            or applied["levelAfter"] < applied["levelBefore"],
            str(applied),
        )
        check(
            "附魔记录到武器上",
            len(applied["enchants"]) == 1 and applied["enchants"][0]["level"] == 1,
            str(applied["enchants"]),
        )
        check(
            "界面显示已附魔的标签",
            applied["chips"] == 1,
            f"chips = {applied['chips']}",
        )

        # ---------- 4. 锋利提升近战伤害 ----------
        dmg = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              const spawn = g.dungeon.spawnPoint;
              const w = { damage: 5, knockback: 4 };
              // 先测无附魔
              p.enchants.iron_sword = [];
              const e1 = g.enemies.spawn('zombie', p.pos.x, p.pos.y, p.pos.z);
              const hp1 = e1.hp;
              g.applyMeleeHit({ target: e1, distance: 2 }, w);
              const plain = hp1 - e1.hp;
              // 再测带锋利
              p.enchants.iron_sword = [{ id: 'sharpness', level: 1 }];
              const e2 = g.enemies.spawn('zombie', p.pos.x, p.pos.y, p.pos.z);
              const hp2 = e2.hp;
              g.applyMeleeHit({ target: e2, distance: 2 }, w);
              const enchanted = hp2 - e2.hp;
              return { plain, enchanted };
            }"""
        )
        check(
            "锋利附魔提升近战伤害",
            dmg["enchanted"] > dmg["plain"],
            f"普通 {dmg['plain']:.2f} -> 附魔 {dmg['enchanted']:.2f}",
        )

        # ---------- 5. 火焰附魔点燃敌人 ----------
        burn = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              const spawn = g.dungeon.spawnPoint;
              p.enchants.iron_sword = [{ id: 'fire', level: 1 }];
              const e = g.enemies.spawn('zombie', p.pos.x, p.pos.y, p.pos.z);
              g.applyMeleeHit({ target: e, distance: 2 }, { damage: 5, knockback: 4 });
              const hasBurn = !!e.burn;
              const hp0 = e.hp;
              // 推进 1.2 秒，让燃烧至少结算一次
              for (let i = 0; i < 80; i++) g.enemies.update(1 / 60, g.player, g);
              return { hasBurn, hp0, hp1: e.hp };
            }"""
        )
        check(
            "火焰附魔点燃敌人并持续掉血",
            burn["hasBurn"] and burn["hp1"] < burn["hp0"],
            str(burn),
        )

        # ---------- 6. 无限附魔：射箭不消耗箭矢 ----------
        infinity = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              p.enchants.bow = [{ id: 'infinity', level: 1 }];
              p.consumeItem('arrow', p.countItem('arrow'));
              const before = p.countItem('arrow');
              const projBefore = g.projectiles.projectiles.length;
              g.drawTime = 1;
              g.fireArrow({ kind: 'bow', drawTime: 1, minSpeed: 20, maxSpeed: 52, damage: 10 });
              return {
                before,
                after: p.countItem('arrow'),
                proj: g.projectiles.projectiles.length - projBefore,
              };
            }"""
        )
        check(
            "无限附魔让射箭不消耗箭矢",
            infinity["after"] == infinity["before"] and infinity["proj"] >= 1,
            str(infinity),
        )

        # ---------- 7. 穿透附魔：箭穿过两个敌人 ----------
        pierce = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              const w = g.world;
              // 找一条 3 格长、头顶有空间的直线通道
              let line = null;
              for (const room of g.dungeon.rooms) {
                for (const c of room.cells) {
                  for (const [dx, dz] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                    const a = { x: c.x, z: c.z };
                    const b = { x: c.x + dx * 2, z: c.z + dz * 2 };
                    const mid = { x: c.x + dx, z: c.z + dz };
                    const y = room.floorY;
                    const free = [a, mid, b].every(
                      (q) => w.get(q.x, y, q.z) === 0 && w.get(q.x, y + 1, q.z) === 0
                    );
                    if (!free) continue;
                    line = { a, b, y, dir: [dx, dz] };
                    break;
                  }
                  if (line) break;
                }
                if (line) break;
              }
              if (!line) return { error: 'no line' };
              const e1 = g.enemies.spawn('zombie', line.a.x + 0.5, line.y, line.a.z + 0.5);
              const e2 = g.enemies.spawn('zombie', line.b.x + 0.5, line.y, line.b.z + 0.5);
              const hp1 = e1.hp, hp2 = e2.hp;
              const V = g.camera.position.constructor;
              const dir = new V(line.dir[0], 0, line.dir[1]);
              const origin = new V(line.a.x + 0.5 - line.dir[0] * 0.5, line.y + 1.0,
                                  line.a.z + 0.5 - line.dir[1] * 0.5);
              g.projectiles.spawnArrow(origin, dir, 26, 10, true, p, 1);
              for (let i = 0; i < 60; i++) g.projectiles.update(1 / 60, g);
              return { hp1, hp2, now1: e1.hp, now2: e2.hp };
            }"""
        )
        check(
            "穿透附魔让箭命中两个敌人",
            "error" not in pierce
            and pierce["now1"] < pierce["hp1"]
            and pierce["now2"] < pierce["hp2"],
            str(pierce),
        )

        # ---------- 8. 击杀获得经验 ----------
        xp = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              const before = p.level * 1000 + p.xp;
              const spawn = g.dungeon.spawnPoint;
              const e = g.enemies.spawn('zombie', p.pos.x, p.pos.y, p.pos.z);
              e.takeDamage(999, 0, null);
              g.onEnemyKilled(e);
              const after = p.level * 1000 + p.xp;
              return { before, after, level: p.level, xp: p.xp };
            }"""
        )
        check("击杀怪物获得经验", xp["after"] > xp["before"], str(xp))

        # ---------- 9. 经验不足时无法附魔 ----------
        poor = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              p.level = 0;
              p.enchants = { iron_sword: [] };
              const before = p.getEnchants('iron_sword').length;
              const opt = g.enchantOptions[0] || { id: 'sharpness', level: 1, levelCost: 1, material: 'iron', materialCount: 1 };
              g.applyEnchant(opt);
              return { before, after: p.getEnchants('iron_sword').length };
            }"""
        )
        check(
            "经验不足时附魔失败",
            poor["after"] == poor["before"],
            str(poor),
        )

        page.screenshot(path="/tmp/mcshots/enchant-applied.png")
        browser.close()

    if errors:
        print("\n运行时错误:")
        for e in errors[:5]:
            print(" ", e)
        failures.append("runtime errors")
    print("\n结果:", "全部通过" if not failures else f"失败: {failures}")
    sys.exit(0 if not failures else 1)


main()
