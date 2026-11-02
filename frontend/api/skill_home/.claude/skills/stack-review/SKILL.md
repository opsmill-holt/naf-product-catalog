---
name: stack-review
description: Review a visitor's network automation stack against the building blocks of the Network Automation Framework. Use when given a JSON list of products with their coverage and the framework's blocks.
---

# Stack review (placeholder)

This is a placeholder. Replace this file with your own skill; keep the name `stack-review`, or
change `SKILL` in `frontend/api/catalog_web/analysis.py` to match.

You receive JSON with two keys:

- `products`: the tools the visitor uses. Each has its description, status (`active` or
  `discontinued`) and `coverage`: the blocks it covers, with `extent` (`full`, `partial` or
  `not assessed`), a note, and the requirements it does not fully meet.
- `blocks`: every building block, with `status` (`covered`, `no tool` when the visitor said they
  have no tool for it, or `not stated`) and its MUST and SHOULD requirements.

Write a short review for the visitor:

1. Which blocks their tools cover fully and which only partly, naming the tools.
2. The blocks with no tool, and what the framework requires of them (from the MUST requirements).
3. The blocks they did not say anything about.
4. Any discontinued product in the stack.

Rules:

- Use only the facts in the JSON. Do not name products that are not in it, and do not guess
  features.
- Plain text, no Markdown headings or tables. Short paragraphs or simple lists with "-".
- At most 250 words. Neutral tone: describe, do not sell.
