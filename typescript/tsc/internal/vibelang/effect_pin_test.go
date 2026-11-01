package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// pinDiagnostics returns the EK3201 diagnostics of file and every other code.
func pinDiagnostics(t *testing.T, program *compiler.Program, file *ast.SourceFile) (pins []*ast.Diagnostic, others []int32) {
	t.Helper()
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK3201.Code {
			pins = append(pins, d)
		} else {
			others = append(others, d.Code())
		}
	}
	return pins, others
}

// VIP-32, 007 "The Effect version", decided detail 70: a resolved effect other
// than the pin is EK3201, once, naming both versions and the VibeLang release.
func TestEffectPinMismatch(t *testing.T) {
	for _, test := range []struct {
		name, fixture, version string
	}{
		{"older minor", "testdata/effect-pin/effect-4.0.3", "4.0.3"},
		{"newer patch", "testdata/effect-pin/effect-4.1.1", "4.1.1"},
		{"prerelease of the pin", "testdata/effect-pin/effect-4.1.0-next.1", "4.1.0-next.1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			packages := map[string]string{"effect": "typescript/tsc/internal/vibelang/" + test.fixture}
			for _, source := range []string{
				"export const n: number = 1",              // never asks for effect: resolved on demand
				"export effect function f() { return 1 }", // the prelude resolves effect for it
			} {
				program, file, _, _ := editorProgramWith(t, source, packages)
				pins, _ := pinDiagnostics(t, program, file)
				if len(pins) != 1 {
					t.Fatalf("%q: want one EK3201, got %d: %v", source, len(pins), program.GetSemanticDiagnostics(t.Context(), file))
				}
				text := pins[0].MessageText()
				for _, part := range []string{test.version, Version, supportedEffectVersion, "upgrade both together"} {
					if !strings.Contains(text, part) {
						t.Fatalf("%q: EK3201 text %q lacks %q", source, text, part)
					}
				}
				first := file.Statements.Nodes[0]
				if pins[0].File() == nil || pins[0].File().FileName() != file.FileName() ||
					pins[0].Pos() < first.Pos() || pins[0].End() > first.End() {
					t.Fatalf("%q: EK3201 must point inside the first source statement: %v", source, pins[0])
				}
			}
		})
	}
}

// The pinned version, a package without a version, and no effect at all report
// no EK3201: the first is right, the others are what the missing names say.
func TestEffectPinQuiet(t *testing.T) {
	for _, test := range []struct {
		name     string
		packages map[string]string
	}{
		{"pinned", map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime"}},
		{"no version", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-unversioned"}},
		{"no effect", map[string]string{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgramWith(t, "export const n: number = 1", test.packages)
			if pins, _ := pinDiagnostics(t, program, file); len(pins) != 0 {
				t.Fatalf("want no EK3201, got %v", pins[0].MessageText())
			}
		})
	}
}

// Every selected package must use the pin, independently of source order.
func TestEffectPinMismatchAfterPinnedFile(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		t.Run(fmt.Sprint(reverse), func(t *testing.T) {
			_, file, _, _ := editorProgramWith(t, "export const n: number = 1", map[string]string{"effect": "packages/runtime/node_modules/effect"})
			dir := filepath.Dir(file.FileName().AsString())
			nested := filepath.Join(dir, "nested")
			if err := os.MkdirAll(filepath.Join(nested, "node_modules"), 0755); err != nil {
				t.Fatal(err)
			}
			fixture, err := filepath.Abs("testdata/effect-pin/effect-4.0.3")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(fixture, filepath.Join(nested, "node_modules/effect")); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(nested, "other.vibe"), []byte("export const n: number = 2"), 0600); err != nil {
				t.Fatal(err)
			}
			names := `["main.vibe","nested/other.vibe"]`
			if reverse {
				names = `["nested/other.vibe","main.vibe"]`
			}
			text := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"files":` + names + "}"
			configName := filepath.Join(dir, "tsconfig.json")
			if err := os.WriteFile(configName, []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			pins, others := pinDiagnostics(t, program, nil)
			if len(pins) != 1 || len(others) != 0 {
				t.Fatalf("want one EK3201 for later package, got pins=%v others=%v", pins, others)
			}
			if pins[0].File() == nil || !strings.HasSuffix(pins[0].File().FileName().AsString(), "/nested/other.vibe") {
				t.Fatalf("off-pin diagnostic belongs to the other package: %v", pins[0])
			}
		})
	}
}
