package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestServiceNativeImportsQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", "VibeLang's grammar is TypeScript's, plus four TC39 proposals and the productions below.")
	chapterSays(t, "900-appendices.md", "Independent errors in native embedded expressions and types keep their native diagnostics.")
}

// Service classification completes on native import syntax and preserves its
// native diagnostics. Platform classification has its own static target.
func FuzzServiceNativeImports(f *testing.F) {
	startShortBudget(f)
	keys := []string{"source", "defer", "source-argument", "defer-argument", "ordinary"}
	for _, key := range keys {
		f.Add(key, byte(0))
		f.Add(key, byte(3))
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		TestServiceNativeImportsQuoted(t)
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		phase := "source"
		if key == "defer" || key == "defer-argument" {
			phase = "defer"
		}
		arg := "specifier"
		if key == "source-argument" || key == "defer-argument" {
			arg = "42"
		}
		callee := "import." + phase
		if key == "ordinary" {
			callee = "import"
		}
		source := "export function load(specifier: string) { return " + callee + "(" + arg + "); }"
		if mode&2 != 0 {
			source = "export const load = (specifier: string) => " + callee + "(" + arg + ");"
		}
		if mode&4 != 0 {
			source = "namespace App { " + source + " }"
		}
		if mode&8 != 0 {
			source = "// native callee offsets: λ\r\n" + source
		}
		read := func(ext string) []*ast.Diagnostic {
			config := fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"target\":\"ESNext\",\"module\":\"ESNext\",\"moduleResolution\":\"Bundler\",\"types\":[],\"lib\":[\"ESNext\",\"DOM\"]},\"files\":[\"main%s\"]}", ext)
			fs := bundled.WrapFS(vfstest.FromMap(map[string]string{"/project/package.json": "{\"type\":\"module\"}", "/project/tsconfig.json": config, "/project/main" + ext: source}, tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			ds := append([]*ast.Diagnostic{}, p.GetSyntacticDiagnostics(t.Context(), nil)...)
			return append(ds, p.GetSemanticDiagnostics(t.Context(), nil)...)
		}
		native := read(".ts")
		got := read([]string{".vibe", ".vibex"}[mode&1])
		for _, d := range got {
			if d.Source() == "EK" && d.Code() == 9214 {
				Gap(t, "FuzzServiceNativeImports", key, "native import was classified as a service key: %s", d.String())
			}
		}
		for _, want := range native {
			if !slices.ContainsFunc(got, func(d *ast.Diagnostic) bool {
				return d.Source() == want.Source() && d.Code() == want.Code() && d.Pos() == want.Pos() && d.End() == want.End() && d.Category() == want.Category()
			}) {
				Gap(t, "FuzzServiceNativeImports", key, "native diagnostic lost: %s; got %v", want.String(), got)
			}
		}
	})
}
