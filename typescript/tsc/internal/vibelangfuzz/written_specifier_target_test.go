package vibelangfuzz

import (
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// Declaration spelling follows Chapter 1, while Chapter 7 keeps written
// TypeScript source imports within TypeScript's native substitutions.
const writtenSpecifierKeptQuote = "written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling."

func TestWrittenSpecifierMigratedTargetQuoted(t *testing.T) { requireWrittenSpecifierQuotes(t) }

func requireWrittenSpecifierQuotes(t testing.TB) {
	if !strings.Contains(SpecText("001-functions.md"), declarationThrowsContractQuote) {
		t.Fatal("Chapter 1 no longer states the generated callable contract")
	}
	for chapter, quote := range map[string]string{"001-functions.md": writtenSpecifierKeptQuote} {
		text, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// Native imports keep the TypeScript twin's declaration spelling. A stale
// written .ts import is unresolved after its target becomes VibeLang.
func TestWrittenSpecifierMigratedTarget(t *testing.T) {
	requireWrittenSpecifierQuotes(t)
	tsc := StockTypeScript(t)
	w := NewWorkspace(t)
	modes := []struct{ name, options string }{
		{"bundler-rewrite", `"module": "preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "rewriteRelativeImportExtensions": true`},
		{"nodenext", `"module": "nodenext", "moduleResolution": "nodenext", "rewriteRelativeImportExtensions": true`},
		{"bundler-declaration", `"module": "preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "emitDeclarationOnly": true`},
	}
	forms := []struct{ name, source string }{
		{"value", "import { value } from %s\nexport const copy = value\n"},
		{"inline-type", "import { type T, value } from %s\nexport const made: T = { n: value }\n"},
		{"type-only-specifier", "import { type T } from %s\nexport const take = (t: T): number => t.n\n"},
		{"import-type", "import type { T } from %s\nexport type U = T | undefined\n"},
		{"export-named", "export { value } from %s\n"},
		{"export-type", "export type { T } from %s\n"},
		{"import-type-node", "export type V = import(%s).T\n"},
	}
	target := "export type T = { readonly n: number }\nexport const value: number = 1\n"
	for _, mode := range modes {
		config := `{
  "compilerOptions": {
    "target": "ES2022", ` + mode.options + `, "strict": true, "skipLibCheck": true,
    "declaration": true, "outDir": "out", "rootDir": ".", "types": []
  }
}`
		emitsJS := !strings.Contains(mode.options, "emitDeclarationOnly")
		for _, written := range []string{".ts", ".js", ""} {
			if mode.name == "nodenext" && written == "" {
				continue
			}
			for _, targetExt := range []string{".vibe", ".ts"} {
				for _, importer := range []string{".vibe", ".ts"} {
					for _, form := range forms {
						name := fmt.Sprintf("%s/written%q/target%s/importer%s/%s", mode.name, written, targetExt, importer, form.name)
						t.Run(name, func(t *testing.T) {
							t.Parallel()
							source := fmt.Sprintf(form.source, "'./target"+written+"'")
							files := declarationModeFiles(mode.name, map[string]string{"main" + importer: source, "target" + targetExt: target})
							twinFiles := declarationModeFiles(mode.name, map[string]string{"main.ts": source, "target.ts": target})
							vibe, err := w.Compile(t.Context(), Project{Files: files, Config: config})
							if err != nil {
								t.Fatal(err)
							}
							if written == ".ts" && targetExt == ".vibe" {
								found := false
								for _, diagnostic := range vibe.Diagnostics {
									if diagnostic.Code() == 2307 {
										found = true
									}
								}
								if !found {
									t.Fatalf("stale native import must report TS2307: %v", vibe.Diagnostics)
								}
								return
							}
							if HasError(vibe.Diagnostics) {
								t.Fatalf("errors %v in main%s:\n%s", SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)), importer, source)
							}
							outputs := []string{"out/main.d.ts"}
							if emitsJS {
								outputs = append(outputs, "out/main.js")
							}
							dir, err := w.writeProject(Project{Files: twinFiles, Config: config})
							if err != nil {
								t.Fatal(err)
							}
							stock := stockDeclarations(t, tsc, dir, outputs...)
							wantDeclaration := stock[0]
							if importer == ".vibe" && form.name == "type-only-specifier" {
								// VIP-27 permits this one generated addition for the known
								// local arrow. Keep the actual stock twin unannotated.
								wantDeclaration = strings.Replace(wantDeclaration, "export declare const take:", "/** @throws {never} */\nexport declare const take:", 1)
							}
							if got := vibe.Outputs["out/main.d.ts"]; got != wantDeclaration {
								t.Errorf("main%s declares:\n%s\nstock tsc declares main.ts:\n%s\nfrom:\n%s", importer, got, stock[0], source)
							}
							if !emitsJS {
								return
							}
							got := vibe.Outputs["out/main.js"]
							if importer == ".ts" && got != stock[1] {
								t.Errorf("main.ts emits:\n%s\nstock tsc emits:\n%s", got, stock[1])
							}
							if a, b := relativeSpecifiers(got), relativeSpecifiers(stock[1]); !slices.Equal(a, b) {
								t.Errorf("main%s emits relative specifiers %q, stock tsc %q:\n%s", importer, a, b, got)
							}
						})
					}
				}
			}
		}
	}
}

var relativeSpecifierPattern = regexp.MustCompile(`(?:from\s*|import\s*\(\s*|import\s+)["'](\.\.?/[^"']*)["']`)

// relativeSpecifiers lists the relative module specifiers JavaScript text names.
func relativeSpecifiers(text string) []string {
	var specifiers []string
	for _, match := range relativeSpecifierPattern.FindAllStringSubmatch(text, -1) {
		specifiers = append(specifiers, match[1])
	}
	return specifiers
}
