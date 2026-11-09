package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-21: `return value` in a producer is EK2128 wherever the return is
// written. A do expression in a computed member name, a heritage clause or a
// decorator is still compiled to a function, and its valued return used to
// report that compiler gap (EK0204) instead of the producer rule.
func TestProducerHeadValueReturn(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         []int32
	}{
		{"method-key", "effect function* p(){class C{[do{return \"m\";\"m\"}](){}}}", []int32{2128}},
		{"static-method-key", "effect function* p(){class C{static [do{return \"m\";\"m\"}](){}}}", []int32{2128}},
		{"getter-key", "effect function* p(){class C{get [do{return \"m\";\"m\"}](){return 0}}}", []int32{2128}},
		{"setter-key", "effect function* p(){class C{set [do{return \"m\";\"m\"}](n:number){}}}", []int32{2128}},
		{"field-key", "effect function* p(){class C{[do{return \"m\";\"m\"}]=0}}", []int32{2128}},
		{"heritage", "effect function* p(){class C extends do{return(class{});(class{})}{}}", []int32{2128}},
		{"class-decorator", "effect function* p(){const d=(v:unknown,c:unknown)=>{};@(do{return d;d})class C{}}", []int32{2128}},
		{"method-decorator", "effect function* p(){const d=(v:unknown,c:unknown)=>{};class C{@(do{return d;d})m(){}}}", []int32{2128}},
		{"field-decorator", "effect function* p(){const d=(v:unknown,c:unknown)=>{};class C{@(do{return d;d})n=0}}", []int32{2128}},
		{"getter-decorator", "effect function* p(){const d=(v:unknown,c:unknown)=>{};class C{@(do{return d;d})get n(){return 0}}}", []int32{2128}},
		{"setter-decorator", "effect function* p(){const d=(v:unknown,c:unknown)=>{};class C{@(do{return d;d})set n(n:number){}}}", []int32{2128}},
		{"object-method", "effect function* p(){const o={[do{return \"m\";\"m\"}](){}}}", []int32{2128}},
		{"object-getter", "effect function* p(){const o={get [do{return \"m\";\"m\"}](){return 0}}}", []int32{2128}},
		{"object-setter", "effect function* p(){const o={set [do{return \"m\";\"m\"}](n:number){}}}", []int32{2128}},
		{"producer-method", "class H{effect *p(){class C{[do{return \"m\";\"m\"}](){}}}}", []int32{2128}},
		{"producer-expression", "const p=effect function*(){class C{[do{return \"m\";\"m\"}](){}}}", []int32{2128}},
		// The producer's own returns are reported in the same run.
		{"with-own-return", "effect function* p(){class C{[do{return \"m\";\"m\"}](){}};return 1}", []int32{2128, 2128}},
		// Written callables and other owners keep their own rules.
		{"written-method", "effect function* p(){class C{m(){return 1}}}", []int32{}},
		{"written-parameter", "effect function* p(){class C{m(n:number=do{return 1}){return n}}}", []int32{}},
		{"nested-effect", "effect function* p(){class C{[do{const p=effect{return 1};\"m\"}](){}}}", []int32{}},
		{"nested-arrow", "effect function* p(){class C{[do{const f=()=>{return 1};\"m\"}](){}}}", []int32{}},
		{"nested-producer", "effect function* p(){class C{effect *m(){return 1}}}", []int32{2128}},
		{"effect-function", "effect function p(){class C{[do{return \"m\";\"m\"}](){}}}", []int32{204}},
		{"plain-generator", "function* p(){class C{[do{return \"m\";\"m\"}](){}}}", []int32{204}},
		{"concurrent-owner", "effect function* p(){for concurrent(const x of [1]){class C{[do{return \"m\";\"m\"}](){}}}}", []int32{1904}},
		{"stream-owner", "effect function* p(){for try(const x of Stream.make(1)){class C{[do{return \"m\";\"m\"}](){}}}}", []int32{2002}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			ds := append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...)
			got := []int32{}
			for _, d := range ds {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			slices.Sort(got)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("want %v got %v in %s", tc.want, got, tc.source)
			}
		})
	}
}

// VIP-21 allows a bare return, so it never reports EK2128, whatever the
// compiler does with the do expression around it.
func TestProducerHeadBareReturn(t *testing.T) {
	for _, source := range []string{
		"effect function* p(){class C{[do{return;\"m\"}](){}}}",
		"effect function* p(){class C{[do{if(Math.random()>2)return;\"m\"}](){}}}",
		"effect function* p(){@(do{if(Math.random()>2)return;(v:unknown,c:unknown)=>{}})class C{}}",
	} {
		p, f, _, _ := editorProgram(t, source)
		var got []int32
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				got = append(got, d.Code())
			}
		}
		t.Logf("%v in %s", got, source)
		if slices.Contains(got, EK2128.Code) {
			t.Errorf("a bare return reports EK2128: %v in %s", got, source)
		}
	}
}

// The parser's report names the value, as the checker's does, and both
// do-lowering modes give it.
func TestProducerHeadValueReturnText(t *testing.T) {
	source := "effect function* p(){class C{[do{return 7;\"m\"}](){}}}"
	for _, mapper := range []bool{false, true} {
		f := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe", VibeLangDoAsFunction: mapper}, source, core.ScriptKindTS)
		ds := f.Diagnostics()
		if len(ds) != 1 || ds[0].Code() != parser.ProducerReturnValueCode {
			t.Fatalf("mapper=%t want one EK2128, got %v", mapper, ds)
		}
		d := ds[0]
		if at := strings.Index(source, "7"); d.Pos() != at || d.End() != at+1 {
			t.Errorf("mapper=%t EK2128 covers %d..%d, want the value at %d", mapper, d.Pos(), d.End(), at)
		}
		if !strings.Contains(d.String(), "so 7 would be dropped") {
			t.Errorf("mapper=%t EK2128 says %q", mapper, d.String())
		}
	}
	if !recoverableSyntaxCodes[EK2128.Code] {
		t.Error("EK2128 from the parser must not hide the file's semantic diagnostics")
	}
}
