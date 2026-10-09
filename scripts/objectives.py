#!/usr/bin/env python3
"""Regenerate and validate Yumi's objective tables and docs.

Usage:
    python3 scripts/objectives.py index   # rewrite every generated table
    python3 scripts/objectives.py check   # validate; exit 1 on any problem

Generated tables live between HTML comment markers, for example
<!-- generated:objectives-index:start --> and <!-- generated:objectives-index:end -->.
Never edit inside the markers by hand; edit the objective files and run `index`.
"""

import glob
import os
import re
import sys
from functools import lru_cache

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBJ_DIR = os.path.join(ROOT, "objectives")
OBJ_README = os.path.join(OBJ_DIR, "README.md")

STATUSES = ("todo", "in-progress", "blocked", "done")
PRIORITIES = ("p0", "p1", "p2")
REQUIRED_FIELDS = (
    "id", "title", "product", "assignee", "touches", "specs", "status",
    "priority", "depends-on", "integrates-with", "tags",
)
REQUIRED_SECTIONS = (
    "## Project context", "## Why this objective", "## Read first", "## Tasks",
    "## Expectations", "## Expected outcomes", "## Out of scope", "## Outcome",
)
OUTCOME_PLACEHOLDER = "_Not finished yet."
EM_DASH = "—"


def rel(path):
    return os.path.relpath(path, ROOT)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    fields = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields


def as_list(value):
    return [x.strip() for x in value.strip("[]").split(",") if x.strip()]


def products():
    """Product folders are top-level folders whose README has an `Owner:` line."""
    found = {}
    for readme in sorted(glob.glob(os.path.join(ROOT, "*", "README.md"))):
        m = re.search(r"^Owner: (\w+)\.$", read(readme), re.M)
        if m:
            found[os.path.basename(os.path.dirname(readme))] = m.group(1)
    return found


def load_objectives():
    objectives = {}
    for path in sorted(glob.glob(os.path.join(OBJ_DIR, "OBJ-*.md"))):
        text = read(path)
        fields = frontmatter(text) or {}
        oid = fields.get("id", os.path.basename(path))
        objectives[oid] = {
            "path": path,
            "file": os.path.basename(path),
            "text": text,
            "fields": fields,
            "title": fields.get("title", "").strip('"').replace('\\"', '"'),
            "product": fields.get("product", ""),
            "assignee": fields.get("assignee", ""),
            "status": fields.get("status", ""),
            "specs": [s.replace("SPEC-", "") for s in as_list(fields.get("specs", ""))],
            "deps": as_list(fields.get("depends-on", "")),
            "soft": as_list(fields.get("integrates-with", "")),
        }
    return objectives


def short(ids):
    return ", ".join(i.replace("OBJ-", "") for i in ids) or "-"


def people(objs, prods):
    order = []
    for name in list(prods.values()) + [o["assignee"] for o in objs.values()]:
        if name and name not in order:
            order.append(name)
    return order


def build_tables(objs, prods):
    dependents = {i: set() for i in objs}
    for i, o in objs.items():
        for d in o["deps"]:
            if d in dependents:
                dependents[d].add(i)

    def downstream(i, seen=None):
        seen = set() if seen is None else seen
        for c in dependents[i]:
            if c not in seen:
                seen.add(c)
                downstream(c, seen)
        return seen

    @lru_cache(None)
    def wave(i):
        return 1 + max([wave(d) for d in objs[i]["deps"] if d in objs], default=0)

    team = people(objs, prods)
    t = {}

    rows = ["| ID | Objective | Product | Assignee | Specs | Depends on | Integrates with | Status |",
            "|---|---|---|---|---|---|---|---|"]
    for i, o in objs.items():
        rows.append(f"| [{i}]({o['file']}) | {o['title']} | {o['product']} | {o['assignee']} | "
                    f"{', '.join(o['specs'])} | {short(o['deps'])} | {short(o['soft'])} | {o['status']} |")
    t["objectives-index"] = "\n".join(rows)

    rows = ["| Rank | Objective | Assignee | Holds up (hard) | Holds up another person |",
            "|---|---|---|---|---|"]
    rank = 0
    for i in sorted(objs, key=lambda i: (-len(downstream(i)), i)):
        held = downstream(i)
        if not held:
            continue
        rank += 1
        cross = sorted({objs[c]["assignee"] for c in held if objs[c]["assignee"] != objs[i]["assignee"]})
        rows.append(f"| {rank} | {i} {objs[i]['title']} | {objs[i]['assignee']} | {len(held)} | {', '.join(cross) or 'No'} |")
    t["objectives-priority"] = "\n".join(rows)

    cross = [f"- {d} ({objs[d]['assignee']}) before {i} ({o['assignee']})"
             for i, o in objs.items() for d in o["deps"]
             if d in objs and objs[d]["assignee"] != o["assignee"]]
    t["objectives-cross"] = "\n".join(cross) or "- None"

    rows = ["| Person | Objectives | Count |", "|---|---|---|"]
    for p in team:
        mine = [i for i in objs if objs[i]["assignee"] == p]
        rows.append(f"| {p} | {short(mine)} | {len(mine)} |")
    t["objectives-workload"] = "\n".join(rows)

    waves = {}
    for i in objs:
        waves.setdefault(wave(i), []).append(i)
    rows = ["| Wave | " + " | ".join(team) + " |", "|---|" + "---|" * len(team)]
    for w in sorted(waves):
        cells = [", ".join(i for i in waves[w] if objs[i]["assignee"] == p) or "-" for p in team]
        rows.append(f"| {w} | " + " | ".join(cells) + " |")
    t["objectives-waves"] = "\n".join(rows)

    rows = ["| Owner | Products |", "|---|---|"]
    for p in team:
        owned = [name for name, owner in prods.items() if owner == p]
        if owned:
            rows.append(f"| {p} | {', '.join(owned)} |")
    t["objectives-owners"] = "\n".join(rows)
    return t


def product_table(objs, product):
    rows = ["| ID | Objective | Assignee | Status |", "|---|---|---|---|"]
    mine = [i for i in objs if objs[i]["product"] == product]
    for i in mine:
        o = objs[i]
        rows.append(f"| [{i}](../objectives/{o['file']}) | {o['title']} | {o['assignee']} | {o['status']} |")
    if not mine:
        rows = ["None yet."]
    return "\n".join(rows)


def replace_block(text, name, body):
    start, end = f"<!-- generated:{name}:start -->", f"<!-- generated:{name}:end -->"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(text):
        return text, False
    return pattern.sub(lambda _: f"{start}\n{body}\n{end}", text), True


def render(objs, prods):
    """Return {path: new_text} for every file with generated blocks."""
    out = {}
    text = read(OBJ_README)
    for name, body in build_tables(objs, prods).items():
        text, _ = replace_block(text, name, body)
    out[OBJ_README] = text
    for product in prods:
        path = os.path.join(ROOT, product, "README.md")
        text, _ = replace_block(read(path), "product-objectives", product_table(objs, product))
        out[path] = text
    return out


def check_markdown(problems):
    for path in glob.glob(os.path.join(ROOT, "**", "*.md"), recursive=True):
        if "/node_modules/" in path or "/build/" in path or "/.git/" in path:
            continue
        text = read(path)
        if EM_DASH in text:
            problems.append(f"{rel(path)}: contains an em dash; use a plain dash")
        for m in re.finditer(r"\]\(([^)#\s]+)(#[^)]*)?\)", text):
            target = m.group(1)
            if re.match(r"^[a-z]+:", target) or "<" in target or "NN" in target:
                continue  # external links and template placeholders
            if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(path), target))):
                problems.append(f"{rel(path)}: broken link to {target}")


def check_objectives(objs, prods, problems):
    team = set(prods.values())
    for i, o in objs.items():
        where = rel(o["path"])
        f = o["fields"]
        missing = [k for k in REQUIRED_FIELDS if k not in f]
        if missing:
            problems.append(f"{where}: missing frontmatter fields {missing}")
            continue
        if not o["file"].startswith(i + "-"):
            problems.append(f"{where}: file name does not start with its id {i}")
        if o["product"] not in prods:
            problems.append(f"{where}: unknown product '{o['product']}'")
        if o["assignee"] not in team:
            problems.append(f"{where}: assignee '{o['assignee']}' is not a product owner {sorted(team)}")
        if o["status"] not in STATUSES:
            problems.append(f"{where}: status '{o['status']}' must be one of {STATUSES}")
        if f["priority"] not in PRIORITIES:
            problems.append(f"{where}: priority must be one of {PRIORITIES}")
        for d in o["deps"] + o["soft"]:
            if d not in objs:
                problems.append(f"{where}: depends on unknown objective {d}")
        for t in as_list(f["touches"]):
            if t not in prods:
                problems.append(f"{where}: touches unknown product '{t}'")
        for s in o["specs"]:
            if not glob.glob(os.path.join(ROOT, "specs", f"{s}-*.md")):
                problems.append(f"{where}: unknown spec SPEC-{s}")
        for section in REQUIRED_SECTIONS:
            if section + "\n" not in o["text"]:
                problems.append(f"{where}: missing section '{section}'")
        outcome = o["text"].split("## Outcome\n", 1)[-1]
        if o["status"] == "done":
            if OUTCOME_PLACEHOLDER in outcome:
                problems.append(f"{where}: status is done but the Outcome section is still the placeholder")
            if "- [ ]" in o["text"].split("## Tasks", 1)[-1].split("## Expected outcomes", 1)[0]:
                problems.append(f"{where}: status is done but some tasks or expectations are unchecked")
        for d in o["deps"]:
            if o["status"] in ("in-progress", "done") and d in objs and objs[d]["status"] != "done":
                problems.append(f"{where}: is {o['status']} but hard dependency {d} is {objs[d]['status']}")

    seen, stack = set(), set()

    def visit(i):
        if i in stack:
            problems.append(f"objectives: dependency cycle through {i}")
            return
        if i in seen or i not in objs:
            return
        stack.add(i)
        for d in objs[i]["deps"]:
            visit(d)
        stack.discard(i)
        seen.add(i)

    for i in objs:
        visit(i)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("index", "check"):
        print(__doc__)
        return 2
    objs, prods = load_objectives(), products()
    rendered = render(objs, prods)
    if sys.argv[1] == "index":
        for path, text in rendered.items():
            if read(path) != text:
                write(path, text)
                print(f"updated {rel(path)}")
        print("index done")
        return 0
    problems = []
    for path, text in rendered.items():
        if read(path) != text:
            problems.append(f"{rel(path)}: generated tables are out of date; run `python3 scripts/objectives.py index`")
    check_objectives(objs, prods, problems)
    check_markdown(problems)
    for p in problems:
        print(p)
    print("check passed" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
