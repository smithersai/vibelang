package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// scaleProject writes a project of n modules, each importing the one
// before it, with a fix each that adds no error. Every fifth module also
// holds a Match chain whose fix holds the error it adds, and every tenth a
// fix that adds an error to the module after it (fixFiles' modes and
// more): about a third of the fixes are refused, in proportion to n, as
// in a package whose modules were just renamed to .vibe.
func scaleProject(t testing.TB, n int) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export const main = 1\n")
	dir := filepath.Dir(file.FileName().AsString())
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for i := range n {
		var b strings.Builder
		if i == 0 {
			b.WriteString("export function f0(x: number): number { return x }\n")
		} else {
			fmt.Fprintf(&b, "import { f%d, type T%d } from \"./m%03d.vibe\"\n", i-1, i-1, i-1)
			fmt.Fprintf(&b, "export function f%d(x: number): number { return f%d(x) + 1 }\nexport type U%d = T%d\n", i, i-1, i, i-1)
		}
		fmt.Fprintf(&b, "export type T%d = Effect.Effect<number>\n", i)
		if i%5 == 1 {
			b.WriteString(strings.Replace(refusedMatchChain, "function kind", fmt.Sprintf("function kind%d", i), 1))
		}
		if i%10 == 2 {
			fmt.Fprintf(&b, "export function modes%d() {\n  const mode = Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n", i)
		}
		if i%10 == 3 {
			fmt.Fprintf(&b, "import { modes%d } from \"./m%03d.vibe\"\nexport function more%d() {\n  const all = modes%d()\n  all.push(\"slow\")\n  return all\n}\n", i-1, i-1, i, i-1)
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

// A scaleRun is the cost of one --fix run of a scaleProject.
type scaleRun struct {
	wall     time.Duration
	programs int
	alloc    uint64 // bytes allocated
	peak     uint64 // highest heap in use
}

func fixScaleRun(t *testing.T, n int) scaleRun {
	t.Helper()
	dir, config := scaleProject(t, n)
	builds, fs := countingFS(dir, func(int) {})
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	var peak atomic.Uint64
	stop, sampled := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(sampled)
		var m runtime.MemStats
		for {
			runtime.ReadMemStats(&m)
			peak.Store(max(peak.Load(), m.HeapInuse))
			select {
			case <-stop:
				return
			case <-time.After(10 * time.Millisecond):
			}
		}
	}()
	start := time.Now()
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	wall := time.Since(start)
	close(stop)
	<-sampled
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	if result.Err != nil || len(result.Order) != n || len(result.Refused) != n/5+n/10 {
		t.Fatalf("%d modules: fixed %d files, refused %d, error %v; want %d files and %d refusals", n, len(result.Order), len(result.Refused), result.Err, n, n/5+n/10)
	}
	return scaleRun{wall, *builds, after.TotalAlloc - before.TotalAlloc, peak.Load()}
}

// The cost of --fix grows with the project about as fast as one check of
// it does: four times the modules, and four times the refusals, take less
// than six times the time and memory. Each fix that added an error to
// another file cost a check of the whole program to find, so the checks
// grew with the refusals and each with the files: 60 modules took 0.9 s
// and 24 programs, 240 took 6.5 s and 78 (2026-11-01).
func TestFixScalesWithTheProject(t *testing.T) {
	const small, large = 60, 240
	// The fastest of two runs of each, taken in turn, so that a busy
	// host's load weighs on both.
	var a, b scaleRun
	for i := range 2 {
		ra, rb := fixScaleRun(t, small), fixScaleRun(t, large)
		if i == 0 || ra.wall < a.wall {
			a.wall = ra.wall
		}
		if i == 0 || rb.wall < b.wall {
			b.wall = rb.wall
		}
		a.programs, a.alloc, a.peak = ra.programs, ra.alloc, ra.peak
		b.programs, b.alloc, b.peak = rb.programs, rb.alloc, rb.peak
	}
	t.Logf("%d modules: %v, %d programs, %d MB allocated, %d MB peak heap", small, a.wall, a.programs, a.alloc>>20, a.peak>>20)
	t.Logf("%d modules: %v, %d programs, %d MB allocated, %d MB peak heap", large, b.wall, b.programs, b.alloc>>20, b.peak>>20)
	ratio := func(x, y float64) float64 { return x / y }
	if r := ratio(float64(b.programs), float64(a.programs)); r > 1.5 {
		t.Errorf("--fix built %d programs for %d modules and %d for %d: %.1fx", b.programs, large, a.programs, small, r)
	}
	if r := ratio(b.wall.Seconds(), a.wall.Seconds()); r >= 6 {
		t.Errorf("--fix took %v for %d modules and %v for %d: %.1fx", b.wall, large, a.wall, small, r)
	}
	if r := ratio(float64(b.alloc), float64(a.alloc)); r >= 6 {
		t.Errorf("--fix allocated %d MB for %d modules and %d MB for %d: %.1fx", b.alloc>>20, large, a.alloc>>20, small, r)
	}
	if r := ratio(float64(b.peak), float64(a.peak)); r >= 6 {
		t.Errorf("--fix peaked at %d MB of heap for %d modules and %d MB for %d: %.1fx", b.peak>>20, large, a.peak>>20, small, r)
	}
}
