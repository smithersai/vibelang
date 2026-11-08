package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestConcurrentClassHeadJumps(t *testing.T) {
	config := strings.Replace(editorTsconfig, `"noEmit":true`, `"noEmit":true,"allowUnusedLabels":false`, 1)
	heads := []string{
		"class C { [do { %; \"m\" }](){} }",
		"class C { @(do { %; ((v:unknown,c:unknown)=>{}) }) m(){} }",
		"@(do { %; ((v:unknown,c:unknown)=>{}) }) class C {}",
		"class C extends do { %; (class {}) } {}",
	}
	for _, limit := range []string{"", "(1)"} {
		for _, head := range heads {
			for _, jump := range []struct {
				source string
				code   int32
			}{{"break outer", 1903}, {"continue outer", 1905}} {
				source := "effect function f(){outer:for(const n of [1]){for concurrent" + limit + "(const m of [1]){" + strings.Replace(head, "%", jump.source, 1) + "}}}"
				t.Run(source, func(t *testing.T) {
					p, file, _, _ := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
					all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
					var codes []int32
					for _, d := range all {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, d.Code())
						}
					}
					if len(codes) != 1 || codes[0] != jump.code {
						t.Fatalf("want only %d, got %v", jump.code, codes)
					}
				})
			}
		}
	}
	for _, body := range []string{
		"class C { [do { local:{break local}; \"m\" }](){} }",
		"class C { [do { for(let i=0;i<1;i++){continue}; \"m\" }](){} }",
		"class C { m(){return 1} }",
	} {
		source := "effect function f(){for concurrent(const n of [1]){" + body + "}}"
		if errors := errorsOf(t, source); len(errors) != 0 {
			t.Fatalf("local control: %v in %s", errors, source)
		}
	}
}

// A nested stream item keeps ownership of its outward jumps (VIP-20).
// The enclosing concurrent item must neither accept them nor claim them.
func TestConcurrentClassHeadForTryIsolation(t *testing.T) {
	for _, jump := range []string{"break outer", "continue outer"} {
		source := "effect function f(){outer:for(const n of [1]){for concurrent(const m of [1]){for try(const k of Stream.make(1)){class C { [do { " + jump + "; \"m\" }](){} }}}}}"
		t.Run(jump, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
			var codes []int32
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
					if d.Code() == 1903 || d.Code() == 1905 {
						t.Fatalf("the nested for try owns this jump: %v", all)
					}
				}
			}
			if len(codes) == 0 {
				t.Fatal("accepted a jump out of a for try item")
			}
		})
	}
}
