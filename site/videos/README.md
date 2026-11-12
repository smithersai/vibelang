# Site video recordings

Each subdirectory holds the sources, recorder notes and receipts for videos in
`site/public/videos/`. A receipt binds a video and its poster by SHA-256 to the
commands and output it shows.

`manifest.json` lists every video a page embeds, with its poster and the
VibeLang version the recording shows (`null` when the recording does not say).
`node docs/tools/site-videos.mjs` checks that every embedded video has an entry,
that each entry agrees with its receipt, and that `site/public/videos/` holds no
file a page does not link. `scripts/deploy-docs.sh` runs it with
`--release <version>`, which also fails for any video that does not record the
release the site states. Re-record such a video with that release, then update
its entry.
