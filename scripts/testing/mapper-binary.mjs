import { existsSync } from "node:fs"
import { join } from "node:path"

// The mapper CLI the parity tests drive. The graph builds it once
// (typescript/built/local/vibelang-mapper) and the published package ships it
// under bin/; a test that cannot find either builds its own copy, which on a
// shared box competes with every other Go build for the same CPUs.
export const packagedMapper = "packages/ts-mapper/bin/vibelang-mapper"
export const builtMapper = "typescript/built/local/vibelang-mapper"

// PARITY_TEST_MAPPER names a locally built mapper. A missing path falls through
// to the repository copies, and undefined means the caller must build one.
export function locateMapper({ root, env = process.env, exists = existsSync }) {
  const candidates = [env.PARITY_TEST_MAPPER, join(root, packagedMapper), join(root, builtMapper)]
  return candidates.find((candidate) => candidate && exists(candidate))
}
