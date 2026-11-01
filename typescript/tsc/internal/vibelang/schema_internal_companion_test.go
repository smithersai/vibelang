package vibelang

import (
	"encoding/json"
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

// VIP-27/detail256: a schema owns the same JSDoc/visibility as the
// constant in the native Effect pair. Its companion type alias stays bare.
func TestSchemaInternalCompanionNativePair(t *testing.T) {
	for _, alias := range []bool{false, true} {
		for _, nested := range []bool{false, true} {
			for _, comment := range []string{"/** Public documentation. */", "/** @internal */", "/** Documentation.\n * @internal\n */"} {
				for mode := 0; mode < 4; mode++ {
					t.Run(fmt.Sprintf("alias%t/nested%t/comment%q/options%d", alias, nested, comment, mode), func(t *testing.T) {
						vibe := "export schema Message { readonly id:string }"
						native := "export const Message=Schema.Struct({id:Schema.String});\nexport type Message=typeof Message.Type;"
						if alias {
							vibe = "export schema Message=string;"
							native = "export const Message=Schema.String;\nexport type Message=typeof Message.Type;"
						}
						vibe = comment + "\n" + vibe
						native = comment + "\n" + native
						if nested {
							vibe = "export namespace N {\n" + vibe + "\n}"
							native = "export namespace N {\n" + native + "\n}"
						}
						got := schemaCompanionPairDeclarations(t, vibe, "vibe", mode)
						want := schemaCompanionPairDeclarations(t, "import { Schema } from \"effect\";\n"+native, "ts", mode)
						if got != want {
							t.Fatalf("schema/native declarations differ:\nvibe:\n%s\nnative:\n%s", got, want)
						}
					})
				}
			}
		}
	}
}

func schemaCompanionPairDeclarations(t *testing.T, source, extension string, mode int) string {
	t.Helper()
	_, file, _, _ := editorProgram(t, "")
	dir := filepath.Dir(file.FileName().AsString())
	main := "main." + extension
	if err := os.WriteFile(filepath.Join(dir, main), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	configText, err := json.Marshal(map[string]any{"compilerOptions": map[string]any{"target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "declaration": true, "emitDeclarationOnly": true, "outDir": "out", "stripInternal": mode&1 != 0, "removeComments": mode&2 != 0}, "files": []string{main}})
	if err != nil {
		t.Fatal(err)
	}
	configName := filepath.Join(dir, "tsconfig.json")
	if err := os.WriteFile(configName, configText, 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	output := ""
	result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "/main.d.ts") {
			output = text
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("emit: %s", d.String())
		}
	}
	if output == "" {
		t.Fatal("no main.d.ts emitted")
	}
	return output
}

// An elided constant must not cancel reordering of another schema's pair.
func TestSchemaInternalCompanionMixedOrder(t *testing.T) {
	for _, nested := range []bool{false, true} {
		for _, alias := range []bool{false, true} {
			for _, mode := range []int{1, 3} {
				t.Run(fmt.Sprintf("nested%t/alias%t/options%d", nested, alias, mode), func(t *testing.T) {
					internal := "schema Hidden {readonly id:string}"
					nativeInternal := "const Hidden=Schema.Struct({id:Schema.String});"
					if alias {
						internal = "schema Hidden=string;"
						nativeInternal = "const Hidden=Schema.String;"
					}
					vibe := "/** @internal */\nexport " + internal + "\n/** Public. */\nexport schema Visible=number;\n"
					native := "/** @internal */\nexport " + nativeInternal + "\nexport type Hidden=typeof Hidden.Type;\n/** Public. */\nexport const Visible=Schema.Number;\nexport type Visible=typeof Visible.Type;\n"
					if nested {
						vibe = "export namespace N {\n" + vibe + "}\n"
						native = "export namespace N {\n" + native + "}\n"
					}
					got := schemaCompanionPairDeclarations(t, vibe, "vibe", mode)
					want := schemaCompanionPairDeclarations(t, "import { Schema } from \"effect\";\n"+native, "ts", mode)
					if got != want {
						t.Fatalf("mixed schema/native order differs:\nvibe:\n%s\nnative:\n%s", got, want)
					}
				})
			}
		}
	}
}
