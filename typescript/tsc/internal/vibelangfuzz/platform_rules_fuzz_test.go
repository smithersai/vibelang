package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Quotes come from chapter 5, not the implementation. Every forbidden value
// has an admitted control, including shadowing and erased type positions.
var platformRules = []struct {
	key, quote, good, bad string
	code                  int32
}{
	{"node-private", "Node's `module.builtinModules`", `import type {} from "_http_common"; export const n = 1`, `import "_http_common"; export const n = 1`, 4402},
	{"import-meta", "`import.meta` may appear only as the object of `.url`", `export const url = import.meta.url`, `export const meta = import.meta`, 4402},
	{"global-this-alias", "an alias (`const g = globalThis`)", `export const value = globalThis.URL`, `export const value = globalThis`, 107},
	{"global-this-dynamic", "a computed key (`globalThis[k]`)", `export const value = globalThis["URL"]`, `const k: string = "URL"; export const value = globalThis[k]`, 107},
	{"data-import", "a `data:` or `blob:` specifier is `EK0107`", `const s: string = "data:text/javascript,export default 1"; export const load = () => import(s)`, `import "data:text/javascript,export default 1"`, 107},
	{"blob-import", "a `data:` or `blob:` specifier is `EK0107`", `const s: string = "blob:fixture"; export const load = () => import(s)`, `import "blob:fixture"`, 107},
	{"preserved-type-import", "`import { type Stats } from \"node:fs\"` is `EK4402`", `import type { Stats } from "node:fs"; export type Stat = Stats`, `import { type Stats } from "node:fs"; export type Stat = Stats`, 4402},
	{"global-this-host", "a statically named member of the standard `globalThis` whose name is banned is `EK4402`", `const client = { fetch: 7 }; export const value = client.fetch`, `export const value = globalThis["fetch"]`, 4402},
	{"host-declaration", "It also includes every other host global", `const FileReader = 7; export const value = FileReader`, `export const value = FileReader`, 4402},
	{"unresolved-host", "with no host library in the program, `fetch` is `TS2304`, not `EK4402`", `export const value = 7`, `export const value = fetch`, 2304},
	{"constructor-key", "an alias keeps the symbol it copies", `const Signals = { timeout: 7 }; export const value = Signals.timeout`, `const Signals = globalThis["AbortSignal"]; export const value = Signals.timeout`, 4402},
	{"constructor-augmentation", "The compiler reads the declarations themselves.", `const Signals = { timeout: 7 }; export const value = Signals.timeout`, `export const value = AbortSignal.timeout`, 4402},
}

func platformRulesQuoted(t testing.TB) {
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range platformRules {
		if !strings.Contains(string(chapter), rule.quote) {
			t.Errorf("%s: chapter 5 no longer says %q", rule.key, rule.quote)
		}
	}
}

func TestPlatformRulesQuoted(t *testing.T) { platformRulesQuoted(t) }

func FuzzPlatformRules(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#60d730d242245568
	// Chapter 005: globalThis alias/dynamic escape, static URI imports and erased versus retained type imports (FuzzPlatformRules).

	// Spec rule: docs/design/src/005-services.md#33addb4d048cf828
	// Chapter 005: globalThis alias/dynamic escape, static URI imports and erased versus retained type imports (FuzzPlatformRules).

	// Spec rule: docs/design/src/005-services.md#7dc555df8fcbb070
	// Chapter 005: globalThis alias/dynamic escape, static URI imports and erased versus retained type imports (FuzzPlatformRules).

	// Spec rule: docs/design/src/005-services.md#94852939ca64f9e0
	// Chapter 005: globalThis alias/dynamic escape, static URI imports and erased versus retained type imports (FuzzPlatformRules).

	// Spec rule: docs/design/src/005-services.md#a4518740568e7484
	// Chapter 005: globalThis static banned member reaches the host (FuzzPlatformRules).

	// Spec rule: docs/design/src/001-functions.md#cf0222e682982809
	// Chapter 001: literal/optional globalThis access controls and banned host members (FuzzPlatformRules).

	// Spec rule: docs/design/src/001-functions.md#37634ab0bc2343e6
	// Chapter 001: literal/optional globalThis access controls and banned host members (FuzzPlatformRules).

	startShortBudget(f)
	platformRulesQuoted(f)
	for _, rule := range platformRules {
		f.Add([]byte(rule.key))
		f.Add([]byte(rule.key + "\x00\x07"))
		f.Add([]byte(rule.key + "\x00\x3f"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		// A NUL suffix mutates the spelling without changing the saved key.
		parts := strings.SplitN(string(data), "\x00", 2)
		choice := 0
		if len(data) > 0 {
			choice = int(data[0]) % len(platformRules)
		}
		for i, rule := range platformRules {
			if parts[0] == rule.key {
				choice = i
				break
			}
		}
		rule := platformRules[choice]
		variant := byte(0)
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		good, bad := rule.good, rule.bad
		if variant&1 != 0 {
			good = "// retained trivia\n" + good
			bad = "// retained trivia\n" + bad
		}
		if variant&2 != 0 {
			good = strings.ReplaceAll(good, `"`, `'`)
			bad = strings.ReplaceAll(bad, `"`, `'`)
		}
		if rule.key == "global-this-host" || rule.key == "constructor-key" {
			for _, name := range []string{"fetch", "AbortSignal"} {
				for _, key := range []string{"[\"" + name + "\"]", "['" + name + "']"} {
					if variant&8 != 0 {
						bad = strings.ReplaceAll(bad, key, "[`"+name+"`]")
					} else if variant&4 != 0 {
						bad = strings.ReplaceAll(bad, key, "."+name)
					}
				}
			}
			if variant&16 != 0 {
				bad = strings.ReplaceAll(bad, "globalThis", "globalThis.globalThis")
			}
			if variant&32 != 0 {
				bad = strings.ReplaceAll(bad, "globalThis[", "globalThis?.[")
			}
		}
		lib := `["ES2022","DOM"]`
		if rule.key == "unresolved-host" {
			lib = `["ES2022"]`
		}
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"verbatimModuleSyntax":true,"noEmit":true,"types":[],"lib":` + lib + `}}`
		extra := `declare module "_http_common" {}
declare module "node:fs" { export interface Stats { size: number } }
declare module "data:*" {}
declare module "blob:*" {}
`
		if rule.key == "constructor-augmentation" {
			extra += "interface AbortSignalConstructor { readonly projectOnly?: number }\ndeclare var AbortSignal: AbortSignalConstructor;\n"
		}
		check := func(source string, want int32) {
			t.Helper()
			r, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{
				"main.vibe": source + "\n", "host.d.ts": extra,
				"package.json": `{"name":"platform-rules","type":"module"}`,
			}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			found, wrongPlatform := false, false
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				if d.Code() == want && (IsEK(d) == (want != 2304)) {
					found = true
				}
				if want == 2304 && IsEK(d) && d.Code() == 4402 {
					wrongPlatform = true
				}
			}
			key := "diagnostic:" + rule.key
			if want == 0 {
				key = "control:" + rule.key
				found = len(errors) == 0
			}
			if !found || wrongPlatform {
				Gap(t, "FuzzPlatformRules", key, "chapter 5: %s; want code %d, got:\n%s\nsource:\n%s", rule.quote, want, strings.Join(errors, "\n"), source)
				return
			}
			ExpectPending(t, "FuzzPlatformRules", key)
		}
		check(good, 0)
		check(bad, rule.code)
		ExpectPending(t, "FuzzPlatformRules", specCorpusKey(t))
	})
}
