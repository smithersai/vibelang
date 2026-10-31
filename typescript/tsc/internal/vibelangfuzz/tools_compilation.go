package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// toolsRecompile formats the same project at the same path, with the same
// configuration. D276 and D372 compare layout, while D1's service identities
// include the module path, so separate project directories are not equivalent
// inputs to an emitted-token comparison.
func toolsRecompile(t *testing.T, w *Workspace, before *Result, files map[string]string) *Result {
	t.Helper()
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(before.Dir, filepath.FromSlash(name)), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	result := &Result{Dir: before.Dir, Sources: files, Outputs: map[string]string{}}
	toolsRun(t, "FuzzFormat", "compile formatted", Archive(files), nil, func() {
		program := toolsProgram(w, before.Dir)
		result.Program = program
		if program == nil {
			return
		}
		ctx := t.Context()
		result.Diagnostics = append(result.Diagnostics, program.GetConfigFileParsingDiagnostics()...)
		result.Diagnostics = append(result.Diagnostics, program.GetSyntacticDiagnostics(ctx, nil)...)
		result.Diagnostics = append(result.Diagnostics, program.GetProgramDiagnostics()...)
		result.Diagnostics = append(result.Diagnostics, program.GetGlobalDiagnostics(ctx)...)
		result.Diagnostics = append(result.Diagnostics, program.GetSemanticDiagnostics(ctx, nil)...)
		result.Diagnostics = append(result.Diagnostics, program.GetDeclarationDiagnostics(ctx, nil)...)
		var outputs sync.Mutex
		emitted := program.Emit(ctx, compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
			outputs.Lock()
			defer outputs.Unlock()
			result.Outputs[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = text
			return nil
		}})
		result.EmitSkipped = emitted.EmitSkipped
		result.Diagnostics = append(result.Diagnostics, emitted.Diagnostics...)
		// Match Workspace.Compile and the CLI when emit repeats pre-emit diagnostics.
		result.Diagnostics = compiler.SortAndDeduplicateDiagnostics(result.Diagnostics)
	})
	return result
}
