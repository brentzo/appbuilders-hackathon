---
name: product-lifecycle
description: How to add, rename, or change the owner of a Yumi product (a top-level folder such as harness, mac, android, bridge, protocol, character, models, iphone), including its README template, owner line, and registration in the repo map. Use whenever you create a new top-level product folder, write or restructure a product README, or change who owns a product.
---

# Product lifecycle

A product is a top-level folder with its own README and one owner.
Products are how work is split between people: each objective belongs to exactly one product, and each person writes code only in the products they own.

Current products and owners are listed in the generated owners table in `objectives/README.md`.

## When to add a product

Add a product only when the work has its own runtime, language, or deliverable, and a clear owner.
Examples: an app for a new platform, a new server, a shared asset library.
Do not add a product for a feature of an existing product; that is an objective.

## Adding a product

1. Choose a short, lowercase, single-word folder name that names the thing, not the team (`bridge`, not `jepoy-server`).
2. Create `<name>/README.md` from [readme-template.md](readme-template.md). Fill every section:
   - **Title:** `# Yumi <Thing>` (for example "Yumi Bridge", "Yumi for Android").
   - **Description:** one to three sentences on what it is and why it exists.
   - **Owner line:** exactly `Owner: <Name>.` on its own line. The check script reads this line; without it the folder is not treated as a product.
   - **Status line:** `Status: empty scaffold, nothing built yet.` until code exists, then a one-line current state.
   - **Responsibilities** and **Not responsible for:** be explicit about the boundary with neighboring products.
   - **Initial technical plan:** language, frameworks, runtimes. Mark choices that are not decided yet.
   - **Interfaces:** which products it talks to, how, and what crosses the boundary. Every crossing is a contract in `protocol/`.
   - **Specs** and **Objectives:** leave the generated markers exactly as in the template.
3. Add the product to the repository map table and, if it changes the architecture, the diagram in the root `README.md`.
4. Run `python3 scripts/objectives.py index` (it fills the owners table and the product's objective table), then `check`.
5. Commit with `docs(<name>): scaffold the <name> product`.

## Changing an owner

1. Edit the `Owner:` line in the product README.
2. Decide with the lead whether existing objectives move to the new owner. If yes, change each objective's `assignee`.
3. Run `index` and `check`, and commit.

## Renaming a product

Avoid it. If unavoidable: rename the folder with `git mv`, update every `product:` and `touches:` field, every link, the root README map, and the Interfaces sections of neighboring products, in one commit. Run `check` until it passes.

## Product README rules

- Keep it current. When an objective changes what the product does, update Responsibilities, Interfaces, or the technical plan in the same commit.
- The README describes the product as it is and is planned to be. History goes in commits and spec Decisions, not here.
