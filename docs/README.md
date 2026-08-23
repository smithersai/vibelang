# Smithers documentation site

The documentation site is built with [Vocs](https://vocs.dev). Source pages live in `src/pages`, navigation lives in `vocs.config.ts`, and static assets live in `public`.

> **Source-checkout note:** npm includes this nested README for context, but it
> does not ship the documentation workspace, site source, or deployment state.
> The commands below are maintainer commands for a repository checkout.

## Development

```bash
npm install
npm run dev
```

The local site is available at `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

Vocs checks internal links during the production build. Generated output is written to `dist/` and is ignored by Git.

## Deploy to Cloudflare

The production site is deployed to `https://docs.smithers.sh` with [Alchemy](https://alchemy.run). The domain must already be an active zone in the Cloudflare account used to deploy.

Preview the infrastructure changes, then deploy from this directory:

```bash
npm run deploy:plan
npm run deploy
```

On the first run, Alchemy prompts for Cloudflare authentication. It stores deployment state in Cloudflare so local and CI deployments share the same state.

## Content conventions

- Guide pages explain how to use a feature and lead with examples.
- Reference pages provide compact syntax and API lookup.
- Specification pages distinguish locked behavior, accepted direction, and open design questions.
- Design-stage examples must not imply that a feature is available in the current POC.
- Implementation claims must say whether they describe the root CLI/package,
  the default TypeScript instrument, the opt-in Go fork backend, a narrower
  programmatic POC, or planned production behavior. The current CLI boundary
  is recorded in `src/pages/reference/cli.mdx`.
- The retired regex transformer under `../prototype` is historical. The checked
  frontend under `../poc/src/language` is integrated into the root CLI/package
  and remains its default. A second, explicit backend now performs real
  Smithers checking and lowering inside the pinned Go TypeScript fork. Neither
  implementation is a claim that a conforming compiler has been released.
- Conformance totals move while the corpus and backends are being developed.
  Prefer a qualitative status and point readers to `../conformance/COVERAGE.md`,
  or attach any total to its measurement date and exact tree state.
