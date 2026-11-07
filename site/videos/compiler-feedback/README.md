# Compiler feedback recording

The video shows real compiler output for `before.vibe`, followed by the successful execution of `after.vibe`. It demonstrates running a discarded Effect with `try`.

From `site`, install its dependencies and run:

```sh
node scripts/record-compiler-feedback.mjs
node --test scripts/compiler-video.test.mjs
```

Bun, Playwright Chromium and FFmpeg are required. The recorder creates a clean project using published packages, checks the rejected program, builds and runs the correction, then records the source and observed output. `recording.json` stores the package versions, command results and source, poster and video digests. The native property test repeats the rejection and correction with generated messages; the browser test checks playback through the built site.
