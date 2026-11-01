package vibelang

import (
	"strings"
	"testing"
)

// A .ts module whose declaration copies a type that a .vibe module writes in
// the ! form declares it as Effect TypeScript writes it: Effect's E and R
// default to never, so the slots the source leaves empty stay out of the
// importer's declaration, as they stay out of the .vibe module's own sidecar
// (emptySlots). t3code's provider-muse textGeneration.ts and GitVcsDriver.ts
// printed Effect.Effect<A, E, never> after their dependency became .vibe
// (drive-t3code 2026-11-01T19:55Z, drive-t3code-server 21:34Z).
func TestImporterDeclarationOmitsEmptyBangSlots(t *testing.T) {
	t.Parallel()
	types := []struct{ name, bang, native string }{
		{"result only", "string!!", "Effect.Effect<string>"},
		{"error", "string!Error", "Effect.Effect<string, Error>"},
		{"error and empty requirement", "string!Error!", "Effect.Effect<string, Error>"},
		{"written never requirement", "string!Error!never", "Effect.Effect<string, Error, never>"},
		{"written never error", "string!never", "Effect.Effect<string, never>"},
		{"written requirement", "string!!Error", "Effect.Effect<string, never, Error>"},
		{"nested", "Array<number!!>!Error", "Effect.Effect<Array<Effect.Effect<number>>, Error>"},
	}
	importers := map[string]string{
		"object": "export const muse = { generate: core.generate }\n",
		"direct": "export const generate = core.generate\n",
		"method": "export const muse = { generate(input: string) { return core.generate(input) } }\n",
	}
	for _, ty := range types {
		for form, importer := range importers {
			t.Run(ty.name+"/"+form, func(t *testing.T) {
				t.Parallel()
				main := "import type { Provider } from \"./core.js\"\ndeclare const core: Provider\n" + importer
				declare := func(extension, written string) string {
					files := computedKeyFiles(false)
					dir := projectDir(files)
					files[dir+"core."+extension] = "import type * as Effect from \"effect/Effect\"\nexport interface Provider { readonly generate: (input: string) => " + written + " }\n"
					files[dir+"main.ts"] = main
					files[dir+"tsconfig.json"] = strings.Replace(files[dir+"tsconfig.json"], `"files":["main.vibe"]`, `"files":["main.ts","core.`+extension+`"]`, 1)
					dts, codes := emitWith(t, files)
					if len(codes) != 0 {
						t.Fatalf("core.%s: emit reports %v", extension, codes)
					}
					return dts
				}
				want := declare("ts", ty.native)
				if got := declare("vibe", ty.bang); got != want {
					t.Fatalf("main.d.ts with core.vibe writing %s:\n%s\nwith core.ts writing %s:\n%s", ty.bang, got, ty.native, want)
				}
			})
		}
	}
}

// The parser reparses JSDoc types too; a JavaScript module's written never
// stays in its importer's declaration.
func TestImporterDeclarationKeepsJSDocNever(t *testing.T) {
	t.Parallel()
	files := computedKeyFiles(false)
	dir := projectDir(files)
	files[dir+"core.js"] = "/** @typedef {{ readonly generate: (input: string) => import(\"effect/Effect\").Effect<string, Error, never> }} Provider */\nexport {}\n"
	files[dir+"main.ts"] = "import type { Provider } from \"./core.js\"\ndeclare const core: Provider\nexport const generate = core.generate\n"
	files[dir+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true,"allowJs":true,"checkJs":true,"outDir":"out"},"files":["main.ts","core.js"]}`
	dts, codes := emitWith(t, files)
	if len(codes) != 0 {
		t.Fatalf("emit reports %v", codes)
	}
	if !strings.Contains(dts, "Effect<string, Error, never>") {
		t.Fatalf("main.d.ts drops the JSDoc type's written never:\n%s", dts)
	}
}
