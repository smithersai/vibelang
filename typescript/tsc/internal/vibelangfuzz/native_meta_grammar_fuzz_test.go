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

func TestNativeMetaGrammarQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", "VibeLang's grammar is TypeScript's, plus four TC39 proposals and the productions below.")
}

// MetaProperty is inherited native syntax: compare the same checker on source
// kinds that the quoted rule requires to have identical grammar diagnostics.
func FuzzNativeMetaGrammar(f *testing.F) {
	startShortBudget(f)
	keys := []string{"invalid-x", "invalid-name", "incomplete-source", "incomplete-defer", "valid-url", "native-target", "source-call", "defer-call"}
	for _, key := range keys {
		f.Add(key, byte(2))
		f.Add(key, byte(12))
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		TestNativeMetaGrammarQuoted(t)
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		name := map[string]string{"invalid-x": "x", "invalid-name": "other", "incomplete-source": "source", "incomplete-defer": "defer"}[key]
		expression := "import." + name
		phaseCall := key == "source-call" || key == "defer-call"
		if phaseCall {
			expression = "import." + strings.TrimSuffix(key, "-call") + "(specifier)"
		}
		if key == "valid-url" {
			expression = "import.meta.url"
		}
		if key == "native-target" {
			expression = "new.target"
		}
		if mode&2 != 0 {
			expression = "(" + expression + ")"
		}
		if mode&4 != 0 && name != "" {
			expression += ".url"
		}
		source := "export const value = " + expression + ";"
		if mode&8 != 0 || key == "native-target" || phaseCall {
			parameter := ""
			if phaseCall {
				parameter = "specifier: string"
			}
			source = "export function read(" + parameter + ") { return " + expression + "; }"
		}
		if mode&16 != 0 {
			source = "export {}; namespace App { " + source + " }"
		}
		if mode&32 != 0 {
			source = "// native grammar offsets: λ\r\n" + source
		}
		if mode&64 != 0 && name == "x" {
			source = strings.ReplaceAll(source, "import.x", "import.\\u0078")
		}
		if mode&128 != 0 {
			source = strings.ReplaceAll(source, "import.", "import\n.")
		}
		read := func(ext string) []string {
			config := fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"target\":\"ESNext\",\"module\":\"ESNext\",\"moduleResolution\":\"Bundler\",\"types\":[],\"lib\":[\"ESNext\",\"DOM\"]},\"files\":[\"main%s\"]}", ext)
			fs := bundled.WrapFS(vfstest.FromMap(map[string]string{
				"/project/package.json": "{\"type\":\"module\"}", "/project/tsconfig.json": config, "/project/main" + ext: source,
			}, tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			ds := append([]*ast.Diagnostic{}, p.GetSyntacticDiagnostics(t.Context(), nil)...)
			ds = append(ds, p.GetSemanticDiagnostics(t.Context(), nil)...)
			var result []string
			for _, d := range ds {
				result = append(result, fmt.Sprintf("%s%d:%d:%d:%v", d.Source(), d.Code(), d.Pos(), d.End(), d.Category()))
			}
			slices.Sort(result)
			return result
		}
		native := read(".ts")
		if name != "" && len(native) == 0 {
			t.Fatal("invalid native fixture has no diagnostic")
		}
		ext := []string{".vibe", ".vibex"}[mode&1]
		got := read(ext)
		if !slices.Equal(got, native) {
			Gap(t, "FuzzNativeMetaGrammar", key, "MetaProperty keeps native grammar diagnostics: want %v, got %v; source=%s", native, got, source)
		}
	})
}
