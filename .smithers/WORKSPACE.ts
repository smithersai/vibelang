import { Smithers as S } from "@smthrs/targets"

// VibeLang's build graph. Each PACKAGE.ts declares targets; the files and
// targets a target names are its inputs, and their digests are its key.
// `smthrs ci //...` runs every target whose key changed and replays the rest
// from `.flows/cache`. docs/maintainers/build.md has the package graph and
// what each kind of change reruns.
//
// Every tool a target spawns is a declared host binary, so its bytes enter
// the key of each target that names it: a new Go, Node or Bun install re-keys
// exactly the targets that run it.
export const runtime = S.Runtime.Node({ version: ">=26.4.0" })

export const Workspace = S.Workspace("vibelang", {
  repository: "git+https://github.com/smithersai/vibelang.git",
  cache: S.Cache({ directory: ".flows" }),
  runtime,
  packageManager: S.PackageManager.Pnpm({ version: "11.25.0", runtime }),
  nodeModules: S.Npm.NodeModules({ packageJson: S.file("//.smithers/package.json") }),
  host: S.Host({ bins: ["go", "gofmt", "node", "bun"] }),
  // Gitignored trees with no CACHEDIR.TAG: discovery would walk each one on
  // every smthrs command.
  discovery: { prune: [".cache", "typescript/built", "typescript/.cache"] }
})
