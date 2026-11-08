package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestEffectBlockClassHeadJumps(t *testing.T) {
	for _, head := range []struct {
		key, source string
		want        []int32
	}{
		{"computed-method", "class C { [do { %; \"m\" }](){} }", []int32{202}},
		{"computed-field", "class C { [do { %; \"m\" as const }]=0 }", []int32{202, 1166}},
		{"member-decorator", "class C { @(do { %; ((v:unknown,c:unknown)=>{}) }) m(){} }", []int32{202}},
		{"class-decorator", "@(do { %; ((v:unknown,c:unknown)=>{}) }) class C {}", []int32{202}},
		{"heritage", "class C extends do { %; (class {}) } {}", []int32{202}},
		{"object-method", "const object = { [do { %; \"m\" }](){} }", []int32{202}},
	} {
		for _, jump := range []string{"break outer", "continue outer"} {
			source := "effect function f(){outer:for(const n of [1]){const e=effect {" + strings.Replace(head.source, "%", jump, 1) + "};}}"
			t.Run(head.key+"/"+jump, func(t *testing.T) {
				p, file, _, _ := editorProgram(t, source)
				all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
				var codes []int32
				for _, d := range all {
					if d.Category() == diagnostics.CategoryError {
						codes = append(codes, d.Code())
					}
				}
				slices.Sort(codes)
				if !slices.Equal(codes, head.want) {
					t.Fatalf("want %v, got %v", head.want, codes)
				}
			})
		}
	}
}

func TestEffectBlockClassHeadLocalJumps(t *testing.T) {
	for _, source := range []string{
		"effect function f(){const e=effect {class C { [do { local:{break local}; \"m\" }](){} }}}",
		"effect function f(){const e=effect {class C { [do { for(let i=0;i<1;i++){continue}; \"m\" }](){} }}}",
		"effect function f(){const e=effect {class C { m(){local:{break local};return 1} }}}",
	} {
		if errors := errorsOf(t, source); len(errors) != 0 {
			t.Fatalf("local source context: %v in %s", errors, source)
		}
	}
}

func TestEffectBlockNestedItemJumpOwnership(t *testing.T) {
	for _, loop := range []struct {
		head                    string
		breakCode, continueCode int32
	}{
		{"for try(const k of Stream.make(1))", 2003, 2003},
		{"for concurrent(const k of [1])", 1903, 1905},
	} {
		for _, jump := range []struct {
			source string
			code   int32
		}{{"break outer", loop.breakCode}, {"continue outer", loop.continueCode}} {
			source := "effect function f(){const e=effect {outer:for(const n of [1]){" + loop.head + "{" + jump.source + ";}}}}"
			p, file, _, _ := editorProgram(t, source)
			all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
			var codes []int32
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			if len(codes) != 1 || codes[0] != jump.code {
				t.Fatalf("item owns its jump: want %d, got %v in %s", jump.code, codes, source)
			}
		}
	}
}
