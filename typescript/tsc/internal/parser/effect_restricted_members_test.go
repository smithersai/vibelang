package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestEffectRestrictedMembers(t *testing.T) {
	for _, source := range []string{
		"class C { effect get x() { return 1 } }",
		"class C { effect set x(v: number) {} }",
		"class C { effect constructor() {} }",
		"class C { effect constructor(value: number) {} }",
		"class C { effect constructor(value = 1) {} }",
		"class C { effect 'constructor'() {} }",
		"class C { static effect get x() { return 1 } }",
		"class C { private effect set x(v: number) {} }",
		"class C { effect /* prefix */ get ['x']() { return 1 } }",
		"const o = { effect get x() { return 1 } }",
		"const o = { effect set x(v: number) {} }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
			ds := file.Diagnostics()
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 104 {
				t.Fatalf("want exactly EK0104, got %v", ds)
			}
			if ds[0].Pos() != strings.Index(source, "effect") || source[ds[0].Pos():ds[0].End()] != "effect" {
				t.Fatalf("EK0104 must point to the prefix: %v", ds[0])
			}
			count := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if n.Kind == ast.KindGetAccessor || n.Kind == ast.KindSetAccessor || n.Kind == ast.KindConstructor {
					count++
					if n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
						t.Error("forbidden prefix created an Effect callable")
					}
				}
				if n.Kind == ast.KindPropertyDeclaration && n.Name() != nil && n.Name().Text() == "effect" {
					t.Error("prefix became an unrelated field")
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if count != 1 {
				t.Fatalf("want one recovered native member, got %d", count)
			}

		})
	}
}

func TestEffectRestrictedMemberControls(t *testing.T) {
	for _, source := range []string{
		"class C { effect() {} }",
		"class C { effect get() { return 1 } }",
		"class C { effect set(v: number) {} }",
		"class C { effect ['constructor']() {} }",
		"class C { effect 'constructor'<T>() {} }",
		"class C { effect = 1; get x() { return 1 } }",
		"class C { effect\nget x() { return 1 } }",
		"class C { effect /*\n*/ constructor() {} }",
		"class C { get effect() { return 1 } }",
		"const o = { effect constructor() {} }",
		"const o = { effect: 1, get x() { return 1 } }",
		"class C { constructor() {} }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				t.Fatal(file.Diagnostics())
			}
		})
	}
}

func TestEffectRestrictedMembersAsync(t *testing.T) {
	for _, source := range []string{
		"class C { async effect get x() { return 1 } }",
		"class C { async effect set x(v: number) {} }",
		"class C { async effect constructor() {} }",
		"const o = { async effect get x() { return 1 } }",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
		found := map[int32]int{}
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" {
				found[d.Code()]++
			}
		}
		if found[104] != 1 || found[105] != 1 {
			t.Errorf("%s: want EK0104 and EK0105, got %v", source, file.Diagnostics())
		}
	}
}
