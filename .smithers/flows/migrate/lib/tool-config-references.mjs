// Build configuration is owned source even when a package inventories only src.
import { isFixtureFile, isTestFile } from "./inventory.mjs"
import { ownedPaths } from "./wire.mjs"

export const generatedTree = /(?:^|\/)(?:node_modules|dist|build|coverage|e2e|__e2e__|vendor|vendored|third_party|\.git|\.jj|\.cache|\.turbo|\.vite|\.vibelang)(?:\/|$)/
const testConfig = /(?:^|\/)(?:vitest|jest|playwright|cypress|wdio|karma|ava|mocha)(?:[.-][^/]*)?\.config\./
/** Owned code outside the inventory: a script or a target file can name a module by path. Tests and fixtures stay as written. */
export function ownedPathSources(root, files) {
  const owned = ownedPaths(root)
  return files.filter(file =>
    /\.(?:[cm]?[jt]sx?|vibe)$/.test(file) && !/\.d\.(?:vibe\.)?[cm]?ts$/.test(file) &&
    !generatedTree.test(file) && !isTestFile(file) && !isFixtureFile(file) && owned(file))
}

export function ownedToolConfigs(root, files) {
  const owned = ownedPaths(root)
  return files.filter(file =>
    /\.config(?:\.(?!(?:d|test|spec)\.)[\w-]+)?\.(?:[cm]?[jt]sx?|vibe)$/.test(file) &&
    !generatedTree.test(file) && !testConfig.test(file) && !isTestFile(file) && !isFixtureFile(file) && owned(file))
}
