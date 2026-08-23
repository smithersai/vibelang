---
title: Typed markdown assets
draft: false
version: 2
owner:
  team: compiler
  handle: smithers
tags:
  - assets
  - markdown
---
# Typed markdown assets

`{ type: "markdown" }` is the provisional parsed-document form. The default
export is still the unchanged source string, so a prompt consumer keeps the
zero-ceremony `.md` behaviour.

## Front matter

The loader accepts a strict YAML subset. Anything outside it is a
source-located diagnostic instead of a quietly different value:

```yaml
# not parsed: this fence is skipped by heading extraction
maybe: yes
```

## Headings

Headings carry their source offset so a later stage can map a rendered
document back to the authored file.
