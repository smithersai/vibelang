// Build configuration is owned source even when a package inventories only src.
import { isFixtureFile, isTestFile } from "./inventory.mjs"
import { ownedPaths } from "./wire.mjs"

const generated = /(?:^|\/)(?:node_modules|dist|build|coverage|e2e|__e2e__|vendor|vendored|third_party|\.git|\.jj|\.cache|\.turbo|\.vite|\.vibelang)(?:\/|$)/
const testConfig = /(?:^|\/)(?:vitest|jest|playwright|cypress|wdio|karma|ava|mocha)(?:[.-][^/]*)?\.config\./
export function ownedToolConfigs(root, files) {
  const owned = ownedPaths(root)
  return files.filter(file =>
    /\.config\.(?:[cm]?[jt]sx?|vibe)$/.test(file) &&
    !generated.test(file) && !testConfig.test(file) && !isTestFile(file) && !isFixtureFile(file) && owned(file))
}
