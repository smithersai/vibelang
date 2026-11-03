package vibelangfuzz

import (
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// toolsTrailingBlockBaseline is local to FuzzFix. Chapter 7 says "The rewrite preserves
// runtime behavior." The ordinary parser now leaves the retired
// brace alone; reconstruct only the old emit to feed the existing contracts
// and Exit oracle. Keep the original path, so service keys (D1) stay stable.
func toolsTrailingBlockBaseline(t *testing.T, original *Result) *Result {
	if !slices.ContainsFunc(original.Diagnostics, func(d *ast.Diagnostic) bool {
		return IsEK(d) && d.Code() == 1101
	}) {
		return original
	}
	var result *Result
	toolsRun(t, "FuzzFix", "legacy-baseline", Archive(original.Sources), nil, func() {
		program := compiler.NewProgram(compiler.ProgramOptions{
			Config: original.Program.CommandLine(),
			Host:   trailingBlockBaselineHost{CompilerHost: original.Program.Host(), program: original.Program},
		})
		result = &Result{Dir: original.Dir, Sources: original.Sources, Program: program, Outputs: map[string]string{}}
		result.Diagnostics = append(result.Diagnostics, program.GetConfigFileParsingDiagnostics()...)
		result.Diagnostics = append(result.Diagnostics, program.GetSyntacticDiagnostics(t.Context(), nil)...)
		result.Diagnostics = append(result.Diagnostics, program.GetProgramDiagnostics()...)
		result.Diagnostics = append(result.Diagnostics, program.GetGlobalDiagnostics(t.Context())...)
		result.Diagnostics = append(result.Diagnostics, program.GetSemanticDiagnostics(t.Context(), nil)...)
		result.Diagnostics = append(result.Diagnostics, program.GetDeclarationDiagnostics(t.Context(), nil)...)
		prefix := filepath.ToSlash(result.Dir) + "/"
		var mutex sync.Mutex
		emitted := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
			mutex.Lock()
			defer mutex.Unlock()
			result.Outputs[strings.TrimPrefix(name.AsString(), prefix)] = text
			return nil
		}})
		result.EmitSkipped = emitted.EmitSkipped
		result.Diagnostics = append(result.Diagnostics, emitted.Diagnostics...)
	})
	return result
}

type trailingBlockBaselineHost struct {
	compiler.CompilerHost
	program *compiler.Program
}

func (h trailingBlockBaselineHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if file := h.program.GetSourceFile(opts.FileName); file != nil {
		if !opts.FileName.ExtensionIs(tspath.ExtensionVibe) {
			return file
		}
		opts.VibeLangLegacyTrailingBlocks = true
		return parser.ParseSourceFile(opts, file.Text(), file.ScriptKind)
	}
	opts.VibeLangLegacyTrailingBlocks = opts.FileName.ExtensionIs(tspath.ExtensionVibe)
	return h.CompilerHost.GetSourceFile(opts)
}
