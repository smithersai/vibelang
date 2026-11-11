// The names left out of every copy of the app template or an example: installed
// dependencies, build output, compiler caches and lockfiles. A lockfile made by
// a local install records that machine's paths and registry, so it never ships.
// The release packager, the local template installer and the example stager
// all use this one list.
import { basename } from "node:path"

export const templateExcluded = ["node_modules", "dist", ".prototype", ".vibe", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]

// A cpSync filter: false for an excluded file or directory.
export const templateFilter = (path) => !templateExcluded.includes(basename(path))

// For a path relative to the template: false when any segment is excluded.
export const isTemplateFile = (path) => !path.split(/[\\/]/).some((segment) => templateExcluded.includes(segment))
