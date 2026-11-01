import { Smithers as S } from "@smthrs/targets"

// A glob remains scoped to its declaring package even with a // prefix.
// Export these root-owned files as a group for package tests to consume.
export const migrationSources = S.Filegroup({
  srcs: [S.file(".smithers/flows/migrate/test/runtime-enumeration.property.test.mjs"), S.file(".smithers/flows/migrate/test/corpus/opencode-runtime-module-enumeration.json"), S.glob(".smithers/flows/migrate/lib/**"), S.glob(".smithers/flows/migrate/test/test-diff*.test.mjs"),
    S.file(".smithers/flows/migrate/test/corpus/foldkit-docpage-selector.json"),
    S.file(".smithers/flows/migrate/test/bundle-paths.property.test.mjs"), S.file(".smithers/flows/migrate/test/corpus/opencode-bundle-input-path.json")]
})

