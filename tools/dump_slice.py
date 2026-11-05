"""输出世界某个水平切片的 ASCII 图，定位连通性断点。

用法: python tools/dump_slice.py <cx> <cz> <y> [pad] [y2]
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"

SLICE_JS = r"""
(args) => {
  const g = window.game;
  const W = g.world;
  const lines = [];
  for (let z = args.cz - args.pad; z <= args.cz + args.pad; z++) {
    let row = '';
    for (let x = args.cx - args.pad; x <= args.cx + args.pad; x++) {
      const id = W.get(x, args.y, z);
      if (id === 0) row += '.';
      else if (id === 16) row += 'C';
      else if (id === 17) row += 'S';
      else if (id === 15) row += 'T';
      else if (id === 37) row += '=';
      else if (id === 14) row += '~';
      else if (id === 10 || id === 11) row += 'O';
      else if (id === 13) row += 'P';
      else row += '#';
    }
    lines.push(row);
  }
  return { grid: lines, start: [args.cx - args.pad, args.cz - args.pad] };
}
"""


def render(info, title):
    ox, oz = info["start"]
    print(f"--- {title} ---")
    print("    " + "".join(str((ox + i) % 10) for i in range(len(info["grid"][0]))))
    for j, row in enumerate(info["grid"]):
        print(f"{oz + j:3d} {row}")


def main() -> None:
    cx = int(sys.argv[1])
    cz = int(sys.argv[2])
    y = int(sys.argv[3])
    pad = int(sys.argv[4]) if len(sys.argv) > 4 else 24
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.on("pageerror", lambda e: print("ERR", e))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        for yy in (y, y - 1):
            info = page.evaluate(SLICE_JS, {"cx": cx, "cz": cz, "y": yy, "pad": pad})
            render(info, f"y={yy}")
        browser.close()


main()
