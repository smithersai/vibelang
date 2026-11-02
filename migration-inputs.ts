import { Smithers as S } from "@smthrs/targets"

// A glob remains scoped to its declaring package even with a // prefix, so
// S.glob("//.smithers/flows/migrate/...") in packages/PACKAGE.ts selects no
// files. This root-owned group holds the whole migrate flow (library,
// templates, tests and corpus) for the package tests that run or import it,
// so a new flow file needs no entry here or in packages/PACKAGE.ts.
export const migrationSources = S.Filegroup({ srcs: [S.glob(".smithers/flows/migrate/**")] })
