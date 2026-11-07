# Starter test recording

The clip shows the generated starter's tests and output from a real published-package run. The source fixture must exactly match the published starter before the recorder proceeds.

From `site`, install its dependencies and run:

```sh
node scripts/record-starter-test.mjs
node --test scripts/starter-video.test.mjs
```

The recorder requires Bun, Playwright Chromium and FFmpeg. It creates a fresh project outside the repository with `bun create vibelang@latest my-app`, runs `bun run test`, records the source and observed output, then encodes the MP4 and poster. `recording.json` stores the package versions, test output and SHA-256 digests of the source and encoded assets. The recorder removes terminal colors, the temporary project path and the test runner's start-time line.

The native-compiler property test also runs the fixture with generated names. The browser test checks playback through the built site.
