package compiler_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestPrivateModuleBodyInferredImportType(t *testing.T) {
	files := map[string]any{
		"/app/package.json":          `{"type":"module"}`,
		"/app/tsconfig.json":         `{"compilerOptions":{"strict":true,"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowArbitraryExtensions":true},"vibe":{"effectGlobals":false,"effectModules":false},"files":["main.vibe"]}`,
		"/app/main.vibe":             "import { make } from \"provider/value\";\nexport const value = make();\n",
		"/app/node_modules/provider": vfstest.Symlink("/provider"),
		"/provider/package.json":     `{"name":"provider","type":"module","exports":{"./value":{"types":"./value.d.vibe.ts","default":"./value.vibe"},"./*":"./*.ts","./value.vibe.shapes":null}}`,
		"/provider/value.vibe":       "module shapes {\n export interface Value { readonly count: number }\n export function make(): Value { return { count: 1 }; }\n}\nexport { make } from shapes;\nexport type { Value } from shapes;\n",
	}
	program := func(configName string) *compiler.Program {
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		cfg, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromNormalized(configName), &core.CompilerOptions{}, nil, fs, nil)
		if len(ds) != 0 {
			t.Fatal(ds)
		}
		return compiler.NewProgram(compiler.ProgramOptions{Config: cfg, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	}

	files["/provider/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowArbitraryExtensions":true},"vibe":{"effectGlobals":false,"effectModules":false},"files":["value.vibe"]}`
	providerDeclarations := map[string]string{}
	provider := program("/provider/tsconfig.json")
	if r := provider.EmitDeclarationSidecars(t.Context(), func(name, text string) error { providerDeclarations[name] = text; return nil }); r == nil || r.EmitSkipped || len(r.Diagnostics) != 0 {
		t.Fatalf("dependency declaration emit: %+v", r)
	}
	for name, text := range providerDeclarations {
		files[name] = text
	}

	p := program("/app/tsconfig.json")
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		t.Errorf("source: %s", d.String())
	}
	emitted := map[string]string{}
	r := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil })
	if r == nil || r.EmitSkipped || len(r.Diagnostics) != 0 {
		t.Fatalf("emit: %+v", r)
	}
	decl := emitted["/app/main.d.vibe.ts"]
	if decl == "" {
		t.Fatalf("missing main declaration: %v", emitted)
	}
	t.Log(decl)
	if strings.Contains(decl, `"provider/value.vibe.shapes"`) {
		t.Errorf("inferred type names a blocked package subpath:\n%s", decl)
	}
	for name, text := range emitted {
		files[name] = text
	}
	// A declaration reader cannot recover virtual modules from source files.
	delete(files, "/app/main.vibe")
	delete(files, "/provider/value.vibe")
	files["/app/consumer.ts"] = "import { value } from \"./main.vibe\";\nconst count: number = value.count;\nexport { count };\n"
	files["/app/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"skipLibCheck":false,"allowArbitraryExtensions":true},"files":["consumer.ts"]}`
	for _, d := range program("/app/tsconfig.json").GetSemanticDiagnostics(t.Context(), nil) {
		t.Errorf("declaration consumer: %s", fmt.Sprint(d))
	}
}
