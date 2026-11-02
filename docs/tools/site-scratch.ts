import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

// The site build writes into site/: npm ci replaces node_modules, the prebuild
// deletes and rewrites the generated pages and sidebars, vocs writes dist, and
// build-docs.ts writes ../.cache. //:docs-tools and //:docs-check read those
// files meanwhile, and a checkout's node_modules may link to an install other
// checkouts share. So //:site-contrast builds a private copy of site/ whose
// siblings link to the checkout's, and can run beside the other targets.
const IGNORED = new Set(["node_modules", "dist", ".vocs", ".alchemy"]) // site/.gitignore
const UNLINKED = new Set(["site", ".cache", ".git", ".jj"])

export function scratchSite(repo: string) {
  const checkout = join(repo, "site")
  const before = snapshot(checkout)
  const root = mkdtempSync(join(tmpdir(), "vibelang-site-"))
  for (const entry of readdirSync(repo)) if (!UNLINKED.has(entry)) symlinkSync(join(repo, entry), join(root, entry))
  mkdirSync(join(root, ".cache"))
  cpSync(checkout, join(root, "site"), { recursive: true, filter: (source) => !IGNORED.has(relative(checkout, source).split("/")[0]) })
  return {
    site: join(root, "site"),
    /** Removes the copy, then throws naming the checkout's site/ files that changed since the copy was made. */
    finish() {
      rmSync(root, { recursive: true, force: true })
      const after = snapshot(checkout)
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file)).sort()
      if (changed.length) throw new Error(`the site build changed the checkout's site/: ${changed.slice(0, 10).join(", ")}`)
    },
  }
}

/** Every file under dir with its size and modification time; node_modules as a link target or one entry. */
function snapshot(dir: string, files = new Map<string, string>(), base = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const file = relative(base, path)
    if (entry.isSymbolicLink()) files.set(file, "-> " + readlinkSync(path))
    else if (entry.isDirectory() && file !== "node_modules") snapshot(path, files, base)
    else {
      const stat = lstatSync(path)
      files.set(file, `${stat.size} ${stat.mtimeMs}`)
    }
  }
  return files
}
