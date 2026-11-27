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
  cache: S.Cache({
    directory: ".flows",
    // Shared Smithers Cloud object store (https://build.smithers.sh).
    // Split read/write credentials enforce the cache trust model:
    // - Non-maintainers and unreviewed PRs may read shared cache hits freely
    //   and run untrusted builds locally or in untrusted sandboxes, but the
    //   server refuses PUT/DELETE with the read token (HTTP 403) so untrusted
    //   results can never poison trunk cache keys or skip gates.
    // - Only trusted maintainer/controlled-sandbox post-merge jobs on `main`
    //   hold SMITHERS_CACHE_WRITE_TOKEN (via the main-only `cache-publish` env).
    remote: S.RemoteCache.make({
      endpoint: "https://build.smithers.sh",
      read: S.Secret("SMITHERS_CACHE_READ_TOKEN"),
      write: S.Secret("SMITHERS_CACHE_WRITE_TOKEN")
    })
  }),
  runtime,
  packageManager: S.PackageManager.Pnpm({ version: "11.25.0", runtime }),
  nodeModules: S.Npm.NodeModules({ packageJson: S.file("//.smithers/package.json") }),
  host: S.Host({ bins: ["go", "gofmt", "node", "bun", "jj", "diff3", "python3", "npm", "pnpm", "git", "patch", "tar"] }),
  // Gitignored trees with no CACHEDIR.TAG: discovery would walk each one on
  // every smthrs command.
  discovery: { prune: [".cache", ".uphill", "typescript/built", "typescript/.cache", "typescript/vibelang/cases",
    "packages/vite/test/.fixtures", "packages/unplugin/test/.fixtures",
    "packages/vite/test/.prepared", "packages/unplugin/test/.prepared", "packages/compiler/test/source-maps/.prepared"] }
})
