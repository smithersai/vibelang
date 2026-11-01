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
// default. Under either of the other two, every other specifier stays as the
// source wrote it, ./plain.ts included, as tsc keeps it in the declaration of
// a .ts file." and "An import the declaration file adds ... takes the quotes
// of the file's first written import or export specifier".
//
// Oracle: for each setting × quote × written specifier × import form, a .vibe
// module's declaration equals, byte for byte, stock tsc's declaration of its
// .ts twin, which spells each ./leaf.vibe import as the setting does (and,
// under the default, a written ./plain.ts as ./plain.js, D365). Witnesses:
// Smithers' Bind.vibe declared "./Contribution.js" for "./Contribution.ts",
// opencode's "./runtime.vibe" declared "./runtime.js" for "./runtime", and
// foldkit's added import { Effect } from "effect" in single-quoted files
// (inbox/migrate-smithers.md, 2026-10-31).
func TestDeclarationImportStyleMatrix(t *testing.T) {
	tsc := StockTypeScript(t)
	w := NewWorkspace(t)
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
	for _, style := range styles {
		for _, quote := range quotes {
			for _, specifier := range specifiers {
				for _, form := range forms {
					name := fmt.Sprintf("%s/%s/%s/%s", style.name, map[string]string{`"`: "double", `'`: "single"}[quote], specifier.name, form.name)
					t.Run(name, func(t *testing.T) {
						t.Parallel()
						twinSpecifier := specifier.written
						switch {
						case specifier.vibe:
							twinSpecifier = "./leaf" + style.extension
						case style.name == ".js" && specifier.name == "ts":
							twinSpecifier = "./plain.js" // D365: the default declares a written .ts source by its output
						}
						source := fmt.Sprintf(form.source, quote+specifier.written+quote)
						twin := fmt.Sprintf(form.source, quote+twinSpecifier+quote)
						if form.name == "added-effect" {
							twin = "import { Effect } from " + quote + "effect" + quote + "\n" + strings.Replace(twin, "T!!", "Effect.Effect<T>", 1)
						}
						vibeFiles := map[string]string{"main.vibe": source, "leaf.vibe": leaf, "plain.ts": leaf}
						twinFiles := map[string]string{"main.ts": twin, "leaf.ts": leaf, "plain.ts": leaf}
						cfg := declarationStyleConfig(style.name)
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
// VibeLang module the file never imports by that name,
// import("../schema/index.vibe").MessageUnion, is spelled as
// vibelang.declarationImportStyle spells a written import, in a .ts file's
// declaration as in a .vibe file's.
//
// Oracle: for each setting × importer quote × importer spelling, a .ts file
// that imports the .vibe module declares what stock tsc declares for the
// project whose schema/index.vibe is schema/index.ts, because the type reuses
// the file's written specifier, which stays as written. A .ts file that
// reaches the module only through the first does too, unless it writes .ts:
// then the specifier generator names the module ./x.vibe and the setting
// spells it, under the default, ".js", as index.js, as D365 declares a written
// ./x.ts. A .vibe importer that writes ./x.vibe declares the setting's spelling
// either way. Witnesses: foldkit's experimental/query/keyedQuery.d.ts printed
// import("../../schema/index.js") where the baseline printed index.ts
// (foldkit-92), and 14 Smithers declarations printed import("./StdError.js")
// for import("./StdError.ts") (pass3/dtsdiff, packages/smithers/agent/std).
func TestDeclarationImportStyleInferredImportType(t *testing.T) {
	tsc := StockTypeScript(t)
	w := NewWorkspace(t)
	schema := "export type MessageUnion<A> = { readonly _tag: \"m\"; readonly value: A }\nexport const makeMessage = <A>(value: A): MessageUnion<A> => ({ _tag: \"m\", value })\n"
	for _, style := range []string{".js", "extensionless", ".ts"} {
		for _, quote := range []string{`"`, `'`} {
			for _, spelling := range []string{".ts", ".js", ""} {
				name := fmt.Sprintf("%s/%s/%q", style, map[string]string{`"`: "double", `'`: "single"}[quote], spelling)
				t.Run(name, func(t *testing.T) {
					t.Parallel()
					files := func(schemaFile string) map[string]string {
						return map[string]string{
							schemaFile:            schema,
							"query/other.ts":      "export const other = 1\n",
							"query/keyedQuery.ts": "import { makeMessage } from " + quote + "../schema/index" + spelling + quote + "\nimport { other } from " + quote + "./other" + spelling + quote + "\nexport const makeKeyed = <A>(a: A) => makeMessage({ a, other })\n",
							"query/indirect.ts":   "import { makeKeyed } from " + quote + "./keyedQuery" + spelling + quote + "\nexport const wrap = <A>(a: A) => makeKeyed(a)\n",
						}
					}
					cfg := declarationStyleConfig(style)
					vibe, err := w.Compile(t.Context(), Project{Files: files("schema/index.vibe"), Config: cfg})
					if err != nil {
						t.Fatal(err)
					}
					if HasError(vibe.Diagnostics) {
						t.Fatalf("the .vibe project has errors: %v", SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)))
					}
					twin, err := w.writeProject(Project{Files: files("schema/index.ts"), Config: cfg})
					if err != nil {
						t.Fatal(err)
					}
					stock := stockDeclarations(t, tsc, twin, "out/query/keyedQuery.d.ts", "out/query/indirect.d.ts")
					for i, output := range []string{"out/query/keyedQuery.d.ts", "out/query/indirect.d.ts"} {
						want := stock[i]
						if output == "out/query/indirect.d.ts" && spelling == ".ts" {
							want = strings.ReplaceAll(want, `import("../schema/index.ts")`, `import("../schema/index`+declarationStyleExtension(style)+`")`)
						}
						if got := vibe.Outputs[output]; got != want {
							t.Errorf("%s declares:\n%s\nwant, from stock tsc with schema/index.ts:\n%s", output, got, want)
						}
					}
				})
			}
			// The Smithers shape: migrated importers, which write ./x.vibe.
			t.Run(fmt.Sprintf("%s/%s/vibe-importers", style, map[string]string{`"`: "double", `'`: "single"}[quote]), func(t *testing.T) {
				t.Parallel()
				vibe, err := w.Compile(t.Context(), Project{Files: map[string]string{
					"schema/index.vibe":     schema,
					"query/other.ts":        "export const other = 1\n",
					"query/keyedQuery.vibe": "import { makeMessage } from " + quote + "../schema/index.vibe" + quote + "\nimport { other } from " + quote + "./other.ts" + quote + "\nexport const makeKeyed = <A>(a: A) => makeMessage({ a, other })\n",
					"query/indirect.vibe":   "import { makeKeyed } from " + quote + "./keyedQuery.vibe" + quote + "\nexport const wrap = <A>(a: A) => makeKeyed(a)\n",
				}, Config: declarationStyleConfig(style)})
				if err != nil {
					t.Fatal(err)
				}
				if HasError(vibe.Diagnostics) {
					t.Fatalf("the .vibe project has errors: %v", SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)))
				}
				want := `import("../schema/index` + declarationStyleExtension(style) + `")`
				for _, output := range []string{"out/query/keyedQuery.d.ts", "out/query/indirect.d.ts"} {
					if got := vibe.Outputs[output]; !strings.Contains(got, want) {
						t.Errorf("%s does not name %s:\n%s", output, want, got)
					}
				}
			})
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

// declarationStyleConfig is the tsconfig of a declaration-only project under
// vibelang.declarationImportStyle style.
func declarationStyleConfig(style string) string {
	vibelang := ""
	if style != ".js" {
		vibelang = fmt.Sprintf(",\n  \"vibelang\": { \"declarationImportStyle\": %q }", style)
	}
	return `{
  "compilerOptions": {
    "target": "ES2022", "module": "preserve", "moduleResolution": "bundler", "strict": true, "skipLibCheck": true,
    "allowImportingTsExtensions": true, "declaration": true, "emitDeclarationOnly": true, "outDir": "out", "rootDir": ".", "types": []
  }` + vibelang + "\n}"
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
