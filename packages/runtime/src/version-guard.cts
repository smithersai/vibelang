declare const require: (id: string) => unknown

const PINNED_EFFECT_VERSION = "4.1.6"
const SUPPORTED_EFFECT_RANGE = "^4.1.0"

function isSupportedEffectVersion(version: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major === 4 && minor >= 1
}

function checkEffectVersion(version: string): void {
  if (!isSupportedEffectVersion(version)) {
    const { name, version: runtimeVersion } = require("../package.json") as { name: string, version: string }
    throw new Error(
      `${name}@${runtimeVersion} requires effect@${SUPPORTED_EFFECT_RANGE} (tested on ${PINNED_EFFECT_VERSION}); found effect@${version}. ` +
      `Install a supported version with: npm install effect@${PINNED_EFFECT_VERSION}`
    )
  }
}

export = { PINNED_EFFECT_VERSION, SUPPORTED_EFFECT_RANGE, isSupportedEffectVersion, checkEffectVersion } as const
