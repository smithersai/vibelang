# Ecosystem recordings

From `site`, run `node scripts/record-ecosystem.mjs` with Bun, npm,
Playwright Chromium and FFmpeg available. The recorder creates a clean project
using `create-vibelang@latest`, installs ESLint and `typescript-eslint`,
and runs the actual published tools. It clears compiler/runtime overrides.

The ESLint fixture deliberately reports `no-unused-vars` with exit status
`1`. The Vitest clip runs the published starter's two tests with exit status
`0`. A changed expected result stops recording.

Only terminal controls, the temporary project's root and the test runner's
clock row are removed from displayed output. Other absolute machine paths stop
recording. The output must fit within the frame. The JSON receipts bind the
displayed source/output to each MP4 and poster by SHA-256. Media tests reject
assets that differ from those reviewed receipts.

Run `node scripts/record-vite-demo.mjs` to capture a real published-package
Vite session. It starts the development server, verifies the greeting, introduces
a type error, reads the actual `TS2322` overlay, repairs the source and verifies
the changed greeting. Only the displayed project prefix is replaced, including
within the overlay's shadow root. The diagnostic itself is unchanged.

After updating the individual clips, run
`node scripts/record-ecosystem-overview.mjs`. It composes the ecosystem and introductory overviews from
the listed reviewed clips. Its receipt records every input hash; changing a
component without rebuilding the overview fails the media guard.

Run `node scripts/record-effect-lint.mjs` for the project-based Effect lint clip. Its clean npm project enables the language-service plugin, observes `EK3897`, checks the corrected source, compiles it and executes its awaited result. The receipt binds all four fixture files and every observed command to the recording. Rebuild both overviews afterward.
