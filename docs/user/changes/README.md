# Unreleased changes

Each user-facing fix since the last published version adds one file here
instead of editing `docs/user/src/setup/release-notes.md`, so fixes that land
together never touch the same lines.

- `<topic>.md` holds one paragraph: the symptom a user saw, in plain words,
  then what happens now. Write it without the leading `- `.
- `<topic>.upgrade.md` holds rows of the top release's upgrade table, such as
  `| Before | After and repair |`, without the table header.

Name the file in lowercase kebab case after the fix, such as
`vite-bare-imports.md`. The assembler places entries in filename order in the top unreleased section. Check the entries
with `node docs/tools/release-changes.mjs --check`. At release,
`node docs/tools/release-changes.mjs --fold` writes them into the release notes
and removes the files.

The release flow uses `--check-empty` to catch outstanding entries before building.
