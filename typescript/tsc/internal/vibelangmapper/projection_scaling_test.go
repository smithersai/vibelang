package vibelangmapper

import (
	"fmt"
	"runtime"
	"strings"
	"testing"
	"time"
)

// projectionScalingShapes are the three file shapes of issue #517: n
// one-line functions that are plain, effectful, or plain calls of the
// function before.
var projectionScalingShapes = []struct {
	name string
	line func(i int) string
}{
	{"plain", func(i int) string {
		return fmt.Sprintf("function g%d(a: number) { const b = a * 2; return b + 1 }\n", i)
	}},
	{"effect", func(i int) string {
		return fmt.Sprintf("effect function h%d(a: number) { const b = try succeed(a); return b + 1 }\n", i)
	}},
	{"calls", func(i int) string {
		if i == 0 {
			return "function f0(a: number) { const b = a * 2; return b + 1 }\n"
		}
		return fmt.Sprintf("function f%d(a: number) { const b = f%d(a); return b + 1 }\n", i, i-1)
	}},
}

func projectionScalingSource(line func(int) string, n int) string {
	var b strings.Builder
	for i := range n {
		b.WriteString(line(i))
	}
	return b.String()
}

func projectionTime(src string) time.Duration {
	runtime.GC()
	start := time.Now()
	Project(src, testContext)
	return time.Since(start)
}

// TestProjectionScalesNearLinearly guards issue #517: doubling the number of
// top-level functions must not much more than double projection time. Each
// size takes the fastest of interleaved runs, after a warm-up, to keep
// scheduler and collector noise out of the ratio.
func TestProjectionScalesNearLinearly(t *testing.T) {
	const n, runs = 2000, 5
	for _, shape := range projectionScalingShapes {
		t.Run(shape.name, func(t *testing.T) {
			small := projectionScalingSource(shape.line, n)
			large := projectionScalingSource(shape.line, 2*n)
			if proj := Project(small, testContext); len(proj.Diagnostics) != 0 {
				t.Fatalf("N=%d projection diagnostics: %v", n, proj.Diagnostics[:1])
			}
			Project(large, testContext)
			ts, tl := time.Duration(1<<62), time.Duration(1<<62)
			for range runs {
				ts = min(ts, projectionTime(small))
				tl = min(tl, projectionTime(large))
			}
			ratio := float64(tl) / float64(ts)
			t.Logf("N=%d %v, N=%d %v, ratio %.2f", n, ts, 2*n, tl, ratio)
			if ratio > 2.5 {
				t.Errorf("N=%d took %v, N=%d took %v: ratio %.2f > 2.5", n, ts, 2*n, tl, ratio)
			}
		})
	}
}
