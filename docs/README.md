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
- All product pages describe target Smithers behavior, including examples and
  CLI/API reference pages.
- Do not report repository progress, implementation coverage, POC behavior,
  backend parity, or production readiness in the product documentation.
- Use **Locked**, **Direction**, and **Open** to communicate design maturity.
  Those labels describe confidence in the target contract, not availability.
- When an exact spelling or mechanism is unsettled, state the target semantics
  and label the unsettled part rather than substituting implementation behavior.
- Implementation notes, conformance measurements, and migration worklists live
  beside the compiler, runtime, or conformance suite—not in this site.
