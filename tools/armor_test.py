"""防具系统测试：装备槽、减伤、附魔、掉落。"""
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
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(600)

        # ---------- 1. 物品数据 ----------
        items = page.evaluate(
            """() => {
              const g = window.game;
              const ids = ['leather_helmet','leather_chestplate','leather_leggings',
                'iron_helmet','iron_chestplate','iron_leggings',
                'diamond_helmet','diamond_chestplate','diamond_leggings'];
              const out = [];
              for (const id of ids) {
                const d = g.itemDefs ? g.itemDefs[id] : null;
                out.push(d ? { id, slot: d.slot, defense: d.defense, type: d.type } : { id, missing: true });
              }
              return out;
            }"""
        )
        check("9 件防具都已注册", not any(i.get("missing") for i in items), str(items[:2]))

        # ---------- 2. 装备与防御点数 ----------
        equip = page.evaluate(
            """() => {
              const p = window.game.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              const ok = p.equipArmor({ id: 'iron_chestplate' });
              return { ok, points: p.armorPoints, reduction: p.armorReduction };
            }"""
        )
        check(
            "穿上铁甲后防御点数 = 6",
            equip["ok"] and equip["points"] == 6,
            str(equip),
        )
        check(
            "减伤 = 6 × 4% = 24%",
            abs(equip["reduction"] - 0.24) < 0.001,
            f"reduction={equip['reduction']}",
        )

        # ---------- 3. 伤害真的被减免 ----------
        dmg = page.evaluate(
            """() => {
              const p = window.game.player;
              p.health = 20; p.invulnerable = 0;
              p.applyDamage(10, '测试');
              const withArmor = p.health;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.health = 20; p.invulnerable = 0;
              p.applyDamage(10, '测试');
              const bare = p.health;
              return { withArmor, bare };
            }"""
        )
        check(
            "穿甲后受到的伤害更少",
            dmg["withArmor"] > dmg["bare"],
            f"穿甲血量={dmg['withArmor']:.2f} 裸装血量={dmg['bare']:.2f}",
        )

        # ---------- 4. 卸下会回到快捷栏 ----------
        unequip = page.evaluate(
            """() => {
              const p = window.game.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.hotbar = new Array(9).fill(null);
              p.equipArmor({ id: 'diamond_chestplate' });
              const item = p.unequipArmor('chest');
              return {
                removed: item ? item.id : null,
                inHotbar: p.hotbar.some((s) => s && s.id === 'diamond_chestplate'),
                points: p.armorPoints,
              };
            }"""
        )
        check(
            "卸下后回到快捷栏",
            unequip["removed"] == "diamond_chestplate" and unequip["inHotbar"],
            str(unequip),
        )
        check("卸下后防御归零", unequip["points"] == 0, str(unequip))

        # ---------- 5. 护甲附魔 ----------
        ench = page.evaluate(
            """() => {
              const p = window.game.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.hotbar = new Array(9).fill(null);
              p.equipArmor({ id: 'iron_chestplate' });
              p.addEnchant('iron_chestplate', 'toughness', 2);   // 防御 +2
              p.addEnchant('iron_chestplate', 'protection', 2);  // 减伤 +16%
              p.addEnchant('iron_chestplate', 'vitality', 2);    // 最大生命 +4
              return {
                points: p.armorPoints,
                reduction: p.armorReduction,
                vitality: p.armorVitality,
                maxHealth: p.maxHealth,
              };
            }"""
        )
        check("坚韧让防御 +2（6 → 8）", ench["points"] == 8, str(ench))
        check(
            "保护让减伤变成 8×4% + 16% = 48%",
            abs(ench["reduction"] - 0.48) < 0.001,
            f"reduction={ench['reduction']}",
        )
        check("生命让最大生命 +4", ench["maxHealth"] == 24, str(ench))

        # ---------- 6. 荆棘反弹 ----------
        thorns = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.addEnchant('iron_chestplate', 'thorns', 2);
              p.equipArmor({ id: 'iron_chestplate' });
              const e = g.enemies.spawn('zombie', p.pos.x + 1.2, p.pos.y, p.pos.z);
              e.hp = 20;
              const before = e.hp;
              // 让僵尸打玩家一次
              p.health = 20; p.invulnerable = 0;
              e.attackTimer = 0;
              e.update(0.016, p, g);
              return { thorns: p.armorThorns, enemyBefore: before, enemyAfter: e.hp, dead: e.dead };
            }"""
        )
        check("荆棘提供 4 点反弹", thorns["thorns"] == 4, str(thorns))
        check(
            "攻击者被反弹伤害",
            thorns["enemyAfter"] < thorns["enemyBefore"],
            f"血量 {thorns['enemyBefore']} → {thorns['enemyAfter']}",
        )

        # ---------- 7. 装备面板（F 键） ----------
        page.evaluate("() => window.game.player.armorSlots = { head: null, chest: null, legs: null }")
        page.keyboard.press("KeyF")
        page.wait_for_timeout(400)
        panel = page.evaluate(
            "() => ({"
            " state: window.game.state,"
            " visible: !document.getElementById('equipment').hidden,"
            " slots: document.querySelectorAll('#equip-slots .equip-slot').length,"
            " summary: document.getElementById('equip-summary').textContent,"
            "})"
        )
        check(
            "F 键打开装备面板",
            panel["state"] == "equipment" and panel["visible"] and panel["slots"] == 3,
            str(panel),
        )
        page.screenshot(path="/tmp/mcshots/armor-panel.png")

        # 面板里点「装备」
        page.evaluate(
            """() => {
              const g = window.game;
              g.player.giveItem('leather_helmet');
              g.renderEquipmentPanel();
            }"""
        )
        page.wait_for_timeout(200)
        page.click('#equip-list [data-act="equip"]')
        page.wait_for_timeout(300)
        equipped = page.evaluate(
            "() => ({ head: window.game.player.armorSlots.head,"
            " points: window.game.player.armorPoints })"
        )
        check(
            "面板里点「装备」能穿上",
            equipped["head"] and equipped["head"]["id"] == "leather_helmet",
            str(equipped),
        )

        # Esc 关闭
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        closed = page.evaluate(
            "() => ({ state: window.game.state,"
            " hidden: document.getElementById('equipment').hidden })"
        )
        check(
            "Esc 关闭装备面板",
            closed["state"] == "playing" and closed["hidden"],
            str(closed),
        )

        # ---------- 8. 拾取自动装备 ----------
        pickup = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.hotbar = new Array(9).fill(null);
              const pk = g.pickups.spawn('iron_leggings', 1, p.pos.clone());
              pk.update(0.016, p, g);
              return { legs: p.armorSlots.legs, hotbarEmpty: p.hotbar.every((s) => !s) };
            }"""
        )
        check(
            "走到防具上会自动穿上",
            pickup["legs"] and pickup["legs"]["id"] == "iron_leggings",
            str(pickup),
        )
        check("自动穿戴后不占快捷栏", pickup["hotbarEmpty"], str(pickup))

        # ---------- 9. 箱子里有防具 ----------
        loot = page.evaluate(
            """() => {
              const g = window.game;
              const armor = ['leather_helmet','leather_chestplate','leather_leggings',
                'iron_helmet','iron_chestplate','iron_leggings',
                'diamond_helmet','diamond_chestplate','diamond_leggings'];
              let withArmor = 0;
              const rounds = 60;
              for (let i = 0; i < rounds; i++) {
                const items = g.dungeon.rollLoot();
                if (items.some((e) => armor.includes(e.item))) withArmor++;
              }
              return withArmor;
            }"""
        )
        check(
            "宝箱战利品里会出现防具",
            loot > 0 and loot < 60,
            f"60 次里有 {loot} 次带防具",
        )

        # ---------- 10. 物品图鉴里有防具一组 ----------
        dex = page.evaluate(
            """() => ({
              groups: [...document.querySelectorAll('#item-dex .dex-group-title')].map((n) => n.textContent),
              armorItems: [...document.querySelectorAll('#item-dex .dex-item')]
                .filter((n) => n.querySelector('.dex-name') &&
                  ['皮头盔','皮甲','皮护腿','铁头盔','铁甲','铁护腿',
                   '钻石头盔','钻石甲','钻石护腿'].includes(n.querySelector('.dex-name').textContent)).length,
            })"""
        )
        check(
            "物品图鉴里有「防具」分组和 9 件防具",
            "防具" in dex["groups"] and dex["armorItems"] == 9,
            str(dex),
        )

        # ---------- 11. 装备面板 → 附魔台 → 回到装备面板 ----------
        # 先站到附魔台旁边
        page.evaluate(
            """() => {
              const g = window.game;
              const s = g.dungeon.enchantSpots[0];
              g.player.setPosition(s.x + 1.5, s.y, s.z);
              g.player.syncCamera();
              g.player.armorSlots = { head: null, chest: null, legs: null };
              g.player.enchants = {};          // 清掉前面用例留下的附魔
              g.player.equipArmor({ id: 'iron_chestplate' });
              g.player.level = 10;
              g.player.giveItem('cobblestone_item', 20);  // 附魔材料
            }"""
        )
        page.wait_for_timeout(300)
        page.evaluate("window.game.openEquipment()")
        page.wait_for_timeout(300)
        # 点防具上的「附魔」
        page.click('#equip-slots [data-act="enchant"]')
        page.wait_for_timeout(400)
        ench_state = page.evaluate(
            """() => ({
              state: window.game.state,
              target: window.game.enchantTarget,
              options: window.game.enchantOptions.map((o) => o.id),
              name: document.getElementById('enchant-item-name').textContent,
            })"""
        )
        check(
            "装备面板能跳到附魔界面并锁定目标",
            ench_state["state"] == "enchanting"
            and ench_state["target"] == "iron_chestplate"
            and ench_state["name"] == "铁甲",
            str(ench_state),
        )
        check(
            "附魔选项只来自护甲那四条",
            bool(ench_state["options"])
            and len(ench_state["options"]) <= 3
            and set(ench_state["options"]).issubset(
                {"protection", "toughness", "thorns", "vitality"}
            ),
            str(ench_state),
        )

        # 应用一条「坚韧」。
        # 附魔台每次随机给 3 个选项，不保证包含「坚韧」，所以这里直接构造一条选项，
        # 只测「应用附魔」这段逻辑本身。
        page.evaluate(
            """() => {
              const g = window.game;
              g.applyEnchant({
                id: 'toughness', level: 1, levelCost: 2,
                material: 'cobblestone_item', materialCount: 3,
              });
            }"""
        )
        page.wait_for_timeout(300)
        applied = page.evaluate(
            "() => ({ enchants: window.game.player.getEnchants('iron_chestplate'),"
            " points: window.game.player.armorPoints })"
        )
        check(
            "护具能真的附上魔并生效",
            applied["enchants"]
            and applied["enchants"][0]["id"] == "toughness"
            and applied["points"] == 7,
            str(applied),
        )

        # 关闭附魔界面 → 应回到装备面板
        page.click("#btn-enchant-close")
        page.wait_for_timeout(400)
        back = page.evaluate(
            "() => ({ state: window.game.state,"
            " equipVisible: !document.getElementById('equipment').hidden,"
            " enchantHidden: document.getElementById('enchant').hidden })"
        )
        check(
            "关闭附魔界面后回到装备面板",
            back["state"] == "equipment"
            and back["equipVisible"]
            and back["enchantHidden"],
            str(back),
        )
        page.screenshot(path="/tmp/mcshots/armor-enchant.png")

        # ---------- 12. 不在附魔台旁不能附魔 ----------
        away = page.evaluate(
            """() => {
              const g = window.game;
              g.state = 'playing';
              const sp = g.dungeon.spawnPoint;
              g.player.setPosition(sp.x, sp.y, sp.z);
              g.player.syncCamera();
              g.openEquipment();
              g.enchantFromEquipmentPanel('iron_chestplate');
              return { state: g.state, enchantHidden: document.getElementById('enchant').hidden };
            }"""
        )
        check(
            "离附魔台远时不能附魔",
            away["state"] == "equipment" and away["enchantHidden"],
            str(away),
        )

        # ---------- 13. 防具不能叠堆，且装备时不能吞件 ----------
        stack = page.evaluate(
            """() => {
              const p = window.game.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.hotbar = new Array(9).fill(null);
              // 两件同一部位的铁甲
              p.giveItem('iron_chestplate');
              p.giveItem('iron_chestplate');
              const slots = p.hotbar.filter((s) => s && s.id === 'iron_chestplate').length;
              const total = p.countItem('iron_chestplate');
              // 从面板换上其中一件，另一件不能凭空消失
              const idx = p.hotbar.findIndex((s) => s && s.id === 'iron_chestplate');
              p.equipFromHotbar(idx);
              const after = p.countItem('iron_chestplate') + (p.armorSlots.chest ? 1 : 0);
              return { slots, total, after, worn: p.armorSlots.chest ? p.armorSlots.chest.id : null };
            }"""
        )
        check(
            "防具不叠堆（两件占两格）",
            stack["slots"] == 2 and stack["total"] == 2,
            str(stack),
        )
        check(
            "装备时不会吞掉另一件",
            stack["after"] == 2 and stack["worn"] == "iron_chestplate",
            str(stack),
        )

        # 卸下 → 再穿上，数量守恒
        conserve = page.evaluate(
            """() => {
              const p = window.game.player;
              const before = p.countItem('iron_chestplate') + (p.armorSlots.chest ? 1 : 0);
              p.unequipArmor('chest');
              const mid = p.countItem('iron_chestplate');
              const idx = p.hotbar.findIndex((s) => s && s.id === 'iron_chestplate');
              p.equipFromHotbar(idx);
              const after = p.countItem('iron_chestplate') + (p.armorSlots.chest ? 1 : 0);
              return { before, mid, after };
            }"""
        )
        check(
            "卸下再穿上数量守恒",
            conserve["before"] == conserve["after"] and conserve["mid"] == conserve["before"],
            str(conserve),
        )

        # ---------- 14. 同防御值的防具也能换 ----------
        swap = page.evaluate(
            """() => {
              const p = window.game.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.hotbar = new Array(9).fill(null);
              p.equipArmor({ id: 'iron_helmet' });
              p.giveItem('iron_helmet');
              const idx = p.hotbar.findIndex((s) => s && s.id === 'iron_helmet');
              const ok = p.equipFromHotbar(idx);
              return { ok, worn: p.armorSlots.head ? p.armorSlots.head.id : null };
            }"""
        )
        check(
            "同防御值的防具也能换上（不会被卡死）",
            swap["ok"] and swap["worn"] == "iron_helmet",
            str(swap),
        )

        # ---------- 15. 无敌帧期间荆棘不反伤 ----------
        iframe = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player;
              p.armorSlots = { head: null, chest: null, legs: null };
              p.enchants = { iron_chestplate: [{ id: 'thorns', level: 2 }] };
              p.equipArmor({ id: 'iron_chestplate' });
              const e = g.enemies.spawn('zombie', p.pos.x, p.pos.y, p.pos.z);
              e.hp = 20;
              p.health = 20;
              p.invulnerable = 5;   // 无敌帧：这次攻击打不中玩家
              e.attackTimer = 0;
              e.update(0.016, p, g);
              return { enemyHp: e.hp, playerHp: p.health };
            }"""
        )
        check(
            "无敌帧期间荆棘不反伤",
            iframe["enemyHp"] == 20 and iframe["playerHp"] == 20,
            str(iframe),
        )

        check("无页面错误", not errors, str(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} 项失败")
        sys.exit(1)
    print("\n全部通过")


if __name__ == "__main__":
    main()
