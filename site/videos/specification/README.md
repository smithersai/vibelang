# Specification walkthrough

Run `node scripts/record-specification.mjs` from `site/` with Node, npm, Playwright Chromium and FFmpeg installed. The recorder creates a fresh project using the published compiler and runtime, checks and executes all three source files, then captures their source and observed output.

The recording covers Effects and typed recovery, services and providers, and tagged data with exhaustive matching. Each program starts explicitly with `await runPromise(main())`. Recovery uses a visible handler function, `catch () => value`.

`recording.json` binds the source, poster and video hashes to the actual commands, installed version and results. The documentation tests execute generated payload variants with the source compiler; the production-site test plays the embedded recording at phone and desktop widths.
