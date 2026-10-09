"""Assemble the layered master SVG from parts.json."""
import json

import os
HERE = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(f"{HERE}/parts.json"))
C = {"orange": "#F0A76A", "cream": "#F6DBB5", "line": "#6E413E", "blush": "#ED8770"}
SW = 14  # outline
IW = 13  # inner lines


def stroke_near(x, y):
    return min(P["strokes"], key=lambda s: (s["cx"] - x) ** 2 + (s["cy"] - y) ** 2)["d"]


ear_l, ear_r = sorted(P["ears"], key=lambda e: e["tip"][0])
# Stripes: one width, one gap, rounded ends, bottoms symmetric (middle longest).
st = P["stripes"]
w = round(sum(s["w"] for s in st) / 3)
mid = st[1]["cx"]
gap = round(((st[1]["cx"] - st[0]["cx"]) + (st[2]["cx"] - st[1]["cx"])) / 2, 1)
outer_bottom = round((st[0]["bottom"] + st[2]["bottom"]) / 2)
bottoms = [outer_bottom, st[1]["bottom"], outer_bottom]
stripes = "".join(
    f'<rect id="stripe-{i+1}" x="{mid + (i-1)*gap - w/2:.1f}" y="230" width="{w}" height="{b - 230}" rx="{w/2}"/>'
    for i, b in enumerate(bottoms))
pt = P["patch"]
bib, paw_l, paw_r = sorted(P["markings"], key=lambda m: (m["cy"] < 780, m["cx"]))[::-1][0:3] if False else (None, None, None)
mk = sorted(P["markings"], key=lambda m: -m["area"])
bib = mk[0]
paw_l, paw_r = sorted(mk[1:3], key=lambda m: m["cx"])
e1, e2 = sorted(P["eyes"], key=lambda e: e["cx"])
b1, b2 = P["blush"]


def ell(id_, e, fill):
    return f'<ellipse id="{id_}" cx="{e["cx"]}" cy="{e["cy"]}" rx="{e["rx"]}" ry="{e["ry"]}" transform="rotate({e["rot"]} {e["cx"]} {e["cy"]})" fill="{fill}"/>'


def svg(viewbox, bg=""):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">
<title>Yumi</title>
{bg}<defs><clipPath id="yumi-body-clip"><path d="{P["body"]}"/></clipPath></defs>
<g id="ear-left"><path d="{ear_l["d"]}" fill="{C[ear_l["fill"]]}" stroke="{C["line"]}" stroke-width="{SW}" stroke-linejoin="round"/><path id="ear-left-line" d="{stroke_near(259, 299)}" fill="none" stroke="{C["line"]}" stroke-width="{IW}" stroke-linecap="round"/></g>
<g id="ear-right"><path d="{ear_r["d"]}" fill="{C[ear_r["fill"]]}" stroke="{C["line"]}" stroke-width="{SW}" stroke-linejoin="round"/><path id="ear-right-line" d="{stroke_near(690, 295)}" fill="none" stroke="{C["line"]}" stroke-width="{IW}" stroke-linecap="round"/></g>
<g id="body">
<path id="body-fill" d="{P["body"]}" fill="{C["orange"]}"/>
<g id="markings" clip-path="url(#yumi-body-clip)" fill="{C["cream"]}">
<g id="stripes">{stripes}</g>
<circle id="patch" cx="{pt["cx"]}" cy="{pt["cy"]}" r="{pt["r"]}"/>
<path id="bib" d="{bib["d"]}"/>
<path id="paw-left" d="{paw_l["d"]}"/>
<path id="paw-right" d="{paw_r["d"]}"/>
</g>
<path id="body-line" d="{P["body"]}" fill="none" stroke="{C["line"]}" stroke-width="{SW}" stroke-linejoin="round"/>
<g id="legs" fill="none" stroke="{C["line"]}" stroke-width="{IW}" stroke-linecap="round">
<path id="leg-left-outer" d="{stroke_near(339, 803)}"/><path id="leg-left-inner" d="{stroke_near(446, 803)}"/>
<path id="leg-right-inner" d="{stroke_near(508, 798)}"/><path id="leg-right-outer" d="{stroke_near(610, 811)}"/>
<g id="toes" stroke-width="11"><path d="M402 851C403 857 405 862 406 868"/><path d="M431 843C433 851 434 859 433 867"/><path d="M524 843C522 851 521 859 522 867"/><path d="M551 851C550 857 549 862 548 868"/></g>
</g>
</g>
<g id="tail"><path d="{P["tail"]}" fill="{C["orange"]}" stroke="{C["line"]}" stroke-width="{SW}" stroke-linejoin="round"/></g>
<g id="face">
<g id="blush">{ell("blush-left", b1, C["blush"])}{ell("blush-right", b2, C["blush"])}</g>
<g id="eyes">{ell("eye-left", e1, C["line"])}{ell("eye-right", e2, C["line"])}</g>
<path id="mouth" d="{stroke_near(474, 529)}" fill="none" stroke="{C["line"]}" stroke-width="{IW}" stroke-linecap="round" stroke-linejoin="round"/>
<g id="whiskers" fill="none" stroke="{C["line"]}" stroke-width="{IW}" stroke-linecap="round">
<path id="whisker-left-top" d="{stroke_near(287, 544)}"/><path id="whisker-left-bottom" d="{stroke_near(287, 586)}"/>
<path id="whisker-right-top" d="{stroke_near(671, 546)}"/><path id="whisker-right-bottom" d="{stroke_near(666, 589)}"/>
</g>
</g>
</svg>'''


open(f"{HERE}/check.svg", "w").write(svg("0 0 951 1024", '<rect width="951" height="1024" fill="#F9F6E7"/>\n'))
open(f"{HERE}/yumi-cat.svg", "w").write(svg("169 220 704 704"))
print("stripes w", w, "gap", gap, "bottoms", bottoms, "patch", pt)

# ---------- TypeScript export for Remotion ----------
import re
def s(id_):
    return stroke_near(*{"earL": (259, 299), "earR": (690, 295), "mouth": (474, 529), "wLT": (287, 544), "wLB": (287, 586),
                         "wRT": (671, 546), "wRB": (666, 589), "legLO": (339, 803), "legLI": (446, 803), "legRI": (508, 798), "legRO": (610, 811)}[id_])
stripe_list = [{"x": round(mid + (i - 1) * gap - w / 2, 1), "w": w, "bottom": b} for i, b in enumerate(bottoms)]
ts = {
    "viewBox": "169 220 704 704",
    "palette": C, "outline": SW, "inner": IW,
    "body": P["body"], "tail": P["tail"],
    "earLeft": {"d": ear_l["d"], "fill": ear_l["fill"], "line": s("earL"), "pivot": [272, 342]},
    "earRight": {"d": ear_r["d"], "fill": ear_r["fill"], "line": s("earR"), "pivot": [680, 342]},
    "stripes": stripe_list, "patch": pt, "bib": bib["d"], "pawLeft": paw_l["d"], "pawRight": paw_r["d"],
    "legs": [s("legLO"), s("legLI"), s("legRI"), s("legRO")],
    "toes": ["M402 851C403 857 405 862 406 868", "M431 843C433 851 434 859 433 867", "M524 843C522 851 521 859 522 867", "M551 851C550 857 549 862 548 868"],
    "eyes": [e1, e2], "blush": [b1, b2], "mouth": s("mouth"),
    "whiskers": [s("wLT"), s("wLB"), s("wRT"), s("wRB")],
    "tailPivot": P["tailPivot"], "groundY": 876, "centerX": 476,
}
open(f"{HERE}/catParts.ts", "w").write("// Generated from the reference art by trace.py + build.py. Do not hand-edit; re-run the scripts.\n"
                                       "export const CAT = " + json.dumps(ts, indent=1) + " as const;\n")
