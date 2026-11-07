// docs/design/vips/0034-compiler-and-tooling.md#4eccc779b2b6a174
// VIP-34: both fix scope options require --fix in either argument order.
package vibelangfuzz

// Coverage census: scope options require the fix entry point in either argument order.
// VIP-34 scope options require the fix entry point in either argument order: docs/design/vips/0034-compiler-and-tooling.md#971d79350e1f09c7
// VIP-34 scope options require the fix entry point in either argument order: docs/design/vips/0034-compiler-and-tooling.md#4c22bc44d023ec46
// VIP-34 scope options require the fix entry point in either argument order: docs/design/vips/0034-compiler-and-tooling.md#1081277f999762fe
// VIP-34 scope options require the fix entry point in either argument order: docs/design/vips/0034-compiler-and-tooling.md#aab86e7304ebc8f5
// VIP-34 scope options require the fix entry point in either argument order: docs/design/vips/0034-compiler-and-tooling.md#465f179b8ba11361

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// The CLI recognizes these scopes only when --fix is present, in either order.
// Keep the independent fuzz parser and the published flag inventory aligned.
// Chapter 007 / fix scope flags require fix in either argument order: docs/design/src/007-tooling.md#be8064e772d2a59a
// Chapter 007 / fix scope flags require fix in either argument order: docs/design/src/007-tooling.md#57bf309e146b7945
// Chapter 007 / fix scope flags require fix in either argument order: docs/design/src/007-tooling.md#df4275821259b79f
// Chapter 007 / fix scope flags require fix in either argument order: docs/design/src/007-tooling.md#64b83ee238c8d156

func TestCommandLineFixScopes(t *testing.T) {
	// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#b1e39e947cf4e462
	// VIP-34: scope flags require fix.
	w := &Workspace{fs: osvfs.FS()}
	dir := t.TempDir()
	for _, scope := range []string{"--fix-migration-only", "--fix-vip-only", "--fix-legacy-service-keys"} {
		t.Run(scope, func(t *testing.T) {
			if !slices.Contains(cliSpecCommandFlags(SpecText("007-tooling.md")), scope) {
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
