package vibelang

import (
	"fmt"
	stdmaps "maps"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// isolationProject writes a project of modules modules, each importing the
// one before it, with good fixes each that add no error. Every fifth module
// also holds a fix that adds an error to the module after it, which reads
// it through a string in an import type, so that no error traces to the
// fix (blameReads) and the gate halves, as scaleProject's hidden does: the
// shape of opencode's core, where 60 modules offered 361 fixes and 35 were
// refused (opencode-60). It returns the directory and the config.
func isolationProject(t testing.TB, modules, good int) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export const main = 1\n")
	dir := filepath.Dir(file.FileName().AsString())
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for i := range modules {
		var b strings.Builder
		if i == 0 {
			b.WriteString("export function f0(x: number): number { return x }\n")
		} else {
			fmt.Fprintf(&b, "import { f%d } from \"./m%03d.vibe\"\nexport function f%d(x: number): number { return f%d(x) + 1 }\n", i-1, i-1, i, i-1)
		}
		for k := range good {
			fmt.Fprintf(&b, "export type T%d_%d = Effect.Effect<number>\n", i, k)
		}
		if i%5 == 0 {
			fmt.Fprintf(&b, "export effect function modes%d() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n", i)
		} else if i%5 == 1 {
			fmt.Fprintf(&b, "export const more%d: ReturnType<(typeof import(\"./m%03d.vibe\"))[\"modes%d\"]> extends (\"fast\"[]!!) ? false : true = true\n", i, i-1, i-1)
		}
		write(fmt.Sprintf("m%03d.vibe", i), b.String())
	}
	write("plain.ts", "export const plain = 1\n")
	write("tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`)
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return dir, config
}

// 160 modules with 2 good fixes each: 352 fixes in round 1, 32 of which
// add an error to another file.
const isolationModules, isolationGood = 160, 2

// stopRound1 runs --fix on a fresh isolationProject, stops it with SIGTERM
// as it builds its at-th program, and returns the project's .vibe files
// before and after, and the run's stderr.
func stopRound1(t *testing.T, at int) (dir string, before, after map[string]string, stderr string) {
	t.Helper()
	dir, _ = isolationProject(t, isolationModules, isolationGood)
	before = vibeFiles(t, dir)
	ctx, stop := signal.NotifyContext(t.Context(), syscall.SIGTERM)
	defer stop()
	_, fs := countingFS(dir, func(n int) {
		if n != at {
			return
		}
		if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
			t.Error(err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(10 * time.Second):
			t.Error("the signal did not arrive")
		}
	})
	sys := &fixSys{fs: fs, cwd: dir}
	status := FixWithOptions(ctx, sys, []string{"-p", dir}, FixOptions{ProgressEvery: time.Millisecond})
	stop()
	fixRuns.Wait()
	stderr = sys.stderr.String()
	if status == 0 || !strings.Contains(stderr, "vibelang --fix: interrupted; ") || sys.stdout.Len() != 0 {
		t.Fatalf("status %d, stdout %q, stderr ends %q; want the run stopped", status, sys.stdout.String(), stderr[max(0, len(stderr)-400):])
	}
	if !strings.Contains(stderr, ": round 1: ") || strings.Contains(stderr, ": round 2: ") {
		t.Fatalf("stopped outside round 1: %q", stderr[max(0, len(stderr)-400):])
	}
	return dir, before, vibeFiles(t, dir), stderr
}

// A --fix run stopped in the middle of round 1 keeps the fixes the round
// has verified so far. The round halves its fixes in checks of the files
// that report errors, and it kept none before the last check of its
// halving: on opencode's core, 60 modules with 361 fixes, two runs of 40
// and 57 minutes ended "round 1: 0 fixes applied" and "no file written"
// (opencode-60, 2026-11-02). Without the halving's checkpoints, the same
// stop keeps nothing.
func TestFixKeepsARoundsVerifiedFixesWhenStopped(t *testing.T) {
	// The 60th program is in round 1's halving, which checks some 180.
	const at = 60
	t.Run("without checkpoints", func(t *testing.T) {
		defer func(n int) { fixCheckpointFirst = n }(fixCheckpointFirst)
		fixCheckpointFirst = 1 << 30
		_, before, after, stderr := stopRound1(t, at)
		if !stdmaps.Equal(before, after) || !strings.Contains(stderr, "interrupted; no file written.") {
			t.Fatalf("stderr ends %q; want no file written", stderr[max(0, len(stderr)-300):])
		}
	})
	dir, before, after, stderr := stopRound1(t, at)
	if !strings.Contains(stderr, "interrupted; kept the fixes it verified, in ") {
		t.Fatalf("stderr ends %q; want the run to keep its fixes", stderr[max(0, len(stderr)-300):])
	}
	fixed := 0
	for name, text := range after {
		fixed += strings.Count(before[name], "Effect.Effect<number>") - strings.Count(text, "Effect.Effect<number>")
	}
	t.Logf("stopped at program %d with %d of %d good fixes on disk", at, fixed, isolationModules*isolationGood)
	if fixed == 0 {
		t.Fatal("the stopped run kept no good fix")
	}
	// The files hold fixes a check of the whole program verified: the kept
	// program adds no error.
	disk := bundled.WrapFS(osvfs.FS())
	baseline := baselineOf(t.Context(), fixProgram(disk, bundled.LibPath(), keepConfig(t, dir), &fixParsedFiles{}, originalsIn(dir, before)))
	if added := addedErrors(t.Context(), fixProgram(disk, bundled.LibPath(), keepConfig(t, dir), &fixParsedFiles{}, nil), baseline); len(added) > 0 {
		t.Fatalf("the kept files add %v", added)
	}
	if matches, _ := filepath.Glob(filepath.Join(dir, ".*.fix-*")); len(matches) > 0 {
		t.Fatalf("left %v", matches)
	}
}

var roundChecks = regexp.MustCompile(`(?m)^vibelang --fix: \S+: round (\d+): .*; \d+ checks?, (\d+) this round`)

// A round stops telling apart the fixes that add errors once it has
// checked fixIsolationChecks programs: it refuses the fixes it has not
// told apart, together, named by the round's first error and the reason,
// and keeps the others it verified.
func TestFixBoundsTheChecksOfARound(t *testing.T) {
	defer func(n int) { fixIsolationChecks = n }(fixIsolationChecks)
	fixIsolationChecks = 60
	_, config := isolationProject(t, isolationModules, isolationGood)
	var progress strings.Builder
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{Progress: &progress, ProgressEvery: time.Millisecond})
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	most := 0
	for _, m := range roundChecks.FindAllStringSubmatch(progress.String(), -1) {
		n, err := strconv.Atoi(m[2])
		if err != nil {
			t.Fatal(err)
		}
		most = max(most, n)
	}
	// The trials under way when the round ran out, its last check of the
	// fixes it kept, and the next round's program.
	if most > fixIsolationChecks+8 {
		t.Errorf("a round checked %d programs; the bound is %d", most, fixIsolationChecks)
	}
	const why = " the gate stopped telling apart after 60 checks of its round; run vibelang --fix again to try them"
	untold := slices.DeleteFunc(slices.Clone(result.Refused), func(r FixRefusal) bool { return !strings.HasSuffix(r.Error, why) })
	if len(untold) == 0 || len(result.Order) == 0 {
		t.Fatalf("fixed %d files and refused %d fixes, %d untold; want some of each", len(result.Order), len(result.Refused), len(untold))
	}
	for _, r := range untold {
		if !strings.Contains(r.Error, ": TS2322: Type 'true' is not assignable to type 'false'., one of the errors of ") {
			t.Fatalf("refused %+v", r)
		}
	}
	t.Logf("%d checks at most in a round; %d files fixed, %d fixes refused, %d of them untold", most, len(result.Order), len(result.Refused), len(untold))
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if !strings.Contains(report.String(), " not fixed: the fixed program would report ") || !strings.Contains(report.String(), why+"\n") {
		t.Fatalf("report: %s", report.String())
	}
	// What it keeps adds no error.
	disk := bundled.WrapFS(osvfs.FS())
	baseline := baselineOf(t.Context(), fixProgram(disk, bundled.LibPath(), config, &fixParsedFiles{}, nil))
	texts := map[tspath.RootedFilePath]string{}
	for name, file := range result.Files {
		texts[name] = file.Text
	}
	if added := addedErrors(t.Context(), fixProgram(disk, bundled.LibPath(), config, &fixParsedFiles{}, texts), baseline); len(added) > 0 {
		t.Fatalf("the fixes kept add %v", added)
	}
}

// The checks a halving makes to write its fixes decide nothing, and an
// unreached bound changes nothing: a run with them keeps and refuses what
// a run without them does, and verifies more sets on the way.
func TestFixCheckpointsChangeNothing(t *testing.T) {
	run := func(first, bound int) (map[string]string, []string, int) {
		defer func(n, m int) { fixCheckpointFirst, fixIsolationChecks = n, m }(fixCheckpointFirst, fixIsolationChecks)
		fixCheckpointFirst, fixIsolationChecks = first, bound
		dir, config := isolationProject(t, 40, 2)
		sets := 0
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{Verified: func(map[tspath.RootedFilePath]string) { sets++ }})
		if result.Err != nil || len(result.Refused) != 8 {
			t.Fatalf("refused %d fixes, error %v; want the 8 that add errors", len(result.Refused), result.Err)
		}
		texts := map[string]string{}
		for name, file := range result.Files {
			texts[filepath.Base(name.AsString())] = file.Text
		}
		var refused []string
		for _, f := range result.Refused {
			refused = append(refused, fmt.Sprintf("%s:%d: %d: %s", filepath.Base(f.File.AsString()), f.Line, f.Code, strings.ReplaceAll(f.Error, dir, "")))
		}
		return texts, refused, sets
	}
	texts, refused, many := run(fixCheckpointFirst, fixIsolationChecks)
	alone, refusedAlone, few := run(1<<30, 1<<30)
	if !stdmaps.Equal(texts, alone) || !slices.Equal(refused, refusedAlone) {
		t.Fatalf("with checkpoints: %d files, refused %v; without: %d files, refused %v", len(texts), refused, len(alone), refusedAlone)
	}
	if many <= few {
		t.Fatalf("verified %d sets with checkpoints and %d without", many, few)
	}
	t.Logf("verified %d sets with checkpoints and %d without", many, few)
}
