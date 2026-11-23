package vibelangmapper

import (
	"fmt"
	"strings"
	"testing"
)

func benchMapperSource(modules int) string {
	var b strings.Builder
	b.Grow(modules * 800)
	for i := range modules {
		fmt.Fprintf(&b, `export error Missing%d { id: string }

export schema Rec%d {
  id: string
  count: number
  tag?: "a" | "b"
}

export service Store%d {
  get(id: string): number!Missing%d
  size: number
}

export effect function load%d(id: string) {
  const store = try Store%d
  const v = store.get(id) catch (e) => match (e) {
    when Missing%d: 0;
  }
  return v + %d
}
`, i, i, i, i, i, i, i, i)
	}
	return b.String()
}

func BenchmarkMapperProjectAndEmit(b *testing.B) {
	for _, tc := range []struct {
		name    string
		modules int
	}{
		{"Small_1mod", 1},
		{"Medium_15mod", 15},
		{"Large_50mod", 50},
	} {
		src := benchMapperSource(tc.modules)
		if proj := Project(src, testContext); len(proj.Diagnostics) != 0 || len(proj.Text) == 0 {
			b.Fatalf("%s: Project failed: %v", tc.name, proj.Diagnostics)
		}
		if js, _, ds := Emit(src, testContext); len(ds) != 0 || len(js) == 0 {
			b.Fatalf("%s: Emit failed: %v", tc.name, ds)
		}
		b.Run("Project_"+tc.name, func(b *testing.B) {
			b.SetBytes(int64(len(src)))
			b.ReportAllocs()
			for b.Loop() {
				proj := Project(src, testContext)
				if len(proj.Text) == 0 {
					b.Fatal("empty projection")
				}
			}
		})
		b.Run("Emit_"+tc.name, func(b *testing.B) {
			b.SetBytes(int64(len(src)))
			b.ReportAllocs()
			for b.Loop() {
				js, _, ds := Emit(src, testContext)
				if len(ds) != 0 || len(js) == 0 {
					b.Fatalf("Emit failed: %v", ds)
				}
			}
		})
	}
}
