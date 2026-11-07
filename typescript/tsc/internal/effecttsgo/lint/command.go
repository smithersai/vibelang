package lint

import (
	"context"
	"path/filepath"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
)

// Keep compiler diagnostics and options while preventing every output phase,
// including compatibility declarations and incremental build information.
type analysisOnlySystem struct{ tsc.System }

func (analysisOnlySystem) SuppressEmit() bool { return true }

// Lint reports categories without applying compiler-only Effect exit options.
func (analysisOnlySystem) LintExitPolicy() bool { return true }

// Command accepts the compiler's options and diagnostics without emitting.
// VIP-38 keeps the separate Oxlint adapter out of this entry point.
func Command(ctx context.Context, sys tsc.System, args []string) int {
	return int(execute.CommandLine(ctx, analysisOnlySystem{sys}, append(slices.Clone(args), "--noEmit"), nil).Status)
}

func relative(cwd, file string) string {
	if rel, err := filepath.Rel(cwd, file); err == nil {
		return rel
	}
	return file
}
