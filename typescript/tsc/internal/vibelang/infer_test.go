package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func TestEffectInfoOrderedSets(t *testing.T) {
	program, file, _, _ := editorProgram(t, "function f() {}\nfunction g() {}\n")
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	first, second := file.Statements.Nodes[0], file.Statements.Nodes[1]
	one, two := c.GetStringLiteralType("one"), c.GetStringLiteralType("two")
	info := &effectInfo{}
	for _, typ := range []*checker.Type{nil, c.GetNeverType(), one, one, two, one} {
		info.addError(typ, first)
		info.addRequirement(typ, first)
	}
	other := &effectInfo{}
	other.addError(one, second)
	other.addRequirement(two, second)
	info.add(other)
	info.addFrom(other, second)
	if len(info.errors) != 2 || len(info.requirements) != 2 {
		t.Fatalf("want two distinct types in each channel, got %d errors, %d requirements", len(info.errors), len(info.requirements))
	}
	for i, typ := range []*checker.Type{one, two} {
		if info.errors[i] != typ || info.requirements[i] != typ || info.errorSources[i] != first || info.requirementSources[i] != first {
			t.Fatal("channels did not retain first-occurrence order and source")
		}
	}
	// Filtering and copying must not share their mutable membership maps.
	copied := withoutRequirement(c, info, one)
	copied.addError(c.GetNumberType(), second)
	info.addError(c.GetNumberType(), first)
	if len(info.errors) != 3 || len(copied.errors) != 3 {
		t.Fatal("copied channels share mutable membership")
	}
}

// The same channels pass through function calls, written contracts,
// methods, and try/finally joins. Cached callees must stay bounded, even when
// every caller runs them twice.
func TestInferredChannelsMemoized(t *testing.T) {
	for _, form := range []string{"function", "contract", "method"} {
		t.Run(form, func(t *testing.T) {
			var source strings.Builder
			source.WriteString("error Missing\nservice Need { value(): number!! }\n")
			if form == "method" {
				source.WriteString("export class Chain {\n")
			}
			for i := 0; i < 12; i++ {
				prefix, annotation, receiver := "export function ", "", ""
				if form == "method" {
					prefix, receiver = "", "this."
				}
				if form == "contract" {
					annotation = ": number!Missing!Need"
				}
				fmt.Fprintf(&source, "%sf%d(x: number)%s { ", prefix, i, annotation)
				if i == 0 {
					source.WriteString("if (x < 0) throw new Missing(); return Need.value()")
				} else {
					fmt.Fprintf(&source, "try { const a = %sf%d(x); return a > 0 ? a : %sf%d(x + 1) } finally { sleep(\"0 millis\") }", receiver, i-1, receiver, i-1)
				}
				source.WriteString(" }\n")
			}
			if form == "method" {
				source.WriteString("}\n")
			}
			program, file, _, _ := editorProgram(t, source.String())
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			a := analyzerFor(c)
			count := 0
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if isLowerable(node) && node.Body() != nil {
					info := a.effectOf(node)
					if len(info.errors) != 1 || len(info.requirements) != 1 {
						t.Errorf("%s has %d errors, %d requirements; want one of each", functionDisplayName(node), len(info.errors), len(info.requirements))
					}
					if a.effectOf(node) != info {
						t.Error("callee channels were recomputed")
					}
					count++
					return false
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if count != 12 {
				t.Fatalf("checked %d functions; want 12", count)
			}
		})
	}
}
