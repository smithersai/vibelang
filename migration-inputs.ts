import { Smithers as S } from "@smthrs/targets"

// A glob remains scoped to its declaring package even with a // prefix, so
// S.glob("//.smithers/flows/migrate/...") in packages/PACKAGE.ts selects no
// files. This root-owned group holds the whole migrate flow (library,
// templates, tests and corpus) and the convert flow for the package tests that
// run or import them, so a new flow file needs no entry here or in packages/PACKAGE.ts.
export const migrationSources = S.Filegroup({ srcs: [S.glob(".smithers/flows/migrate/**"), S.glob(".smithers/flows/convert/**"), S.glob("scripts/api-identity*.mjs"), S.file("scripts/testing/spec-path.mjs")] })
