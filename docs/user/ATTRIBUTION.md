# Upstream attribution and licensing status

Checked: 2026-10-15 (America/Los_Angeles).

Upstream repository: [Effect-TS/website](https://github.com/Effect-TS/website).
Branch: `main`.
Commit: `9b2ad8c7569b7ca65562185052c1122167eae906` (verified with `gh api repos/Effect-TS/website/commits/main --jq .sha`).

## Source verification

The [repository metadata](https://api.github.com/repos/Effect-TS/website) describes it as “Source code for Effect's documentation website” and identifies `https://www.effect.website` as its homepage. The pinned [Astro configuration](https://github.com/Effect-TS/website/blob/9b2ad8c7569b7ca65562185052c1122167eae906/apps/web/astro.config.ts) sets `site: "https://effect.website"` and redirects `/docs` to `/docs/v4/onboarding`, matching the [live docs](https://effect.website/docs).

Docs content directory: `apps/web/src/content/docs/`.
Sidebar section ordering configuration: `apps/web/src/content/docs/sidebar-config.json`.

## License: unresolved — copying stopped

The complete, non-truncated [repository tree](https://api.github.com/repos/Effect-TS/website/git/trees/9b2ad8c7569b7ca65562185052c1122167eae906?recursive=1) contains no LICENSE, COPYING, or NOTICE file. Requests for the root `LICENSE` and GitHub's repository `/license` endpoint return HTTP 404; repository metadata reports `license: null`. Neither the root nor web app package manifest declares a license.

The live website footer displays “MIT Licensed” and credits Effectful Technologies Inc. (© 2026), but a repository license text covering this snapshot's documentation could not be read or preserved. This records the site's claim; it does not establish verified repository licensing terms.

The earlier licensing check stopped copying and left the per-page inventory pending. The structure-only inventory and original-writing stubs have now been completed as described below. No upstream documentation body prose or code examples have been copied. Obtain an upstream license file or explicit documentation reuse permission before copying or adapting upstream text or examples. No archive was downloaded, and no Git or jj commands were run.

Proposed attribution for any subsequently authorized copy: “Documentation derived from Effect-TS/website, by the Effect documentation contributors; upstream snapshot 9b2ad8c7569b7ca65562185052c1122167eae906, checked 2026-10-15. Effect website footer credits Effectful Technologies Inc. VibeLang modifications and translations must be identified separately.” Preserve the actual upstream copyright and license notice once supplied; this proposed attribution is not a substitute for it.

## Effect versions

The current default documentation describes **Effect 4.x**: both the live `/docs` redirect and pinned Astro configuration select `/docs/v4/onboarding`.

Effect 4 documentation already exists on `main` under `apps/web/src/content/docs/v4/`; no alternate branch is needed. Effect 3 documentation is retained alongside it under `apps/web/src/content/docs/v3/`. The repository branch listing also includes `tutorials-v4`; that branch's contents were not audited because the main-branch path already answers whether v4 docs exist.

## Page counts by repository directory

These counts use Markdown/MDX paths in the pinned tree. Root pages include onboarding, the guides landing page, batching, configuration, and runtime. The initial counts were computed from paths alone; the completed Effect 4 inventory now verifies all 110 sources and their sidebar placement.

| Section directory | Effect 4 pages | Effect 3 pages |
| --- | ---: | ---: |
| (root pages) | 5 | 5 |
| additional-resources | 0 | 5 |
| ai | 0 | 4 |
| behaviour | 2 | 2 |
| caching | 2 | 2 |
| code-style | 6 | 6 |
| concurrency | 7 | 7 |
| data-types | 11 | 11 |
| error-management | 12 | 12 |
| getting-started | 9 | 9 |
| micro | 0 | 2 |
| observability | 4 | 4 |
| platform | 6 | 8 |
| requirements-management | 4 | 4 |
| resource-management | 2 | 2 |
| scheduling | 4 | 6 |
| schema | 20 | 18 |
| sink | 4 | 5 |
| state-management | 3 | 3 |
| stream | 6 | 6 |
| testing | 1 | 1 |
| trait | 2 | 2 |
| **Total** | **110** | **124** |

## Original docs and upstream structure

VibeLang end-user documentation follows the pinned Effect 4 sections, pages, order, and topics one to one. No upstream prose is copied; pages are written fresh for VibeLang. Upstream code examples are not copied either. The unresolved upstream licensing status remains recorded above.

The [structure and topic inventory](inventory.md) records all 110 upstream page paths, titles, sidebar sections, original short topic phrases, central Effect API names, and fenced code example counts. It follows both sidebar views: onboarding has 12 pages across Start Here, Learning Path, and Core Concepts; guides has the remaining 98 pages. Ordering was checked against `sidebar-config.json`, `onboarding-groups.json`, the sidebar construction code, and page frontmatter at the pinned commit.

The [source directory](src/) contains the VibeLang guides. The guides that follow the Effect structure retain the source directories and page slugs, with numeric filename prefixes recording sidebar reading order. The structure inventory records the upstream sources used when planning those guides.

Upstream pages were read through pinned raw-file URLs, and the page list was read through `gh api`. Source text was processed in memory; no upstream body prose or code examples were saved locally. All 110 pages were readable. No archive, Git command, or jj command was used. All task writes were confined to `docs/user/`.
