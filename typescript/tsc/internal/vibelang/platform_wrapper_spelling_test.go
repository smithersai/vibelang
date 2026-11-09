package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestPlatformWrapperSpelling(t *testing.T) {
	wrappers := []struct{ key, template string }{
		{"try", "Effect.try(() => %s)"},
		{"try-options", "Effect.try({try: () => %s, catch: (error: unknown) => error})"},
		{"try-promise", "Effect.tryPromise(() => Promise.resolve(%s))"},
		{"try-promise-options", "Effect.tryPromise({try: () => Promise.resolve(%s), catch: (error: unknown) => error})"},
		{"global-try-promise", "tryPromise(() => Promise.resolve(%s))"},
		{"sync", "sync(() => %s)"},
		{"qualified-sync", "Effect.sync(() => %s)"},
		{"callback", "Effect.callback(() => { void %s; })"},
	}
	for _, wrapper := range wrappers {
		for _, ext := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
			for _, row := range []struct {
				key, name, typo string
				allowed         bool
			}{
				{"listed", "setTimeout", "setTimeuot", false},
				{"unlisted", "status", "statuz", false},
				{"constructor", "MutationObserver", "MutatonObserver", false},
				{"pure", "TextEncoder", "TextEnocder", true},
				{"local", "status", "statuz", true},
				{"erased", "status", "statuz", true},
			} {
				t.Run(wrapper.key+"/"+ext+"/"+row.key, func(t *testing.T) {
					files := computedKeyFiles(false)
					delete(files, "/workspace/x/src/main.vibe")
					files["/workspace/x/src/node_modules/effect/Effect.d.ts"] += `
     declare function attempt<A>(body: (() => A) | { try: () => A; catch: (error: unknown) => unknown }): Effect<A>;
     export { attempt as try };
     export declare function tryPromise<A>(body: (() => PromiseLike<A>) | { try: () => PromiseLike<A>; catch: (error: unknown) => unknown }): Effect<A>;
     export declare function sync<A>(body: () => A): Effect<A>;
     export declare function callback(body: () => void): Effect<void>;
     `
					files["/workspace/x/src/node_modules/vibelang-runtime/index.d.ts"] += "\nexport { sync } from \"effect/Effect\";\n"
					expression := row.typo
					if row.key == "erased" {
						expression = "(() => { type Held = typeof " + row.typo + "; return 1; })()"
					}
					source := `import * as Effect from "effect/Effect"; import {sync, tryPromise} from "effect/Effect"; `
					// Keep the bare native functions implicit in VibeLang so the legacy
					// callback context is exercised; TypeScript needs explicit imports.
					if ext == ".vibe" || ext == ".vibex" {
						source = `import * as Effect from "effect/Effect"; `
					}
					if row.key == "local" {
						source += "const status = 1; "
					}
					source += "export const value = " + fmt.Sprintf(wrapper.template, expression)
					files["/workspace/x/src/main"+ext] = source
					files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"skipLibCheck":true,"target":"ESNext","module":"NodeNext","types":[],"lib":["ESNext","DOM"]},"files":["main` + ext + `"]}`
					ds := computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil)
					want := int32(2304)
					if row.allowed || ext == ".ts" || ext == ".tsx" {
						want = 2552
					}
					if len(ds) != 1 || ds[0].Source() != "" || ds[0].Code() != want || ds[0].Category() != errorCategory {
						t.Fatalf("want native TS%d, got %v; source=%s", want, ds, source)
					}
					d := ds[0]
					if d.File().Text()[d.Pos():d.End()] != row.typo {
						t.Errorf("typo span changed: %s", d.String())
					}
					if want == 2552 && !strings.Contains(d.String(), "Did you mean '"+row.name+"'") {
						t.Errorf("native suggestion missing: %s", d.String())
					}
				})
			}
		}
	}
}
