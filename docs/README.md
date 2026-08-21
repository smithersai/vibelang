# VibeLang documentation site

The documentation site is built with [Vocs](https://vocs.dev). Source pages live in `src/pages`, navigation lives in `vocs.config.ts`, and static assets live in `public`.

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

## Content conventions

- Guide pages explain how to use a feature and lead with examples.
- Reference pages provide compact syntax and API lookup.
- Specification pages distinguish locked behavior, accepted direction, and open design questions.
- Design-stage examples must not imply that a feature is available in the prototype.
