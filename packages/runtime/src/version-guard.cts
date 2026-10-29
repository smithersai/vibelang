const PINNED_EFFECT_VERSION = "4.1.0"

function checkEffectVersion(version: string): void {
  if (version !== PINNED_EFFECT_VERSION) {
    throw new Error(
      `vibelang-runtime@0.0.11 requires effect@${PINNED_EFFECT_VERSION}; found effect@${version}. ` +
      `Install the supported version with: npm install effect@${PINNED_EFFECT_VERSION}`
    )
  }
}

export = { PINNED_EFFECT_VERSION, checkEffectVersion } as const
