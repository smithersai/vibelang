package vibelang

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// The timing benchmark cannot guard against an early heap entry reliably.
// Count private heap-factory accesses in the compiled acceptance fixture,
// including callbacks, accessors, imported helpers and independent cycles.
func TestPlainBridgeBudget(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/recursion-bridge"), root)
	fileSystem := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fileSystem, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fileSystem, bundled.LibPath(), nil, nil, nil)})
	for _, diagnostic := range commandLineDiagnostics(t, config.Errors, program) {
		if diagnostic.Category() == diagnostics.CategoryError {
			t.Fatalf("compile: %s", diagnostic.String())
		}
	}
	result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if err := os.MkdirAll(filepath.Dir(string(name)), 0755); err != nil {
			return err
		}
		return os.WriteFile(string(name), []byte(text), 0600)
	}})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("emit: %v", result.Diagnostics)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "node", "run.mjs")
	command.Dir = dir
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("bridge budget: %v\n%s", err, output)
	}
}
