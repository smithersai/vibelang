package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func benchVibeSource(modules int, jsx bool) string {
	var b strings.Builder
	b.Grow(modules * 1000)
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

export effect function run%d(id: string): number!!Store%d {
  const store = try Store%d
  const value = (store.get(id) |> Effect.map(%%, (v) => v.value + 1)) catch (e) => match (e) {
    when Missing%d: 0;
  }
  const left = fork effect { return value + 1 }
  const right = fork effect { return value + 2 }
  return (join left) + (join right)
}
`, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i, i)
		if jsx {
			fmt.Fprintf(&b, `export function View%d(props: { count: number }) {
  return <section data-id="%d"><span>{props.count}</span></section>
}
`, i, i)
		}
	}
	return b.String()
}

func BenchmarkParserVibeLang(b *testing.B) {
	cases := []struct {
		name    string
		file    string
		kind    core.ScriptKind
		modules int
		jsx     bool
	}{
		{"Vibe_Small_1mod", "/bench/small.vibe", core.ScriptKindTS, 1, false},
		{"Vibe_Medium_20mod", "/bench/medium.vibe", core.ScriptKindTS, 20, false},
		{"Vibe_Large_80mod", "/bench/large.vibe", core.ScriptKindTS, 80, false},
		{"Vibex_Medium_20mod", "/bench/medium.vibex", core.ScriptKindTSX, 20, true},
	}
	for _, tc := range cases {
		src := benchVibeSource(tc.modules, tc.jsx)
		opts := ast.SourceFileParseOptions{
			FileName: tspath.RootedFilePath(tc.file),
			PathKey:  tspath.PathKey(tc.file),
		}
		if sf := parser.ParseSourceFile(opts, src, tc.kind); len(sf.Diagnostics()) != 0 {
			b.Fatalf("%s: unexpected parse diagnostics: %v", tc.name, sf.Diagnostics()[0].String())
		}
		b.Run(tc.name, func(b *testing.B) {
			b.SetBytes(int64(len(src)))
			b.ReportAllocs()
			for b.Loop() {
				sf := parser.ParseSourceFile(opts, src, tc.kind)
				if len(sf.Statements.Nodes) == 0 {
					b.Fatal("empty AST")
				}
			}
		})
	}
}
