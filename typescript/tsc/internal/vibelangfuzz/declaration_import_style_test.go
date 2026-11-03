package vibelangfuzz

import (
	"context"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// TestDeclarationImportStyleMatrix enforces Chapter 1,
// docs/design/src/001-functions.md, Declaration output, Specifiers: "A
// package whose sources spell relative imports another way keeps that
// spelling with the project setting vibelang.declarationImportStyle:
// "extensionless" declares ./user, ".ts" declares ./user.ts, and ".js" is the
// default. Every other specifier stays as the source wrote it, ./plain.ts
// included, under every setting, as tsc keeps it in the declaration of a .ts
// file." (detail 263) and "An import the declaration file adds ... takes the
// quotes of the file's first written import or export specifier".
//
// Oracle: for each module mode × setting × quote × written specifier × import
// form, a .vibe module's declaration equals, byte for byte, stock tsc's
// declaration of its untouched .ts twin, which writes each ./leaf.vibe import
// in the setting's spelling and every other specifier as the .vibe file does.
// Module nodenext has no extensionless relative import, so it skips those
// cells. Witnesses:
// Smithers' Bind.vibe declared "./Contribution.js" for "./Contribution.ts",
// opencode's "./runtime.vibe" declared "./runtime.js" for "./runtime", and
// foldkit's added import { Effect } from "effect" in single-quoted files
// (inbox/migrate-smithers.md, 2026-10-31).
// Chapter 007 / public declaration styles and compatibility sidecar scope: docs/design/src/007-tooling.md#56e3469cde8b8996
func TestDeclarationImportStyleMatrix(t *testing.T) {
	tsc := StockTypeScript(t)
	w := NewWorkspace(t)
	modes := []string{"bundler", "nodenext"}
	styles := []struct{ name, extension string }{{".js", ".js"}, {"extensionless", ""}, {".ts", ".ts"}}
	quotes := []string{`"`, `'`}
	// Each written specifier: the .vibe source's text, and the twin's under each style extension.
	specifiers := []struct {
		name    string
		written string
		vibe    bool
	}{
		{"vibe", "./leaf.vibe", true},
		{"extensionless", "./plain", false},
		{"js", "./plain.js", false},
		{"ts", "./plain.ts", false},
	}
	forms := []struct{ name, source string }{
		{"export-star", "export * from %s\n"},
		{"export-star-as", "export * as N from %s\n"},
		{"import-type", "import type { T } from %s\nexport type U = T | undefined\n"},
		{"export-named", "export { value } from %s\n"},
		{"import-type-node", "export type V = import(%s).T\n"},
		{"inferred", "import { make } from %s\nexport const made = make\n"},
		{"added-effect", "import type { T } from %s\nexport type W = T!!\n"},
	}
	leaf := "export type T = { readonly n: number }\nexport const value: number = 1\nexport const make = (): T => ({ n: value })\n"
	for _, mode := range modes {
		for _, style := range styles {
			for _, quote := range quotes {
				for _, specifier := range specifiers {
					for _, form := range forms {
						if mode == "nodenext" && (style.name == "extensionless" || specifier.name == "extensionless") {
							continue
						}
						name := fmt.Sprintf("%s/%s/%s/%s/%s", mode, style.name, map[string]string{`"`: "double", `'`: "single"}[quote], specifier.name, form.name)
						t.Run(name, func(t *testing.T) {
							t.Parallel()
							twinSpecifier := specifier.written
							if specifier.vibe {
								twinSpecifier = "./leaf" + style.extension
							}
							source := fmt.Sprintf(form.source, quote+specifier.written+quote)
							twin := fmt.Sprintf(form.source, quote+twinSpecifier+quote)
							if form.name == "added-effect" {
								twin = "import { Effect } from " + quote + "effect" + quote + "\n" + strings.Replace(twin, "T!!", "Effect.Effect<T>", 1)
							}
							vibeFiles := declarationModeFiles(mode, map[string]string{"main.vibe": source, "leaf.vibe": leaf, "plain.ts": leaf})
							twinFiles := declarationModeFiles(mode, map[string]string{"main.ts": twin, "leaf.ts": leaf, "plain.ts": leaf})
							cfg := declarationModeConfig(mode, style.name)
							vibe, err := w.Compile(t.Context(), Project{Files: vibeFiles, Config: cfg})
							if err != nil {
								t.Fatal(err)
							}
							if HasError(vibe.Diagnostics) {
								t.Fatalf("the .vibe project has errors: %v\n%s", SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)), source)
							}
							got := vibe.Outputs["out/main.d.ts"]
							want := stockDeclaration(t, w, tsc, Project{Files: twinFiles, Config: cfg}, "out/main.d.ts")
							if got != want {
								t.Errorf("main.vibe:\n%s\ndeclares:\n%s\nstock tsc declares main.ts:\n%s\nfrom:\n%s", source, got, want, twin)
							}
						})
					}
				}
			}
		}
	}
}

// stockDeclaration returns the declaration file stock tsc writes at name for project.
func stockDeclaration(t *testing.T, w *Workspace, tsc string, project Project, name string) string {
	t.Helper()
	dir, err := w.writeProject(project)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("stock tsc rejects the twin: %v\n%s", err, out)
	}
	text, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	return string(text)
}

// TestDeclarationImportStyleInferredImportType enforces Chapter 1,
// docs/design/src/001-functions.md, Declaration output, Specifiers, for the
// specifier the compiler writes itself: an inferred type that names a
// VibeLang module, import("../schema/index.ts").MessageUnion, is spelled as
// stock tsc spells it for the file's TypeScript twin. A specifier the file
// writes keeps the setting's spelling; one the compiler generates for a module
// the file never imports follows tsc's own choice for the twin, which under
// module nodenext with .ts imports allowed is .ts whatever the file writes.
//
// Oracle: raw byte equality, no normalization. For each module mode × setting
// × quote × spelling, the project whose importers are .ts files and whose
// schema/index is .vibe declares what stock tsc declares when schema/index is
// .ts; and the project whose importers are .vibe files writing ./x.vibe
// declares what stock tsc declares for their twins, which write each ./x.vibe
// in the setting's spelling (the spelling setup records, detail 263). The
// .vibe importers infer through constants, not arrows: an unannotated .vibe
// arrow is an effect function, whose declaration returns an Effect. Module
// nodenext has no extensionless relative import, so it skips those cells, and
// it skips .ts importers that write ../schema/index.ts, which report TS2876
// under rewriteRelativeImportExtensions (inbox/migrate-alchemy.md, not
// declaration spelling).
// Witnesses: foldkit's experimental/query/keyedQuery.ts, which writes
// '../../message/index.js' under module nodenext and
// rewriteRelativeImportExtensions, declared import("../../schema/index.js")
// where the baseline printed index.ts (foldkit-92, 2026-11-01T08:05Z), and 14
// Smithers declarations printed import("./StdError.js") for
// import("./StdError.ts") (pass3/dtsdiff, packages/smithers/agent/std).
func TestDeclarationImportStyleInferredImportType(t *testing.T) {
	tsc := StockTypeScript(t)
	w := NewWorkspace(t)
	schema := "export type MessageUnion<A> = { readonly _tag: \"m\"; readonly value: A }\nexport const makeMessage = <A>(value: A): MessageUnion<A> => ({ _tag: \"m\", value })\n"
	outputs := []string{"out/query/keyedQuery.d.ts", "out/query/indirect.d.ts", "out/query/viaMessage.d.ts"}
	for _, mode := range []string{"bundler", "nodenext"} {
		for _, style := range []string{".js", "extensionless", ".ts"} {
			for _, quote := range []string{`"`, `'`} {
				quoteName := map[string]string{`"`: "double", `'`: "single"}[quote]
				// files is the project whose schema/index is schemaFile and whose
				// importers have extension importer and write relative imports
				// with extension spelling. With constants, the importers infer
				// through constants instead of arrows.
				files := func(schemaFile, importer, spelling string, constants bool) map[string]string {
					q := func(specifier string) string { return quote + specifier + quote }
					bodies := []string{
						"export const makeKeyed = <A>(a: A) => makeMessage({ a, other })\n",
						"import { makeKeyed } from " + q("./keyedQuery"+spelling) + "\nexport const wrap = <A>(a: A) => makeKeyed(a)\n",
						"const make = <A>(a: A) => makeMessage({ a })\nexport type Made<A> = ReturnType<typeof make<A>>\nexport const made = <A>(a: A) => make(a)\n",
					}
					otherSpelling := spelling
					if constants {
						bodies = []string{
							"export const keyed = makeMessage({ a: 1, other })\n",
							"import { keyed } from " + q("./keyedQuery"+spelling) + "\nexport const wrapped = { keyed }\n",
							"export const made = makeMessage({ a: \"m\" })\n",
						}
						otherSpelling = declarationStyleExtension(style)
					}
					return declarationModeFiles(mode, map[string]string{
						schemaFile:                    schema,
						"query/other.ts":              "export const other = 1\n",
						"message/index" + importer:    "export { makeMessage } from " + q("../schema/index"+spelling) + "\nexport type { MessageUnion } from " + q("../schema/index"+spelling) + "\n",
						"query/keyedQuery" + importer: "import { makeMessage } from " + q("../schema/index"+spelling) + "\nimport { other } from " + q("./other"+otherSpelling) + "\n" + bodies[0],
						"query/indirect" + importer:   bodies[1],
						"query/viaMessage" + importer: "import { makeMessage } from " + q("../message/index"+spelling) + "\n" + bodies[2],
					})
				}
				check := func(t *testing.T, vibeFiles, twinFiles map[string]string) {
					cfg := declarationModeConfig(mode, style)
					vibe, err := w.Compile(t.Context(), Project{Files: vibeFiles, Config: cfg})
					if err != nil {
						t.Fatal(err)
					}
					if HasError(vibe.Diagnostics) {
						t.Fatalf("the .vibe project has errors: %v", SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)))
					}
					twin, err := w.writeProject(Project{Files: twinFiles, Config: cfg})
					if err != nil {
						t.Fatal(err)
					}
					stock := stockDeclarations(t, tsc, twin, outputs...)
					for i, output := range outputs {
						if got := vibe.Outputs[output]; got != stock[i] {
							t.Errorf("%s declares:\n%s\nwant, from stock tsc for the twin:\n%s", output, got, stock[i])
						}
					}
				}
				for _, spelling := range []string{".ts", ".js", ""} {
					if mode == "nodenext" && (spelling == "" || spelling == ".ts") {
						continue
					}
					t.Run(fmt.Sprintf("%s/%s/%s/ts-importers/%q", mode, style, quoteName, spelling), func(t *testing.T) {
						t.Parallel()
						check(t, files("schema/index.vibe", ".ts", spelling, false), files("schema/index.ts", ".ts", spelling, false))
					})
				}
				if mode == "nodenext" && style == "extensionless" {
					continue
				}
				// The Smithers shape: migrated importers, which write ./x.vibe.
				t.Run(fmt.Sprintf("%s/%s/%s/vibe-importers", mode, style, quoteName), func(t *testing.T) {
					t.Parallel()
					check(t, files("schema/index.vibe", ".vibe", ".vibe", true), files("schema/index.ts", ".ts", declarationStyleExtension(style), true))
				})
			}
		}
	}
}

// declarationStyleExtension is the extension a setting gives a relative
// import of a VibeLang module.
func declarationStyleExtension(style string) string {
	if style == "extensionless" {
		return ""
	}
	return style
}

// TestDeclarationEffectModuleImports enforces D311 and Chapter 1,
// docs/design/src/001-functions.md, Declaration output: a module type written
// by the name a file imports, HashSet<string> through
// import { HashSet } from 'effect', is declared HashSet.HashSet, and the names
// one written import binds stay one import, in its order and with its quotes,
// which an import the declaration adds (Effect for a T!!) joins, "An import
// the declaration file adds ... takes the quotes of the file's first written
// import or export specifier".
//
// Oracle: the declaration equals, byte for byte, stock tsc's declaration of
// the .ts twin that writes Effect in the same import and X.X for each module
// type. Witness: foldkit's devTools/store.d.ts printed one double-quoted
// import per name, import { HashMap } from "effect" and three more, where the
// baseline printed import { Effect, HashMap, HashSet, Option, SubscriptionRef }
// from 'effect' (foldkit-91).
func TestDeclarationEffectModuleImports(t *testing.T) {
	tsc := StockTypeScript(t)
	w := NewWorkspace(t)
	types := map[string]string{"HashMap": "HashMap<string, number>", "HashSet": "HashSet<string>", "Option": "Option<number>", "SubscriptionRef": "SubscriptionRef<number>"}
	// Each case: the written imports, one list of names per import statement.
	imports := map[string][][]string{
		"foldkit-store":   {{"Array as EffectArray", "HashMap", "HashSet", "Option", "pipe", "SubscriptionRef"}},
		"unsorted":        {{"Option", "HashSet", "pipe"}},
		"one":             {{"Option"}},
		"two-statements":  {{"Option", "pipe"}, {"HashSet"}},
		"value-and-types": {{"pipe", "HashMap"}},
	}
	for _, key := range slices.Sorted(maps.Keys(imports)) {
		for _, quotes := range [][]string{{`"`, `"`}, {`'`, `'`}, {`'`, `"`}} {
			for _, effect := range []bool{false, true} {
				name := fmt.Sprintf("%s/%s/effect=%t", key, map[string]string{`""`: "double", `''`: "single", `'"`: "mixed"}[quotes[0]+quotes[1]], effect)
				t.Run(name, func(t *testing.T) {
					t.Parallel()
					var source, twin, body, twinBody strings.Builder
					joined := false
					for i, names := range imports[key] {
						quote := quotes[i%len(quotes)]
						twinNames := slices.Clone(names)
						if effect && !joined {
							// An added name joins the file's first import of its module before the first name that sorts after it.
							at := slices.IndexFunc(twinNames, func(n string) bool { return n > "Effect" })
							if at < 0 {
								at = len(twinNames)
							}
							twinNames = slices.Insert(twinNames, at, "Effect")
							joined = true
						}
						fmt.Fprintf(&source, "import { %s } from %seffect%s\n", strings.Join(names, ", "), quote, quote)
						fmt.Fprintf(&twin, "import { %s } from %seffect%s\n", strings.Join(twinNames, ", "), quote, quote)
						for _, n := range names {
							switch {
							case types[n] != "":
								module, rest, _ := strings.Cut(types[n], "<")
								fmt.Fprintf(&body, "export type %sType = { readonly v: %s }\n", n, types[n])
								fmt.Fprintf(&twinBody, "export type %sType = { readonly v: %s.%s<%s }\n", n, module, module, rest)
							case n == "pipe":
								body.WriteString("export const piped: number = pipe(1, (n: number) => n + 1)\n")
								twinBody.WriteString("export const piped: number = pipe(1, (n: number) => n + 1)\n")
							default:
								body.WriteString("export const length: number = EffectArray.length([1])\n")
								twinBody.WriteString("export const length: number = EffectArray.length([1])\n")
							}
						}
					}
					if effect {
						body.WriteString("export type Program = number!!\n")
						twinBody.WriteString("export type Program = Effect.Effect<number>\n")
					}
					cfg := declarationStyleConfig(".js")
					vibe, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source.String() + body.String()}, Config: cfg})
					if err != nil {
						t.Fatal(err)
					}
					if HasError(vibe.Diagnostics) {
						t.Fatalf("the .vibe project has errors: %v\n%s", SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)), source.String()+body.String())
					}
					got := vibe.Outputs["out/main.d.ts"]
					want := stockDeclaration(t, w, tsc, Project{Files: map[string]string{"main.ts": twin.String() + twinBody.String()}, Config: cfg}, "out/main.d.ts")
					if got != want {
						t.Errorf("main.vibe:\n%s\ndeclares:\n%s\nstock tsc declares main.ts:\n%s\nfrom:\n%s", source.String()+body.String(), got, want, twin.String()+twinBody.String())
					}
				})
			}
		}
	}
}

// declarationStyleConfig is the tsconfig of a declaration-only bundler
// project under vibelang.declarationImportStyle style.
func declarationStyleConfig(style string) string {
	return declarationModeConfig("bundler", style)
}

// declarationModeConfig is the tsconfig of a declaration-only project under
// vibelang.declarationImportStyle style: "bundler" (module preserve,
// allowImportingTsExtensions) or "nodenext" (module nodenext,
// rewriteRelativeImportExtensions, foldkit's settings).
func declarationModeConfig(mode, style string) string {
	vibelang := ""
	if style != ".js" {
		vibelang = fmt.Sprintf(",\n  \"vibelang\": { \"declarationImportStyle\": %q }", style)
	}
	options := `"module": "preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true`
	if mode == "nodenext" {
		options = `"module": "nodenext", "moduleResolution": "nodenext", "rewriteRelativeImportExtensions": true`
	}
	return `{
  "compilerOptions": {
    "target": "ES2022", ` + options + `, "strict": true, "skipLibCheck": true,
    "declaration": true, "emitDeclarationOnly": true, "outDir": "out", "rootDir": ".", "types": []
  }` + vibelang + "\n}"
}

// declarationModeFiles adds the package.json a "nodenext" project needs for
// ES modules to files.
func declarationModeFiles(mode string, files map[string]string) map[string]string {
	if mode == "nodenext" {
		files["package.json"] = `{ "type": "module" }` + "\n"
	}
	return files
}

// stockDeclarations returns the declaration files stock tsc writes at names
// for the project already written to dir.
func stockDeclarations(t *testing.T, tsc string, dir string, names ...string) []string {
	t.Helper()
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("stock tsc rejects the twin: %v\n%s", err, out)
	}
	var texts []string
	for _, name := range names {
		text, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		texts = append(texts, string(text))
	}
	return texts
}
