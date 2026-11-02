package vibelangfuzz

import (
	"context"
	"flag"
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzFixGateBounds checks the gate of vibelang --fix in large rounds,
// where it writes what it has verified as it goes (gateRound.checkpoint)
// and stops telling apart the fixes that add errors after a number of
// checks (fixIsolationChecks). The input describes a project shaped like
// opencode's core, where a round of 361 fixes, 35 of them refused, halved
// for an hour and wrote no file (opencode-60, 2026-11-02): a chain of
// modules with good fixes each, and a fix in some modules that adds an
// error to a later module that reads it through a string in an import
// type, so that no error traces to the fix and the gate halves. It runs
// --fix with the input's checkpoint and isolation thresholds and, when the
// input says so, stops the run as it builds a given program. Its oracle
// is fixGateRule's: every set of fixes the run verifies, which a stopped
// run leaves on disk (fix_keep.go), adds no error to the original; a fix
// the bound refuses is named by the bound's reason; and a run that
// finishes without reaching the bound writes and refuses exactly what a
// run without checkpoints or a bound does.
//
// The input is comma-separated key=value pairs (fixGateBoundsProject); a
// missing or malformed value takes its default, and every value is
// clamped, so a mutated input keeps a meaning.
func FuzzFixGateBounds(f *testing.F) {
	startShortBudget(f)
	for _, seed := range []string{
		"m=12,g=2,every=5,at=0,d=1,cp=16,iso=256",
		"m=24,g=1,every=3,at=1,d=1,cp=16,iso=32",
		"m=20,g=2,every=4,at=0,d=2,cp=32,iso=16",
		"m=16,g=3,every=6,at=2,d=3,cp=64,iso=64",
		"m=30,g=1,every=5,at=0,d=1,cp=16,iso=256,stop=20",
		"m=80,g=2,every=5,at=0,d=1,cp=16,iso=32",
	} {
		f.Add(seed)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		p := fixGateBoundsParse(input)
		if fuzz := flag.Lookup("test.fuzz"); fuzz != nil && fuzz.Value.String() != "" && p.m > fixGateBoundsFuzzModules {
			return
		}
		files := fixGateBoundsProject(p)
		toolsGuard(t, "FuzzFixGateBounds", func() {
			r := toolsCompile(t, w, "FuzzFixGateBounds", files)
			defer r.Remove()
			config := toolsConfig(w, r.Dir)
			if r.Program == nil || config == nil || len(config.Errors) > 0 {
				return
			}
			// The run is stopped as it builds its stop-th program: each
			// build reads plain.ts once.
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			plain := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(r.Dir, "plain.ts")))
			var builds atomic.Int64
			fs := fixGateBoundsFS{wrapvfs.Wrap(w.fs, wrapvfs.Replacements{ReadFile: func(name tspath.RootedFilePath) (string, bool) {
				if name == plain && builds.Add(1) == int64(p.stop) {
					cancel()
				}
				return w.fs.ReadFile(name)
			}}), w.fs}
			var sets []map[string]string
			var bounded *vibelang.FixResult
			toolsRun(t, "FuzzFixGateBounds", "fix", input, nil, func() {
				bounded = vibelang.FixProjectWithOptions(ctx, fs, bundled.LibPath(), config, vibelang.FixOptions{
					IsolationChecks: p.iso,
					CheckpointFirst: p.cp,
					Verified: func(texts map[tspath.RootedFilePath]string) {
						sets = append(sets, fixGateBoundsTexts(r.Dir, texts))
					},
				})
			})
			if bounded == nil {
				return
			}
			// Every set the run verified, as a stopped run would leave it on
			// disk, adds no error.
			seen := map[string]bool{}
			for i, set := range sets {
				key := Archive(set)
				if seen[key] {
					continue
				}
				seen[key] = true
				fixed := maps.Clone(files)
				maps.Copy(fixed, set)
				after := toolsCompile(t, w, "FuzzFixGateBounds", fixed)
				added := toolsAddedErrors(r, after)
				after.Remove()
				if len(added) > 0 {
					Gap(t, "FuzzFixGateBounds", "fix:verified-set-adds-error", "set %d of %d that --fix verified for %q adds %v\n%s", i+1, len(sets), input, added, Archive(fixed))
					return
				}
			}
			if ctx.Err() != nil {
				t.Logf("%q: stopped at program %d after %d verified sets", input, builds.Load(), len(sets))
				return
			}
			if bounded.Err != nil {
				return
			}
			// A reader of a refused fix makes the gate refuse one: when none
			// is refused, the project no longer has the shape this target
			// checks, as when VIP-1 ended the fix of an unmarked modes().
			if len(bounded.Refused) == 0 && slices.ContainsFunc(slices.Collect(maps.Values(files)), func(text string) bool { return strings.Contains(text, "[\"modes") }) {
				t.Fatalf("--fix refused no fix of %q, which has a reader of a refused fix; the generator no longer builds opencode's shape", input)
			}
			why := fmt.Sprintf(" the gate stopped telling apart after %d checks of its round; run vibelang --fix again to try them", p.iso)
			untold := 0
			for _, refusal := range bounded.Refused {
				if strings.Contains(refusal.Error, " the gate stopped telling apart after ") {
					untold++
					if !strings.HasSuffix(refusal.Error, why) || !strings.Contains(refusal.Error, ", one of the errors of ") {
						Gap(t, "FuzzFixGateBounds", "fix:bound-reason", "a fix refused at the bound for %q is named %q; want the round's first error and %q", input, refusal.Error, why)
						return
					}
				}
			}
			if untold > 0 {
				t.Logf("%q: %d fixes refused at the bound of %d checks", input, untold, p.iso)
				return
			}
			var unbounded *vibelang.FixResult
			toolsRun(t, "FuzzFixGateBounds", "fix-unbounded", input, nil, func() {
				unbounded = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{IsolationChecks: 1 << 30, CheckpointFirst: 1 << 30})
			})
			if unbounded == nil {
				return
			}
			if diff := fixGateDiff(bounded, unbounded); diff != "" {
				Gap(t, "FuzzFixGateBounds", "fix:bounds-change-outcome", "--fix with checkpoints from %d checks and a bound of %d changes the outcome of %q: %s\n%s", p.cp, p.iso, input, diff, Archive(files))
			}
		})
	})
}

// fixGateBoundsFuzzModules is the most modules a campaign tries. Within
// ends a fuzzing worker after HangLimit, 10 s, in one stage, and with
// coverage and four workers on 4 vCPU a --fix run of 160 modules took
// longer (2026-11-02). A seed run, VIBELANG_FUZZ_SEEDS=all included, still
// runs larger inputs, such as opencode's witness of 160 modules.
const fixGateBoundsFuzzModules = 32

// fixGateBoundsInput is a FuzzFixGateBounds input: m modules, each with g
// good fixes; a refused fix in each module whose index is at modulo every,
// read by the module d after it; the round's checks before its first
// checkpoint (cp) and its bound on checks (iso); and the program whose
// build stops the run, or 0 for none.
type fixGateBoundsInput struct {
	m, g, every, at, d, cp, iso, stop int
}

// fixGateBoundsParse reads input, with defaults and clamps: up to 160
// modules, opencode's witness's 352 fixes, and a stop at program 200 at
// most.
func fixGateBoundsParse(input string) fixGateBoundsInput {
	p := fixGateBoundsInput{m: 12, g: 2, every: 5, at: 0, d: 1, cp: 16, iso: 256}
	for _, pair := range strings.Split(input, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(pair), "=")
		n, err := strconv.Atoi(value)
		if !ok || err != nil {
			continue
		}
		switch key {
		case "m":
			p.m = n
		case "g":
			p.g = n
		case "every":
			p.every = n
		case "at":
			p.at = n
		case "d":
			p.d = n
		case "cp":
			p.cp = n
		case "iso":
			p.iso = n
		case "stop":
			p.stop = n
		}
	}
	clamp := func(n, low, high int) int { return min(max(n, low), high) }
	p.stop = clamp(p.stop, 0, 200)
	p.m = clamp(p.m, 2, 160)
	p.g = clamp(p.g, 0, 3)
	p.every = clamp(p.every, 2, 10)
	p.at = clamp(p.at, 0, p.every-1)
	p.d = clamp(p.d, 1, p.every-1)
	p.cp = clamp(p.cp, 1, 256)
	p.iso = clamp(p.iso, 8, 1024)
	return p
}

// fixGateBoundsProject writes the project p describes: modules
// m000.vibe to m<p.m-1>.vibe, each importing the one before it, a
// plain.ts that each build reads once, and a main.vibe.
func fixGateBoundsProject(p fixGateBoundsInput) map[string]string {
	files := map[string]string{"main.vibe": "export const main = 1\n", "plain.ts": "export const plain = 1\n"}
	for i := range p.m {
		var b strings.Builder
		if i == 0 {
			b.WriteString("export function f0(x: number): number { return x }\n")
		} else {
			fmt.Fprintf(&b, "import { f%d } from \"./m%03d.vibe\"\nexport function f%d(x: number): number { return f%d(x) + 1 }\n", i-1, i-1, i, i-1)
		}
		for k := range p.g {
			fmt.Fprintf(&b, "export type T%d_%d = Effect.Effect<number>\n", i, k)
		}
		if i%p.every == p.at {
			fmt.Fprintf(&b, "export effect function modes%d() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n", i)
		} else if j := i - p.d; j >= 0 && j%p.every == p.at {
			fmt.Fprintf(&b, "export const more%d: ReturnType<(typeof import(\"./m%03d.vibe\"))[\"modes%d\"]> extends (\"fast\"[]!!) ? false : true = true\n", i, j, j)
		}
		files[fmt.Sprintf("m%03d.vibe", i)] = b.String()
	}
	return files
}

// fixGateBoundsFS is a workspace's file system that counts builds and
// still shares the workspace's parsed library and package files, as the
// --fix runs of FuzzFixGate do.
type fixGateBoundsFS struct {
	vfs.FS
	shared vfs.FS
}

func (fs fixGateBoundsFS) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if shared, ok := fs.shared.(interface {
		GetSourceFile(ast.SourceFileParseOptions) *ast.SourceFile
	}); ok {
		return shared.GetSourceFile(opts)
	}
	return nil
}

// fixGateBoundsTexts names the texts of a verified set by their paths in
// the project dir.
func fixGateBoundsTexts(dir string, texts map[tspath.RootedFilePath]string) map[string]string {
	prefix := filepath.ToSlash(dir) + "/"
	named := map[string]string{}
	for name, text := range texts {
		named[strings.TrimPrefix(name.AsString(), prefix)] = text
	}
	return named
}

// TestFixGateBoundsProjectShape checks that the opencode witness's input
// describes its project: 160 modules with 352 fixes, 32 of which add an
// error to another file.
func TestFixGateBoundsProjectShape(t *testing.T) {
	p := fixGateBoundsParse("m=160,g=2,every=5,at=0,d=1,cp=16,iso=256,stop=60")
	files := fixGateBoundsProject(p)
	fixes, refused := 0, 0
	for _, text := range files {
		fixes += strings.Count(text, "Effect.Effect<number>") + strings.Count(text, "try Effect.succeed(\"fast\")")
		refused += strings.Count(text, "try Effect.succeed(\"fast\")")
	}
	readers := slices.DeleteFunc(slices.Collect(maps.Values(files)), func(text string) bool { return !strings.Contains(text, "[\"modes") })
	if p.m != 160 || p.stop != 60 || fixes != 352 || refused != 32 || len(readers) != 32 {
		t.Fatalf("%+v: %d fixes, %d refused, %d readers; want 160 modules, 352 fixes, 32 refused, 32 readers, stopped at 60", p, fixes, refused, len(readers))
	}
}
