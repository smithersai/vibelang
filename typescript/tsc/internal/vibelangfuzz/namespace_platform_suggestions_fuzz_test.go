package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const namespacePlatformModuleQuote = "Its body is a TypeScript file stored in the `.vibe` file:"
const namespacePlatformServiceQuote = "**What Effect lacks goes under `Experimental.X`,**"
const namespacePlatformHostQuote = "A local binding, an import or an Effect module in scope"

func TestNamespacePlatformSuggestionsQuoted(t *testing.T) {
	// The module exception belongs to module bodies, not native namespaces.
	quote := namespacePlatformModuleQuote
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("module-body authority changed: %q", quote)
	}
	services := SpecText("005-services.md")
	for _, q := range []string{namespacePlatformServiceQuote, namespacePlatformHostQuote} {
		if !strings.Contains(services, q) {
			t.Fatalf("platform authority changed: %q", q)
		}
	}
}

var namespacePlatformScopes = []string{"namespace", "nested", "dotted", "module", "native", "shadow"}

func FuzzNamespacePlatformSuggestions(f *testing.F) {
	startShortBudget(f)
	for _, key := range namespacePlatformScopes {
		for variant := byte(0); variant < 8; variant++ {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestNamespacePlatformSuggestionsQuoted(t)
		if !slices.Contains(namespacePlatformScopes, key) {
			key = namespacePlatformScopes[int(variant)%len(namespacePlatformScopes)]
		}
		name := []string{"Process", "BrowserInfo"}[variant&1]
		ext := []string{".vibe", ".vibex"}[(variant>>1)&1]
		if key == "native" {
			ext = []string{".ts", ".tsx"}[(variant>>1)&1]
		}
		source := "export const value = " + name
		switch key {
		case "namespace":
			source = "namespace App { " + source + " }"
		case "nested":
			source = "namespace App { export namespace Inner { " + source + " } }"
		case "dotted":
			source = "namespace App.Inner { " + source + " }"
		case "module":
			source = "module host { " + source + " }\nimport { value } from host; export { value }"
		case "shadow":
			source = "namespace App { const " + name + " = 1; " + source + " }"
		}
		if variant&4 != 0 {
			source = "// preserved diagnostic offset\r\n" + strings.ReplaceAll(source, "App", "Applicatiôn")
		}
		config := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[]},"files":["main%s","node_modules/@types/node/index.d.ts"]}`, ext)
		files := map[string]string{
			"/project/package.json":                          `{"type":"module"}`,
			"/project/tsconfig.json":                         config,
			"/project/main" + ext:                            source,
			"/project/node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
			"/project/node_modules/@types/node/index.d.ts":   "declare var process: { readonly pid: number };",
		}
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		ds := program.GetSemanticDiagnostics(t.Context(), nil)
		if key == "shadow" {
			if len(ds) != 0 {
				t.Fatalf("local binding acquired diagnostics: %v", ds)
			}
			return
		}
		if len(ds) != 1 {
			t.Fatalf("invalid unresolved-name fixture: %v", ds)
		}
		d := ds[0]
		native := key == "module" || key == "native"
		want := int32(2304)
		if native && name == "Process" {
			want = 2552
		}
		text := namespaceSuggestionText(d)
		if d.Source() != "" || d.Code() != want || d.File().Text()[d.Pos():d.End()] != name {
			Gap(t, "FuzzNamespacePlatformSuggestions", key, "native code/span: want TS%d on %s, got %s", want, name, text)
		}
		if strings.Contains(text, "Experimental."+name) != !native {
			Gap(t, "FuzzNamespacePlatformSuggestions", key, "experimental guidance must follow the source language: %s", text)
		}
		if !native && strings.Contains(text, "Did you mean 'process'") {
			Gap(t, "FuzzNamespacePlatformSuggestions", key, "a banned host global is not a VibeLang replacement: %s", text)
		}
	})
}

func namespaceSuggestionText(d *ast.Diagnostic) string {
	text := d.String()
	for _, related := range d.MessageChain() {
		text += "\n" + namespaceSuggestionText(related)
	}
	return text
}
