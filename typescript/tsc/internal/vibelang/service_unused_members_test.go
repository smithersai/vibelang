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

func TestServiceContractUnusedChecks(t *testing.T) {
	for _, member := range []string{
		"read(n: number): number!!",
		"value: number",
		"read?(n: number): number!!",
		"readonly value: number",
		"map<A>(value: A): A",
		"read(n: number): number!!, value: number,",
	} {
		t.Run(member, func(t *testing.T) {
			for _, code := range serviceUnusedDiagnostics(t, "export service S { static readonly key = \"unused/S\"; "+member+" }") {
				t.Errorf("unexpected error TS/EK%d", code)
			}
		})
	}
	for _, member := range []string{"(n: number): number", "<A>(value: A): A", "new(): number", "new<A>(value: A): A"} {
		t.Run(member, func(t *testing.T) {
			got := serviceUnusedDiagnostics(t, "export service S { static readonly key = \"unused/S\"; "+member+" }")
			if len(got) != 1 || got[0] != 902 {
				t.Fatalf("want EK0902 without a panic, got %v", got)
			}
		})
	}
	// The checker still diagnoses actual unused private implementation members.
	if got := serviceUnusedDiagnostics(t, "export class C { private unused() { return 1 } }"); len(got) != 1 || got[0] != 6133 {
		t.Fatalf("ordinary class unused check changed: %v", got)
	}
}
func serviceUnusedDiagnostics(t *testing.T, source string) []int32 {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	name := filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
	if err := os.WriteFile(name, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"noUnusedLocals":true,"noUnusedParameters":true},"files":["main.vibe"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(name)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errs) != 0 {
		t.Fatal(errs)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	var codes []int32
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Code())
			t.Log(strings.TrimSpace(diagnosticWithNotes(d)))
		}
	}
	return codes
}
