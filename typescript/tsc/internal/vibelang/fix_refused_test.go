package vibelang

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// refusedLineErrors compiles the project in dir and returns the errors of
// main.vibe on line.
func refusedLineErrors(t *testing.T, dir string, line int) []string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
	var found []string
	for _, d := range append(program.GetSemanticDiagnostics(t.Context(), file), program.GetSyntacticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError || d.File() != file {
			continue
		}
		if l, _ := scanner.GetECMALineAndUTF16CharacterOfPosition(file, d.Pos()); l+1 == line {
			found = append(found, strconv.Itoa(int(d.Code()))+": "+d.String())
		}
	}
	return found
}

// The setting a refusal writes turns EK4802 into an error, which Appendix B
// lists as a configurable warning: an inferred Effect argument
// no longer compiles.
func TestEK4802SeverityError(t *testing.T) {
	source := legacyRunsPrelude + "function take<T>(x: T): number { return 1 }\neffect function f() {\n  return take(load(1))\n}\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	config := `{"vibe": {"severities": {"EK4802": "error"}}, "compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	line := strings.Count(source[:strings.Index(source, "return take(load(1))")], "\n") + 1
	found := refusedLineErrors(t, dir, line)
	if len(found) != 1 || !strings.HasPrefix(found[0], "4802: ") {
		t.Fatalf("errors on line %d: %v; want EK4802 as an error", line, found)
	}
}
