package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
	config := func(style string) string {
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
							twin = "import { Effect } from " + quote + "effect" + quote + "\n" + strings.Replace(twin, "T!!", "Effect.Effect<T, never, never>", 1)
						}
						vibeFiles := map[string]string{"main.vibe": source, "leaf.vibe": leaf, "plain.ts": leaf}
						twinFiles := map[string]string{"main.ts": twin, "leaf.ts": leaf, "plain.ts": leaf}
						cfg := config(style.name)
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
