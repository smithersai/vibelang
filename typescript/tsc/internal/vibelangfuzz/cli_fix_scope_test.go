package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// The CLI recognizes these scopes only when --fix is present, in either order.
// Keep the independent fuzz parser and the published flag inventory aligned.
func TestCommandLineFixScopes(t *testing.T) {
	w := &Workspace{fs: osvfs.FS()}
	dir := t.TempDir()
	for _, scope := range []string{"--fix-migration-only", "--fix-vip-only"} {
		t.Run(scope, func(t *testing.T) {
			if !strings.Contains(SpecText("007-tooling.md"), "`"+scope+"`") {
				t.Errorf("chapter 007 does not specify %s", scope)
			}
			found := false
			for _, flag := range cliFlags() {
				if flag.Name == scope {
					found = true
					if !strings.Contains(flag.Source, "007-tooling.md") {
						t.Errorf("%s cites stale history instead of chapter 007: %s", scope, flag.Source)
					}
				}
			}
			if !found {
				t.Errorf("fuzz argument table omits %s", scope)
			}
			for _, args := range [][]string{
				{scope, "--noEmit"},
				{scope, "--fix", "--noEmit"},
				{"--fix", scope, "--noEmit"},
				{strings.ToUpper(scope), "--FIX", "--noEmit"},
			} {
				options := cliOptions(w, dir, args)
				wantsFix := cliHasFix(args)
				if wantsFix {
					if len(options.Errors) != 0 {
						t.Errorf("%v rejected: %v", args, options.Errors)
					}
				} else if len(options.Errors) != 1 || options.Errors[0].Code() != 5023 {
					t.Errorf("%v: want TS5023 without --fix, got %v", args, options.Errors)
				}
			}
			options := cliOptions(w, dir, []string{"--fix", scope, "--noEmit"})
			if !cliNeutral([]string{"--fix", scope, "--noEmit"}, options) {
				t.Errorf("%s with --fix lost the ordinary compiler diagnostic comparison", scope)
			}
		})
	}
}
