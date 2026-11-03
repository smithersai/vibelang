package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

const doNarrowingTarget = "FuzzDoShortCircuitNarrowing"

// Principle 4 lists `throw` until fold-details folds nothrow-impl.patch; this
// part reads the same before and after.
const doNarrowingQuote = "classes, `do` expressions and the pipe operator keep their TypeScript or pinned TC39 meaning."

func TestDoShortCircuitNarrowingQuoted(t *testing.T) {
	chapterSays(t, "000-intro.md", doNarrowingQuote)
}

// Static flow facts come from stock tsc on the immediate-arrow twin.
// The canonical VIP-2 differential generator owns runtime Exit comparison.
func FuzzDoShortCircuitNarrowing(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "000-intro.md", doNarrowingQuote)
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	for _, key := range vipgen.DoNarrowingKeys {
		f.Add(key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(vipgen.DoNarrowingKeys, key) {
			key = vipgen.DoNarrowingKeys[int(variant)%len(vipgen.DoNarrowingKeys)]
		}
		vibe, twin, _ := vipgen.DoNarrowingProgram(key, variant, "narrowed")
		source := func(body string) string {
			return "export function main(): (number | boolean | string | undefined | string[])[][] { " + body + "; return narrowed }"
		}
		config := func(file string) string {
			return fmt.Sprintf(`{"compilerOptions":{"target":"es2022","module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"vibe":{"effectGlobals":false,"effectModules":false},"files":[%q]}`, file)
		}
		dir, err := w.writeProject(Project{Files: map[string]string{"main.ts": source(twin)}, Config: config("main.ts")})
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, tsc, "-p", dir, "--pretty", "false")
		out, runErr := cmd.CombinedOutput()
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		if runErr != nil {
			if e, ok := runErr.(*exec.ExitError); !ok || e.ExitCode() > 2 {
				t.Fatalf("stock tsc: %v: %s", runErr, out)
			}
		}
		var want []string
		for _, match := range stockCode.FindAllStringSubmatch(string(out), -1) {
			want = append(want, "TS"+match[1])
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source(vibe)}, Config: config("main.vibe")})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var got []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				prefix := "TS"
				if IsEK(d) {
					prefix = "EK"
				}
				got = append(got, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
		}
		slices.Sort(got)
		slices.Sort(want)
		gap := "guard:" + key
		if !slices.Equal(got, want) {
			Gap(t, doNarrowingTarget, gap, "chapter 000: %s\nVibe diagnostics %v; stock tsc %v\n%s\nVibe:\n%s\ntwin:\n%s", doNarrowingQuote, got, want, out, source(vibe), source(twin))
		}
		ExpectPending(t, doNarrowingTarget, gap)
	})
}
