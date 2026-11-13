package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// VIP-30: ordinary .ts and .js files keep TypeScript's moduleDetection.
// The oracle is stock tsc 7.1.0-beta's result for the same two-file
// projects: a top-level binding is shared between scripts and private to
// modules, so b reports TS2304 exactly when the files are modules. That is
// "force", or "auto" under NodeNext in a "type": "module" package.
func TestNativeModuleDetectionMeaning(t *testing.T) {
	w := NewWorkspace(t)
	for _, ext := range []string{"ts", "js"} {
		for _, detection := range []string{"legacy", "auto", "force"} {
			for _, resolution := range []string{"Bundler", "NodeNext"} {
				for _, pkg := range []string{"commonjs", "module"} {
					for mask := 0; mask < 4; mask++ {
						name := fmt.Sprintf("%s/%s/%s/%s/prelude%d", ext, detection, resolution, pkg, mask)
						t.Run(name, func(t *testing.T) {
							module := map[string]string{"Bundler": "ESNext", "NodeNext": "NodeNext"}[resolution]
							options := map[string]any{"target": "ES2022", "module": module, "moduleResolution": resolution, "moduleDetection": detection, "strict": true, "skipLibCheck": true, "types": []string{}, "noEmit": true, "allowJs": true, "checkJs": true}
							a, b := "a."+ext, "b."+ext
							config, err := json.Marshal(map[string]any{"compilerOptions": options, "vibe": map[string]any{"effectGlobals": mask&1 != 0, "effectModules": mask&2 != 0}, "files": []string{a, b}})
							if err != nil {
								t.Fatal(err)
							}
							result, err := w.Compile(context.Background(), Project{Files: map[string]string{a: "const policySecret = 1\n", b: "const reader = policySecret\n", "package.json": `{"type":"` + pkg + `"}`}, Config: string(config)})
							if err != nil {
								t.Fatal(err)
							}
							defer result.Remove()
							modules := detection == "force" || detection == "auto" && resolution == "NodeNext" && pkg == "module"
							want := []string{}
							if modules {
								want = []string{"TS2304"}
							}
							// rule-evidence: docs/design/vips/0030-config-files.md#620eaee7d226e458 | **Amendment: source module classification.** `moduleDetection` keeps its ordinary meaning for `.ts` and `.js`.
							if got := vibexNativeCodes(result); !slices.Equal(got, want) {
								t.Fatalf("diagnostics %v, want stock TypeScript's %v", got, want)
							}
							for _, file := range result.Program.SourceFiles() {
								base := filepath.Base(file.FileName().AsString())
								if (base == a || base == b) && (file.ExternalModuleIndicator != nil) != modules {
									t.Fatalf("%s module=%v, want %v", base, file.ExternalModuleIndicator != nil, modules)
								}
							}
						})
					}
				}
			}
		}
	}
}

// VIP-30 rejects interim severity keys independently of whether a transitional
// compiler still emits their diagnostics. Invalid entries leave all other
// diagnostics unchanged, including their severity and source range.
func TestInterimSeverityEntriesQuoted(t *testing.T) {
	quote := "Interim `EK92xx` codes are not configurable through `vibe.severities`, even when printed as warnings; an entry is `EK3006`."
	if !strings.Contains(SpecText("../vips/0030-config-files.md"), quote) {
		t.Fatalf("VIP-30 no longer says %q", quote)
	}
}

func TestInterimSeverityEntriesRejected(t *testing.T) {
	TestInterimSeverityEntriesQuoted(t)
	w := NewWorkspace(t)
	source := "export effect function main() { return Effect.succeed(2) catch (e) => 0 }\n"
	for _, extra := range []string{"", "export const invalid: number = \"text\";\n"} {
		compile := func(entry string) *Result {
			config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"vibe":{` + entry + `},"files":["main.vibe"]}`
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source + extra, "package.json": `{"type":"module"}`}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			return result
		}
		keys := func(result *Result, code string) []string {
			var got []string
			rejected := 0
			for _, diagnostic := range result.Diagnostics {
				if IsEK(diagnostic) && diagnostic.Code() == 3006 {
					rejected++
					if code == "" || diagnostic.Category().Name() != "error" || diagnostic.File() == nil ||
						diagnostic.File().Text()[diagnostic.Pos():diagnostic.End()] != `"`+code+`"` {
						t.Fatalf("wrong EK3006: %s", diagnostic.String())
					}
					continue
				}
				file := ""
				if diagnostic.File() != nil {
					file = filepath.Base(diagnostic.File().FileName().AsString())
				}
				got = append(got, fmt.Sprintf("%s:%s:%d:%s:%d:%d:%s", file, diagnostic.Source(),
					diagnostic.Code(), diagnostic.Category().Name(), diagnostic.Pos(), diagnostic.End(), diagnostic.MessageText()))
			}
			want := 1
			if code == "" {
				want = 0
			}
			if rejected != want {
				t.Fatalf("EK3006=%d, want %d: %v", rejected, want, diagnosticTexts(result.Diagnostics))
			}
			slices.Sort(got)
			return got
		}
		baseline := compile("")
		wantCodes := []string{}
		if extra != "" {
			wantCodes = []string{"TS2322"}
		}
		if got := vibexNativeCodes(baseline); !slices.Equal(got, wantCodes) {
			t.Fatalf("witness requires an admitted catch expression and only the deliberate type error: %v", got)
		}
		want := keys(baseline, "")
		for _, code := range []string{"EK9204", "EK9201"} {
			for _, severity := range []string{"error", "warning", "suggestion", "off"} {
				t.Run(fmt.Sprintf("%s/%s/type-error=%v", code, severity, extra != ""), func(t *testing.T) {
					result := compile(`"severities":{"` + code + `":"` + severity + `"}`)
					if got := keys(result, code); !slices.Equal(got, want) {
						t.Fatalf("rejected entry changed diagnostics: got %v, without entry %v", got, want)
					}
				})
			}
		}
	}
}

// VIP-30: the retired declarationImportStyle has no effect. Every value at
// either historical path emits the bytes of the project without it, and the
// only added diagnostic is the EK3011 warning.
func TestRetiredDeclarationImportStyleChangesNothing(t *testing.T) {
	w := NewWorkspace(t)
	files := map[string]string{
		"main.vibe": "export { value } from \"./leaf.js\"\nimport type { T } from \"./plain\"\nexport type U = T | undefined\nexport const made = (): T => ({ n: 1 })\n",
		"leaf.vibe": "export const value: number = 1\n",
		"plain.ts":  "export type T = { readonly n: number }\n",
	}
	options := `"compilerOptions":{"target":"ES2022","module":"preserve","moduleResolution":"bundler","strict":true,"skipLibCheck":true,"declaration":true,"outDir":"out","rootDir":".","types":[]`
	compile := func(t *testing.T, retired string) (*Result, []string) {
		config := `{` + options + `}` + retired + `,"files":["main.vibe","leaf.vibe","plain.ts"]}`
		if strings.HasPrefix(retired, "@") {
			config = `{` + options + `,"vibelang":{"declarationImportStyle":` + retired[1:] + `}},"files":["main.vibe","leaf.vibe","plain.ts"]}`
		}
		result, err := w.Compile(context.Background(), Project{Files: maps.Clone(files), Config: config})
		if err != nil {
			t.Fatal(err)
		}
		var keys []string
		for _, d := range result.Diagnostics {
			keys = append(keys, fmt.Sprintf("%v:%d:%s", IsEK(d), d.Code(), d.Category().Name()))
		}
		slices.Sort(keys)
		return result, keys
	}
	baseline, baseKeys := compile(t, "")
	defer baseline.Remove()
	if len(baseKeys) != 0 || baseline.Outputs["out/main.d.ts"] == "" || baseline.Outputs["out/main.js"] == "" {
		t.Fatalf("baseline: %v %v", baseKeys, slices.Sorted(maps.Keys(baseline.Outputs)))
	}
	for _, value := range []string{`".js"`, `"extensionless"`, `".ts"`, `"invalid"`, `42`, `null`, `{}`} {
		for _, place := range []string{"root", "compilerOptions"} {
			t.Run(place+"/"+value, func(t *testing.T) {
				retired := `,"vibelang":{"declarationImportStyle":` + value + `}`
				if place == "compilerOptions" {
					retired = "@" + value
				}
				result, keys := compile(t, retired)
				defer result.Remove()
				// rule-evidence: docs/design/vips/0030-config-files.md#af110eae679bbb0b | **Amended 2026-11-03: declaration import spelling follows TypeScript.** There is no `declarationImportStyle` setting.
				if !slices.Equal(keys, []string{"true:3011:warning"}) {
					t.Fatalf("diagnostics %v, want only the EK3011 warning", keys)
				}
				for _, name := range slices.Sorted(maps.Keys(baseline.Outputs)) {
					if result.Outputs[name] != baseline.Outputs[name] {
						t.Fatalf("%s changed:\n%s\nwithout the setting:\n%s", name, result.Outputs[name], baseline.Outputs[name])
					}
				}
				if len(result.Outputs) != len(baseline.Outputs) {
					t.Fatalf("outputs %v, want %v", slices.Sorted(maps.Keys(result.Outputs)), slices.Sorted(maps.Keys(baseline.Outputs)))
				}
			})
		}
	}
}
