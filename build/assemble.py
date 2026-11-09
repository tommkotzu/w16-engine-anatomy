"""src/page.html + src/strings.js + src/app.js -> web/index.html (artifact page fragment), web/local.html (standalone) and docs/ (GitHub Pages)"""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
page = (root / "src/page.html").read_text()
app = (root / "src/app.js").read_text().replace("/*STRINGS*/", (root / "src/strings.js").read_text())
frag = page.replace("<!--APP-->", '<script type="module">\n' + app + "\n</script>")
(root / "web/index.html").write_text(frag)
head, _, rest = frag.partition("</style>")
(root / "web/local.html").write_text(
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + head + "</style></head><body>" + rest + "</body></html>\n")
print("assembled", len(frag) // 1024, "KB")

import base64
for name in ("engine", "engine_q"):
    raw = (root / f"web/{name}.glb").read_bytes()
    (root / f"web/{name}.b64.txt").write_text(base64.b64encode(raw).decode())
print("encoded model text files")

# GitHub Pages site: standalone page + model text files + rig
import shutil
docs = root / "docs"
docs.mkdir(exist_ok=True)
shutil.copy(root / "web/local.html", docs / "index.html")
for f in ("engine.b64.txt", "engine_q.b64.txt", "rig.json"):
    shutil.copy(root / "web" / f, docs / f)
(docs / ".nojekyll").write_text("")
print("wrote docs/ for GitHub Pages")
