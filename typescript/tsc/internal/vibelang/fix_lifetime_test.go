package vibelang

import (
	"runtime"
	"strings"
	"testing"
	"weak"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Each passing round has a fresh checker. The previous round's program must
// be collectible before that checker runs: on Smithers' flows a single
// program retains gigabytes of types. Bound live programs, not noisy RSS or
// time, while retaining the normal source, diagnostic and acceptance checks.
func TestFixPassingRoundsReleasePrograms(t *testing.T) {
	for _, scenario := range []struct {
		name            string
		each            bool
		refusals, limit int
	}{
		{name: "batched", limit: 1},
		{name: "individual", each: true, limit: 1},
		// A rejected round needs its known failing trial, the current partial
		// trial, and the fresh orderErrors control while comparing that trial.
		{name: "rejected trial then passing rounds", refusals: 1, limit: 3},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			const depth = 4
			source := "export type Deep = " + strings.Repeat("Effect.Effect<Array<", depth) + "number" + strings.Repeat(">>", depth) + "\n"
			if scenario.refusals != 0 {
				source += refusedMatchChain
			}
			_, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			var programs []weak.Pointer[compiler.Program]
			maxLive := 0
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, file.FileName()), FixOptions{
				CheckEachFix: scenario.each,
				programBuilt: func(program *compiler.Program) {
					programs = append(programs, weak.Make(program))
					runtime.GC()
					live := 0
					for _, p := range programs {
						if p.Value() != nil {
							live++
						}
					}
					maxLive = max(maxLive, live)
					runtime.KeepAlive(program)
				},
			})
			if result.Err != nil || len(result.Refused) != scenario.refusals {
				t.Fatalf("fix failed: %v, %+v", result.Err, result.Refused)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || fixed.Counts[4833] != depth {
				t.Fatalf("did not run %d real rounds: %+v", depth, fixed)
			}
			t.Logf("%d builds; maximum %d live programs", len(programs), maxLive)
			if maxLive > scenario.limit {
				t.Fatalf("passing rounds retained %d programs while building the next; want at most %d", maxLive, scenario.limit)
			}
		})
	}
}
