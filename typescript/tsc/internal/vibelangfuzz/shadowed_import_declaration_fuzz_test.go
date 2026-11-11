package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const shadowedImportDeclarationTarget = "FuzzShadowedImportDeclaration"
const shadowedImportDeclarationQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestShadowedImportDeclarationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), shadowedImportDeclarationQuote) {
		t.Fatalf("Chapter 1 no longer says %q", shadowedImportDeclarationQuote)
	}
}

// The namespace and its same-named interface are distinct symbols. Vary the
// import route, alias, container and whether the source uses type shorthand.
// Foreign inferred names must survive as raw stock TypeScript declarations.
func FuzzShadowedImportDeclaration(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"sqlclient", "httpclient", "option", "duration"} {
		f.Add(key, uint8(0))
	}
	f.Add("sqlclient", uint8(1))
	f.Add("sqlclient", uint8(34))
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestShadowedImportDeclarationQuoted(t)
		name, specifier, barrel, args := "SqlClient", "effect/sql/SqlClient", "effect/sql", ""
		switch key {
		case "httpclient":
			name, specifier, barrel = "HttpClient", "effect/http/HttpClient", "effect/http"
		case "option":
			name, specifier, barrel, args = "Option", "effect/Option", "effect", "<number>"
		case "duration":
			name, specifier, barrel = "Duration", "effect/Duration", "effect"
		default:
			key = "sqlclient"
		}
		binding := name
		if variant&1 != 0 {
			binding = "Client"
		}
		imported := name
		if binding != name {
			imported += " as " + binding
		}
		imports := fmt.Sprintf("import type { %s } from %q\n", imported, barrel)
		if variant&2 != 0 {
			imports = fmt.Sprintf("import type * as %s from %q\n", binding, specifier)
		}
		if variant&4 != 0 {
			imports = strings.Replace(imports, "import type", "import", 1)
		}
		typ := name + args
		shapes := []string{"{ $client: %s }", "{ readonly client?: %s }", "{ nested: [%s, string] }", "{ clients: ReadonlyArray<%s> }"}
		helper := fmt.Sprintf("import type { %s } from %q\nexport declare const plain: () => "+shapes[int(variant>>3)%len(shapes)]+"\n", name, specifier, typ)
		main := imports + "import { plain } from \"./helper.js\"\nconst plained = plain()\nexport type Plained = typeof plained\nexport type Named = " + binding + "." + typ + "\n"
		if variant&32 != 0 && binding == name {
			main += "export type Short = " + binding + "." + typ + "\n"
		}
		files := map[string]string{"main.ts": main, "helper.ts": helper}
		stock := Project{Files: files, Config: fmt.Sprintf(errorTwinConfig, "main.ts")}
		dir := emitDeclarationIdentityStock(t, w, tsc, stock)
		defer os.RemoveAll(dir)
		delete(files, "main.ts")
		files["main.vibe"] = main
		// Source shorthand must not make foreign bare names safe to transplant.
		if variant&32 != 0 && binding == name {
			files["main.vibe"] = strings.Replace(main, "export type Short = "+binding+"."+typ, "export type Short = "+binding+args, 1)
		}
		candidate, err := w.CompileOrdered(t.Context(), Project{Files: files, Config: fmt.Sprintf(errorTwinConfig, "main.vibe")}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer candidate.Remove()
		gap := fmt.Sprintf("%s:%d", key, variant)
		if HasError(candidate.Diagnostics) {
			Gap(t, shadowedImportDeclarationTarget, gap, "source rejected: %v\n%s", SortedKeys(Keys(candidate.Dir, candidate.Diagnostics)), Archive(files))
			return
		}
		for _, module := range []string{"main", "helper"} {
			want, err := os.ReadFile(filepath.Join(dir, "__identity_out", module+".d.ts"))
			if err != nil {
				t.Fatal(err)
			}
			got, ok := candidate.Outputs["__identity_out/"+module+".d.ts"]
			if !ok {
				t.Fatal("missing declaration for", module)
			}
			if got != string(want) {
				Gap(t, shadowedImportDeclarationTarget, gap, "%s: %s\nstock TypeScript:\n%s\nVibeLang:\n%s\n%s", shadowedImportDeclarationQuote, module, want, got, Archive(files))
			}
		}
		ExpectPending(t, shadowedImportDeclarationTarget, gap)
	})
}
