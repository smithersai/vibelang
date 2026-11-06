package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Check emitted declarations as ordinary TypeScript source, so skipLibCheck
// cannot hide an unresolved generated qualifier in a declaration file.
func checkServiceDeclarationTypes(t *testing.T, text string) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export {}")
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "declarations.ts"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	configText := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"files":["declarations.ts"]}`
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
			t.Fatalf("invalid emitted TypeScript: %s\n%s", d.String(), text)
		}
	}
}

func TestServiceNamespaceDeclarationHygiene(t *testing.T) {
	for _, scope := range []struct{ name, wrap, ref string }{
		{"namespace", "export namespace N {%s}", "N"},
		{"nested", "export namespace N {export namespace M {%s}}", "N.M"},
		{"dotted", "export namespace N.M {%s}", "N.M"},
	} {
		for _, prefix := range []struct{ name, text string }{
			{"implicit", ""},
			{"namespace-import", "import * as Context from \"effect/Context\";"},
			{"named-import", "import {Context} from \"effect\";"},
		} {
			for _, form := range []struct{ name, text string }{
				{"body", "export service E {static readonly key=\"hygiene/E\";value:number}"},
				{"whole", "export service E:{value:number} {static readonly key=\"hygiene/E\"}"},
				{"reference", "export service E {static readonly key=\"hygiene/E\";static readonly defaultValue=()=>({value:1});value:number}"},
			} {
				for _, shadow := range []struct{ name, text string }{
					{"namespace", "export namespace Context {export const marker=1}"},
					{"type", "export type Context={marker:number}"},
					{"occupied", "export namespace Context {export const marker=1};export namespace Context_1 {export const marker=2};export namespace Context_2 {export const marker=3}"},
				} {
					t.Run(scope.name+"/"+prefix.name+"/"+form.name+"/"+shadow.name, func(t *testing.T) {
						source := prefix.text + fmt.Sprintf(scope.wrap, shadow.text+";"+form.text) + ";export const value:" + scope.ref + ".E.Shape=" + scope.ref + ".E.of({value:1});"
						if form.name == "whole" {
							source = strings.ReplaceAll(source, scope.ref+".E.Shape", "{value:number}")
						}
						declaration := serviceAliasDeclaration(t, source)
						checkServiceDeclarationTypes(t, declaration)
						if !strings.Contains(declaration, "export") || !strings.Contains(declaration, "Context") {
							t.Fatalf("lost public declarations:\n%s", declaration)
						}
					})
				}
			}
		}
	}
}

func TestServiceNamespaceDeclarationUnshadowed(t *testing.T) {
	for _, shadow := range []string{"export namespace Other {export const marker=1}", "export const Context=1", ""} {
		text := serviceAliasDeclaration(t, "export namespace N {"+shadow+";export service E {static readonly key=\"hygiene/E\";value:number}}")
		checkServiceDeclarationTypes(t, text)
		if strings.Contains(text, "Context_") {
			t.Fatalf("unshadowed type import was renamed:\n%s", text)
		}
	}
}
