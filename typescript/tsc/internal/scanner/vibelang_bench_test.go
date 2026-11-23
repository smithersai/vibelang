package scanner

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func syntheticVibeSource(modules int) string {
	var b strings.Builder
	b.Grow(modules * 900)
	for i := range modules {
		fmt.Fprintf(&b, `export error Missing%d { id: string }
export error Busy%d

export interface Item%d { id: string; value: number }

export schema Rec%d {
  id: string
  count: number
  tag?: "a" | "b"
}

export service Store%d {
  get(id: string): Item%d!Missing%d
  size: number
}

export const Store%dLive = Layer.effect(Store%d, effect {
  const items = new Map<string, Item%d>([["k1", { id: "k1", value: %d }]])
  return {
    effect get(id: string): Item%d!Missing%d {
      const item = items.get(id)
      if (item === undefined) throw new Missing%d({ id })
      return item
    },
    size: 1
  }
})

export effect function run%d(id: string): number!Missing%d!Store%d {
  const store = try Store%d
  const item = (store.get(id) |> Effect.map(%%, (v) => v.value + 1)) catch (e) => match (e) {
    when Missing%d: 0;
  }
  const left = fork effect { return item + 1 }
  const right = fork effect { return item + 2 }
  return (join left) + (join right)
}
`, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i)
	}
	return b.String()
}

func BenchmarkScannerVibeLang(b *testing.B) {
	for _, size := range []struct {
		name    string
		modules int
	}{
		{"Small_1mod", 1},
		{"Medium_25mod", 25},
		{"Large_100mod", 100},
	} {
		src := syntheticVibeSource(size.modules)
		b.Run(size.name, func(b *testing.B) {
			b.SetBytes(int64(len(src)))
			b.ReportAllocs()
			s := NewScanner()
			for b.Loop() {
				s.SetText(src)
				count := 0
				for s.Scan() != ast.KindEndOfFile {
					count++
				}
				if count == 0 {
					b.Fatal("expected tokens")
				}
			}
		})
	}
}
