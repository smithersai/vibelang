package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"slices"
	"testing"
)

func TestProducerYieldDoBackendMode(t *testing.T) {
	source := "effect function* p(){const{n=do{yield 9;7}}={} as {n?:number};yield n}"
	for _, test := range []struct {
		name   string
		mapper bool
		want   []int32
	}{
		{"native", false, nil}, {"mapper", true, []int32{parser.DoBoundaryCode}},
	} {
		t.Run(test.name, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe", VibeLangDoAsFunction: test.mapper}, source, core.ScriptKindTS)
			var got []int32
			for _, d := range file.Diagnostics() {
				got = append(got, d.Code())
			}
			slices.Sort(got)
			if !slices.Equal(got, test.want) {
				t.Fatalf("want %v got %v", test.want, got)
			}
		})
	}
}
