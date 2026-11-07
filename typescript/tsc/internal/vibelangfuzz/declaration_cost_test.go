package vibelangfuzz

import (
	"encoding/json"
	"os"
	"runtime"
	"runtime/pprof"
	"strings"
	"testing"
	"time"
)

// Cost records contain only input names, sizes, stage names and resource
// counters. They never include source text, paths or diagnostics.
func declarationCostRecord(name, stage string, fields map[string]any) {
	path := os.Getenv("VIBELANG_FUZZ_BUDGET_LOG")
	if path == "" || !strings.HasPrefix(name, "FuzzDeclarationIdentity") {
		return
	}
	fields["test"], fields["stage"] = name, stage
	data, err := json.Marshal(fields)
	if err != nil {
		return
	}
	file, err := os.OpenFile(path+".declaration.jsonl", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return
	}
	_, _ = file.Write(append(data, '\n'))
	_ = file.Close()
}
func startDeclarationCost(f *testing.F) {
	var initial runtime.MemStats
	runtime.ReadMemStats(&initial)
	started := time.Now()
	if path := os.Getenv("VIBELANG_FUZZ_BUDGET_LOG"); path != "" {
		file, err := os.Create(path + ".declaration.pprof")
		if err == nil {
			if err = pprof.StartCPUProfile(file); err == nil {
				f.Cleanup(func() { pprof.StopCPUProfile(); _ = file.Close() })
			} else {
				_ = file.Close()
			}
		}
	}
	f.Cleanup(func() {
		var final runtime.MemStats
		runtime.ReadMemStats(&final)
		declarationCostRecord(f.Name(), "summary", map[string]any{
			"wall_seconds":     time.Since(started).Seconds(),
			"allocated_bytes":  final.TotalAlloc - initial.TotalAlloc,
			"gc_cycles":        final.NumGC - initial.NumGC,
			"gc_pause_seconds": float64(final.PauseTotalNs-initial.PauseTotalNs) / 1e9,
			"heap_alloc_bytes": final.HeapAlloc, "heap_inuse_bytes": final.HeapInuse,
			"gc_cpu_fraction": final.GCCPUFraction,
		})
	})
}

type declarationCost struct {
	t           *testing.T
	start, last time.Time
	stageName   string
}

func newDeclarationCost(t *testing.T, archive string) *declarationCost {
	now := time.Now()
	declarationCostRecord(t.Name(), "input", map[string]any{"input": SeedName(archive), "input_bytes": len(archive)})
	return &declarationCost{t: t, start: now, last: now, stageName: "compile"}
}
func (c *declarationCost) stage(name string) {
	declarationCostRecord(c.t.Name(), name, map[string]any{"wall_seconds": time.Since(c.last).Seconds()})
	c.last = time.Now()
	c.stageName = name
}
func (c *declarationCost) finish() {
	declarationCostRecord(c.t.Name(), "complete", map[string]any{"wall_seconds": time.Since(c.start).Seconds(), "last_stage": c.stageName, "failed": c.t.Failed(), "skipped": c.t.Skipped()})
}
