package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
)

func TestSignatureHelpInsideMatchNeverPanics(t *testing.T) {
	cases := map[string]string{
		"return and const match": `export function f(d: "a" | "b") {
  return match (d) { when "a": 1; default: 0; }
}
export function g(d: "a" | "b") {
  const t = match (d) { when "a": String(1); default: "0"; }
  return t
}
`,
		"statement match with array patterns": `function* two() { yield 1; yield 2 }
match (two()) { when [let a]: a; when [let a, let b]: a + b; default: 0; }
`,
		"match with extractor and object patterns": `declare const Outcome: { Ok(v: unknown): [number] | undefined }
export function h(x: unknown) {
  return match (x) {
    when Outcome.Ok(let ok): ok;
    when { a: "x", b: [let y] }: y;
    default: 0;
  }
}
`,
	}

	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			_, file, service, converters := editorProgram(t, source)
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			for offset := 0; offset <= len(source); offset++ {
				pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
				if _, err := service.ProvideSignatureHelp(t.Context(), uri, pos, nil); err != nil {
					t.Fatalf("ProvideSignatureHelp error at offset %d (%d:%d): %v", offset, pos.Line+1, pos.Character+1, err)
				}
			}
		})
	}
}
