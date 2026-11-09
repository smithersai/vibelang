package parser_test

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// A written abstract modifier on a service declaration is TypeScript's own
// modifier error (TS1042) at that modifier, in both service forms. The
// parser's synthesized abstract modifier never produces TS1030 against it.
func TestServiceAbstractModifier(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		codes        []int32
	}{
		{"body", "abstract service S { static readonly key = \"m/S\"; n: number }", []int32{1042}},
		{"exported body", "export abstract service S { static readonly key = \"m/S\"; n: number }", []int32{1042}},
		{"whole shape", "abstract service S: { n: number } { static readonly key = \"m/S\" }", []int32{1042}},
		{"declare", "declare abstract service S { static readonly key = \"m/S\"; n: number }", []int32{907, 1042}},
		{"control", "export service S { static readonly key = \"m/S\"; n: number }", nil},
		{"abstract class", "export abstract class S { abstract n: number }", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			name := "/main.vibe"
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, tc.source, core.ScriptKindTS)
			var got []int32
			for _, d := range file.Diagnostics() {
				got = append(got, d.Code())
			}
			slices.Sort(got)
			if !slices.Equal(got, tc.codes) {
				t.Fatalf("want codes %v, got %v", tc.codes, got)
			}
			for _, d := range file.Diagnostics() {
				if d.Code() == 1042 && file.Text()[d.Loc().Pos():d.Loc().End()] != "abstract" {
					t.Fatalf("TS1042 should name the written modifier, got %q", file.Text()[d.Loc().Pos():d.Loc().End()])
				}
			}
		})
	}
}
