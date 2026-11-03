package vibelang

import (
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

// Detail 273: error X and error X {} both declare X_base. A written <{}>
// declares X_base<{}>, so EK4830 cannot safely erase it in declaration projects.
func TestFixExplicitEmptyErrorDeclarations(t *testing.T) {
	for _, tc := range []struct {
		name, payload, options string
		refuse                 bool
	}{
		{"foldkit-missing-build-id", "<{}>", `"declaration":true`, true},
		{"commented-empty", "<{ /* keep payload */ }>", `"emitDeclarationOnly":true,"declaration":true`, true},
		{"composite", "<{}>", `"composite":true`, true},
		{"declaration-noemit", "<{}>", `"declaration":true,"noEmit":true`, true},
		{"bare", "", `"declaration":true`, false},
		{"one-field", "<{ readonly id: string }>", `"declaration":true`, false},
		{"no-declarations", "<{}>", `"noEmit":true`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "import { Data } from \"effect\"\nexport class MissingBuildId extends Data.TaggedError(\"MissingBuildId\")" + tc.payload + " {}\n"
			_, file, _, _ := editorProgramWith(t, source, map[string]string{"effect": "experiments/node_modules/effect", "vibelang-runtime": "packages/runtime"})
			dir := filepath.Dir(file.FileName().AsString())
			configFile := filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))
			configText := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"outDir":"out",` + tc.options + `},"files":["main.vibe"]}`
			if err := os.WriteFile(configFile, []byte(configText), 0o600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(configFile), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			notes := ""
			for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid regression fixture: %s", d.String())
				}
				if d.Code() == EK4830.Code {
					for _, note := range d.MessageChain() {
						notes += note.String() + "\n"
					}
				}
			}
			result := FixProject(t.Context(), fs, bundled.LibPath(), config)
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			got := source
			if fixed := result.Files[file.FileName()]; fixed != nil {
				got = fixed.Text
			}
			if tc.refuse {
				if !strings.Contains(got, strings.SplitN(source, "\n", 2)[1]) || !strings.Contains(notes, "empty payload type argument") {
					t.Fatalf("must retain explicit payload and explain refusal; fixed:\n%s\nnotes: %s", got, notes)
				}
			} else if !strings.Contains(got, "export error MissingBuildId") || len(result.Refused) != 0 {
				t.Fatalf("safe conversion not applied: %s; refused: %+v", got, result.Refused)
			}
		})
	}
}

// VIP-13 declaration-preserving refusal for native explicit empty payload; rule: docs/design/vips/0013-error-declarations.md#ce15d244fbb608cf
