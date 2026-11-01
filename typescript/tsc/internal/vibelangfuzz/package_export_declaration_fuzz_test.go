package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Chapter 1, VIP-27. Naming a workspace source through its package export
// must preserve the module name of its idiomatic TypeScript declaration.
const packageExportDeclarationQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestPackageExportDeclarationQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), packageExportDeclarationQuote) {
		t.Fatalf("missing quoted rule: %s", packageExportDeclarationQuote)
	}
}

func FuzzPackageExportDeclaration(f *testing.F) {
	startShortBudget(f)
	requirePackageExportDeclarationQuote(f)
	w := NewWorkspace(f)
	for _, key := range []string{"exact", "pattern", "root", "nested", "array", "types-only", "source-only"} {
		f.Add(key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		module := []string{"x", "provider", "skill"}[int(variant)%3]
		subpath, target := "./"+module, module
		switch key {
		case "pattern":
			subpath, target = "./*", "*"
		case "root":
			subpath = "."
		case "exact", "nested", "array", "types-only", "source-only":
		default:
			return
		}
		fields := fmt.Sprintf("\"types\":\"./src/%s.d.vibe.ts\",\"vibelang-source\":\"./src/%s.vibe\",\"default\":\"./.vibelang/js/src/%s.js\"", target, target, target)
		if key == "types-only" {
			fields = fmt.Sprintf("\"types\":\"./src/%s.d.vibe.ts\"", target)
		}
		if key == "source-only" {
			fields = fmt.Sprintf("\"vibelang-source\":\"./src/%s.vibe\"", target)
		}
		entry := "{" + fields + "}"
		if key == "nested" {
			entry = "{\"import\":" + entry + "}"
		}
		if key == "array" {
			entry = "[" + entry + "]"
		}
		specifier := "lib/" + module
		if key == "root" {
			specifier = "lib"
		}
		p := Project{Files: map[string]string{
			"lib/package.json":                 fmt.Sprintf("{\"name\":\"lib\",\"type\":\"module\",\"exports\":{%q:%s}}", subpath, entry),
			"lib/src/" + module + ".vibe":      "class ProviderNode<A> { readonly a?: A }\nexport type Provider<A> = ProviderNode<A>\nexport const make = <A>(a: A): Provider<A> => new ProviderNode<A>()\n",
			"lib/src/" + module + ".d.vibe.ts": "declare class ProviderNode<A> { readonly a?: A }\nexport type Provider<A> = ProviderNode<A>\nexport declare const make: <A>(a: A) => Provider<A>\n",
			"app/package.json":                 "{\"type\":\"module\"}",
			"app/src/b.ts":                     fmt.Sprintf("import { make } from %q\nexport const wrap = <A>(a: A) => make(a)\n", specifier),
			"app/src/a.ts":                     "import { wrap } from \"./b.js\"\nexport const node = wrap(1)\n",
			"app/tsconfig.json":                "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"customConditions\":[\"vibelang-source\"],\"strict\":true,\"types\":[],\"skipLibCheck\":true,\"composite\":true,\"declaration\":true,\"outDir\":\"dist\"},\"vibe\":{\"effectGlobals\":false,\"effectModules\":false},\"include\":[\"src\"]}",
		}}
		dir, err := w.writeProject(p)
		if err != nil {
			t.Fatal(err)
		}
		modules := filepath.Join(dir, "app", "node_modules")
		if err := os.MkdirAll(modules, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(dir, "lib"), filepath.Join(modules, "lib")); err != nil {
			t.Fatal(err)
		}
		result := w.CompileIn(t.Context(), filepath.Join(dir, "app"), p, OrderTsc, true)
		gapKey := fmt.Sprintf("%s/%s", key, module)
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzPackageExportDeclaration", gapKey, "declaration diagnostic TS%d: %v", d.Code(), d)
			}
		}
		want := fmt.Sprintf("import(%q).Provider<number>", specifier)
		for name, text := range result.Outputs {
			if strings.HasSuffix(name, "/a.d.ts") {
				if !strings.Contains(text, want) {
					Gap(t, "FuzzPackageExportDeclaration", gapKey, "wanted %s, got %s", want, text)
				}
				return
			}
		}
		Gap(t, "FuzzPackageExportDeclaration", gapKey, "no declaration for consumer a.ts")
	})
}

func requirePackageExportDeclarationQuote(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), packageExportDeclarationQuote) {
		tb.Fatal("missing declaration identity quote")
	}
}
