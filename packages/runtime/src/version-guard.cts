declare const require: (id: string) => unknown

const PINNED_EFFECT_VERSION = "4.1.1"

function checkEffectVersion(version: string): void {
  if (version !== PINNED_EFFECT_VERSION) {
    const { name, version: runtimeVersion } = require("../package.json") as { name: string, version: string }
    throw new Error(
      `${name}@${runtimeVersion} requires effect@${PINNED_EFFECT_VERSION}; found effect@${version}. ` +
      `Install the supported version with: npm install effect@${PINNED_EFFECT_VERSION}`
    )
  }
}

export = { PINNED_EFFECT_VERSION, checkEffectVersion } as const
