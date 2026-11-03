package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func serviceAliasDeclaration(t *testing.T, source string) string {
	t.Helper()
	p, _, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("invalid fixture: %s\n%s", d.String(), source)
		}
	}
	var text string
	result := p.Emit(t.Context(), compiler.EmitOptions{EmitOnly: compiler.EmitOnlyDts, ForceEmit: true, WriteFile: func(name tspath.RootedFilePath, data string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "main.d.ts") {
			text = data
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatal(d.String())
		}
	}
	if text == "" {
		t.Fatal("no declaration emitted")
	}
	return text
}

func TestServiceDeclarationNamespaceAliases(t *testing.T) {
	for _, alias := range []string{"Context", "Ctx", "ServiceContext"} {
		for _, shape := range []string{"inline", "namespace"} {
			t.Run(alias+"/"+shape, func(t *testing.T) {
				prefix := "import * as " + alias + " from \"effect/Context\"\n"
				vibe := "export service Database { static readonly key = \"alchemy/Database\"; readonly value: number }"
				native := "type Database_shape = { readonly value: number }; export class Database extends " + alias + ".Service<Database, Database_shape>()(\"alchemy/Database\") {} export declare namespace Database { type Shape = Database_shape }"
				if shape == "namespace" {
					vibe = "export namespace Library { " + vibe + " }"
					native = "export namespace Library { " + native + " }"
				}
				got := serviceAliasDeclaration(t, prefix+vibe)
				want := serviceAliasDeclaration(t, prefix+native)
				if got != want {
					t.Fatalf("declaration alias differs:\ngot:\n%s\nwant:\n%s", got, want)
				}
				if strings.Count(got, "import * as "+alias+" from \"effect/Context\";") != 1 {
					t.Fatalf("missing or duplicate original import:\n%s", got)
				}
			})
		}
	}
}

func TestServiceDeclarationAliasShadow(t *testing.T) {
	source := "import * as Ctx from \"effect/Context\"\nexport namespace Library { export type Ctx = string; export service Database { static readonly key = \"alchemy/Database\"; readonly value: number } }"
	got := serviceAliasDeclaration(t, source)
	if strings.Contains(got, "Ctx.ServiceClass") || !strings.Contains(got, "Context.ServiceClass") {
		t.Fatalf("a shadowed alias was reused:\n%s", got)
	}
}

func TestServiceDeclarationAliasMustResolveToContext(t *testing.T) {
	source := "import * as Ctx from \"effect/Context\"\nexport service Database { static readonly key = \"alchemy/Database\"; readonly value: number }"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	stub := "export declare const Service: unknown; export interface ServiceClass<A,B,C> { readonly fake: true }"
	if err := os.WriteFile(filepath.Join(dir, "lookalike.ts"), []byte(stub), 0600); err != nil {
		t.Fatal(err)
	}
	configText := `{"compilerOptions":{"strict":true,"skipLibCheck":true,"target":"ES2022","module":"NodeNext","noEmit":true,"paths":{"effect/Context":["./lookalike.ts"]}},"files":["main.vibe","lookalike.ts"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(configText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatal(d.String())
		}
	}
	var text string
	p.Emit(t.Context(), compiler.EmitOptions{EmitOnly: compiler.EmitOnlyDts, ForceEmit: true, WriteFile: func(name tspath.RootedFilePath, data string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "main.d.ts") {
			text = data
		}
		return nil
	}})
	if text == "" || strings.Contains(text, "Ctx.ServiceClass") || !strings.Contains(text, "Context.ServiceClass") {
		t.Fatalf("lookalike namespace became service base:\n%s", text)
	}
}
