"""可选主角测试：史蒂夫 / 杰杰 / 麦琪。"""
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

        # ---------- 1. 主菜单有三张角色卡片 ----------
        cards = page.evaluate(
            "() => [...document.querySelectorAll('.char-card')].map((c) => c.dataset.char)"
        )
        check(
            "主菜单有三个可选主角",
            cards == ["steve", "jiejie", "maiqi"],
            str(cards),
        )

        # ---------- 2. 立绘真的画出来了 ----------
        portraits = page.evaluate(
            """() => [...document.querySelectorAll('.char-portrait')].map((c) => {
              const ctx = c.getContext('2d');
              const d = ctx.getImageData(0, 0, c.width, c.height).data;
              const colors = new Set();
              let painted = 0;
              for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] > 0) { painted++; colors.add(`${d[i]},${d[i+1]},${d[i+2]}`); }
              }
              return { w: c.width, h: c.height, painted, colors: colors.size };
            })"""
        )
        check(
            "三个立绘都画出了内容",
            all(p["painted"] > 500 and p["colors"] > 4 for p in portraits),
            str(portraits),
        )
        check(
            "立绘里三个角色用色不同",
            len({tuple(sorted(p["colors"] and [p["colors"]])) for p in portraits}) == 3
            and portraits[0]["colors"] != portraits[1]["colors"]
            and portraits[1]["colors"] != portraits[2]["colors"],
            str([p["colors"] for p in portraits]),
        )

        # ---------- 3. 点击卡片切换角色 ----------
        page.click('.char-card[data-char="jiejie"]')
        page.wait_for_timeout(300)
        picked = page.evaluate(
            "() => ({ id: window.game.character.id,"
            " active: document.querySelector('.char-card.is-active')?.dataset.char })"
        )
        check(
            "点卡片能切换主角",
            picked["id"] == "jiejie" and picked["active"] == "jiejie",
            str(picked),
        )

        # ---------- 4. 选择会被记住 ----------
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        saved = page.evaluate(
            "() => ({ id: window.game.character.id,"
            " active: document.querySelector('.char-card.is-active')?.dataset.char })"
        )
        check(
            "主角选择被记住（刷新后仍是它）",
            saved["id"] == "jiejie" and saved["active"] == "jiejie",
            str(saved),
        )

        # ---------- 5. 第一人称手臂随角色变化 ----------
        arms = {}
        for cid in ("steve", "jiejie", "maiqi"):
            page.evaluate(f"() => window.game.setCharacter('{cid}')")
            page.wait_for_timeout(200)
            arms[cid] = page.evaluate(
                """() => {
                  const m = window.game.viewModel.armMaterial.map;
                  const img = m && m.image;
                  if (!img) return null;
                  const c = document.createElement('canvas');
                  c.width = img.width; c.height = img.height;
                  const ctx = c.getContext('2d');
                  ctx.drawImage(img, 0, 0);
                  const d = ctx.getImageData(0, 0, c.width, c.height).data;
                  const colors = [];
                  for (let i = 0; i < d.length; i += 4) {
                    const k = `${d[i]},${d[i+1]},${d[i+2]}`;
                    if (!colors.includes(k)) colors.push(k);
                  }
                  return colors;
                }"""
            )
        check(
            "三个角色的手臂配色各不相同",
            arms["steve"] != arms["jiejie"]
            and arms["jiejie"] != arms["maiqi"]
            and arms["steve"] != arms["maiqi"],
            str({k: (v or [])[:3] for k, v in arms.items()}),
        )

        # ---------- 5b. 史蒂夫的胡子位置（曾被画错到 2/4/6 列）----------
        beard = page.evaluate(
            """() => {
              const c = document.querySelector('.char-card[data-char="steve"] .char-portrait');
              const ctx = c.getContext('2d');
              const headX = Math.floor((10 - 8) / 2) * 8;   // 头部左边距
              const at = (col, row) => {
                const d = ctx.getImageData(headX + col * 8, row * 8, 1, 1).data;
                return `${d[0]},${d[1]},${d[2]}`;
              };
              return { col2: at(2, 6), col4: at(4, 6), col5: at(5, 6) };
            }"""
        )
        check(
            "史蒂夫的胡子在第 2、5 列（不是 2/4/6）",
            beard["col2"] == "63,42,20"
            and beard["col5"] == "63,42,20"
            and beard["col4"] == "254,167,104",
            str(beard),
        )

        # ---------- 6. 起始补给按角色不同 ----------
        kits = {}
        for cid in ("steve", "jiejie", "maiqi"):
            page.evaluate(f"() => window.game.setCharacter('{cid}')")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function(
                "() => { const el = document.getElementById('loading');"
                " return el && el.hasAttribute('hidden'); }",
                timeout=120000,
            )
            page.evaluate("window.game.startGame()")
            page.wait_for_timeout(400)
            kits[cid] = page.evaluate(
                "() => Object.fromEntries(window.game.player.hotbar"
                ".filter(Boolean).map((s) => [s.id, s.count]))"
            )
        check(
            "史蒂夫是标准装备",
            kits["steve"].get("bread") == 6
            and kits["steve"].get("torch") == 12
            and "iron" not in kits["steve"],
            str(kits["steve"]),
        )
        check(
            "杰杰多带铁锭与火把",
            kits["jiejie"].get("iron") == 3 and kits["jiejie"].get("torch") == 16,
            str(kits["jiejie"]),
        )
        check(
            "麦琪多带面包与治疗药水",
            kits["maiqi"].get("bread") == 8 and kits["maiqi"].get("potion") == 1,
            str(kits["maiqi"]),
        )

        check("无页面错误", not errors, str(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} 项失败")
        sys.exit(1)
    print("\n全部通过")


if __name__ == "__main__":
    main()
