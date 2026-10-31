# VibeLang documentation site

The site at [vibelang.sh](https://vibelang.sh) is built with [Vocs](https://vocs.dev). The home page is `src/pages/index.mdx`. Every other page comes from the VibeLang user docs in this repository, `../docs/user`, and `sidebar.ts` comes from its `inventory.md`. Run the commands below from `site/`; `npm run deploy` deploys the site from here.

## Update the pages

```bash
node scripts/sync-user-docs.mjs ../docs/user
```

The script replaces every page in `src/pages` except `index.mdx`, `_root.css`, `proposals.mdx`, and `spec/`, rewrites `sidebar.ts`, and converts the Markdown that MDX rejects. Each page keeps its source path: `docs/user/src/error-management/014-expected-errors.md` becomes `/error-management/014-expected-errors`. Edit the source docs, not the generated pages, and run the script again. Production builds sync both sets of pages automatically after measuring kernel facts. `vibe.tmLanguage.json` is the grammar from the language repository's `editors/vscode/syntaxes/VibeLang.tmLanguage.json`; it highlights `vibe` code blocks.

## Update the specification

```bash
node scripts/sync-spec-docs.mjs ../docs --facts <facts.json>
node scripts/sync-user-docs.mjs ../docs/user
```

The specification importer validates the Specification inventory and writes 33 chapters plus the introduction at `src/pages/spec/index.mdx`, and `spec-sidebar.ts`. Its shared Markdown converter escapes MDX syntax while preserving code. Proposed blocks become info callouts; Not designed yet blocks become warning callouts. Bare fragments resolve to their owning chapter, with missing or ambiguous targets rejected. A link to another file in the language repository keeps only its text, so the importer needs a full checkout to confirm that the file exists.

The facts JSON must supply `testCount`, `testFiles`, and `kernelLines` as nonnegative integers (or integer strings), taken from a real language repository test run. Example facts are for build verification only and must be replaced before publishing. Unknown or missing placeholders fail before pages are written. Syncing user docs after the spec exists changes specification links to local routes and preserves the spec pages and its independent sidebar. Without the spec, user sync retains its existing external links.

## Development

```bash
npm ci
npm run dev
```

The local site is available at `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

Vocs checks internal links during the production build, and a dead link fails it. docs/tools/check-site.ts then validates built page and heading targets and self-contained images. Generated output is written to `dist/`. The prebuild hook runs the kernel law suite, or reuses the receipt of a passing run with the same inputs (`docs/tools/kernel-facts.ts`), and syncs both doc sets. The postbuild hook writes Markdown copies and llms.txt to dist/public using docs/tools/markdown.ts, normalizes Vocs build metadata to repo-relative paths, and runs the unchanged publication leak scan over dist/. Synthetic playground paths and IPs use public examples. Run npm run test:llms after building.

### Browser contrast check

After installing dependencies, install Chromium once and test the built site:

```sh
npx playwright install chromium
npm run build
npm run test:contrast
```

The check serves `dist/public` on a temporary loopback port and routes Vocs' public base URL to that build. It loads the home page, Welcome and the cheat sheet in light and dark themes, requires zero axe color-contrast violations with no exceptions, and measures the copy button's text, icon, keyboard focus, clipboard success/error feedback, and interaction states. It also measures the site's hero text and gradient, the alpha banner, and every code text color against its rendered background, including inactive tabs. Banner and code text require at least 4.5:1 in both themes. The cheat sheet is also audited after scrolling to its first code block, when the outline's Return to top control appears. `docs/tools` tests build the site and run this check during release validation; Chromium is required, and a missing browser fails with Playwright's install instructions.

Set `CONTRAST_ARTIFACTS` to save 1366px home and first-code-block cheat sheet screenshots in each theme, plus `contrast.json` with all measured colors, failures and axe findings. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects an existing Chromium.

### Temporary Vocs search accessibility patch

[`#1`](https://github.com/smithersai/vibelang/issues/1) tracks the search combobox's missing active-result relationship. npm has no native `patchedDependencies` mechanism here. The checked-in patch targets Vocs 2.8.5's `Search.tsx`; npm's `postinstall`, `prebuild` and `predev` hooks apply it with exact version/source checks and zero patch fuzz. The script recompiles only that module because Vocs loads its shipped `dist` JavaScript. It preserves the upstream [MIT license](https://github.com/wevm/vocs/blob/main/LICENSE), package and normal Vocs commands. Node, the existing TypeScript dependency, and the standard `patch` utility are required.

The hook is idempotent and refuses borrowed/symlinked Vocs files or unreviewed source/compiled changes. A workspace borrowing another checkout's dependencies needs its own Vocs directory before running these hooks; shared dependencies must stay unchanged. `node --test scripts/patch-vocs-search.test.mjs` checks these guards. With an existing Playwright installation, run `BASE_URL=http://localhost:4173 PLAYWRIGHT_MODULE=./node_modules/playwright/index.mjs node scripts/verify-search-accessibility.mjs` against the built preview. It checks selection linkage, changed and empty results, responsive instances, dismissal, recent results, and navigation. Omit `BASE_URL` to reproduce against production.

Remove the patch and lifecycle hooks when an [upstream Vocs Search](https://github.com/wevm/vocs/blob/main/src/react/internal/Search.tsx) release provides unique result/listbox IDs and `aria-activedescendant`, then update the pinned version and run the keyboard/browser regressions. Published 2.10.3 still lacked this relationship when checked on 2026-10-18.

## Social card

`public/social-card.svg` is the outlined source for the 1200×630 social card, using the mark from `public/logo-light.svg`. From `site/`, run `npm run social-card` to reproduce `public/social-card.png` with the pinned renderer and no system fonts. Keep the PNG under 300 KB. The built-site check requires social image URLs and their metadata on every HTML page.

## Deploy

Before planning or deploying, check the real Alchemy CLI imports, construct the
stack without credentials, and type-check it:

```sh
npm run test:infrastructure
npm run typecheck
```

These checks run during docs validation and the deployment dry run. The import
check does not evaluate the stack or contact Cloudflare.


From the repository root, build and run every publication check:

```sh
sh scripts/deploy-docs.sh --dry-run
sh scripts/deploy-docs.sh
```

The second command deploys vibelang.sh through npm run deploy in site/.
alchemy.run.ts serves dist/public as a static-assets Worker and keeps state
in Cloudflare. Both deployment and planning require CLOUDFLARE_ACCOUNT_ID
and CLOUDFLARE_API_TOKEN with Workers Scripts Edit, domain/zone routing access,
and Account Secrets Store Edit. Cloudflare manages the state-store credentials.

Deploy the retired-domain redirect Worker separately from the repository root:

```sh
bunx wrangler@4.151.1 deploy --config docs/redirect/wrangler.jsonc
```

It needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN with Workers Scripts
Edit and access to the configured domains. Every configured retired domain
returns a 301 to https://vibelang.sh at the same path and query. A final .html
is removed, and /index.html maps to /. No redirect is deployed by the site pipeline.
