package vibelangestree

import (
	"fmt"
	"strings"
	"testing"
)

func benchEstreeSource(modules int, jsx bool) string {
	var b strings.Builder
	b.Grow(modules * 900)
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

export effect function load%d(id: string): number!!Store%d {
  const store = try Store%d
  const n = (store.get(id) |> Effect.map(%%, (v) => v + 1)) catch (e) => match (e) {
    when Missing%d: 0;
  }
  const f = fork effect { return n * 2 }
  return join f
}
`, i, i, i, i, i, i, i, i)
		if jsx {
			fmt.Fprintf(&b, `export function Card%d(props: { label: string }) {
  return <div className="card"><span>{props.label}</span></div>
}
`, i)
		}
	}
	return b.String()
}

func BenchmarkEstreeParse(b *testing.B) {
	for _, tc := range []struct {
		name    string
		file    string
		modules int
		jsx     bool
	}{
		{"Vibe_Small_1mod", "small.vibe", 1, false},
		{"Vibe_Medium_15mod", "medium.vibe", 15, false},
		{"Vibe_Large_50mod", "large.vibe", 50, false},
		{"Vibex_Medium_15mod", "medium.vibex", 15, true},
	} {
		src := benchEstreeSource(tc.modules, tc.jsx)
		if out, err := Parse(tc.file, src); err != nil || len(out) == 0 {
			b.Fatalf("%s: Parse failed: %v", tc.name, err)
		}
		b.Run(tc.name, func(b *testing.B) {
			b.SetBytes(int64(len(src)))
			b.ReportAllocs()
			for b.Loop() {
				out, err := Parse(tc.file, src)
				if err != nil || len(out) == 0 {
					b.Fatalf("Parse failed: %v", err)
				}
			}
		})
	}
}
