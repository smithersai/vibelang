package vibelang

import (
	"strings"
	"testing"
)

const serviceAccessorSignatureText = "A get or set accessor cannot be a service member."

func TestServiceAccessorSignatures(t *testing.T) {
	for _, tc := range []struct {
		name, members string
		want          int
	}{
		{"get", "get value(): number", 1},
		{"set", "set value(next: number)", 1},
		{"pair", "get value(): number\n set value(next: number)", 2},
		{"semicolons", "get value(): number; set value(next: number);", 2},
		{"comma", "get value(): number, other: string", 1},
		{"abstract get", "abstract get value(): number", 1},
		{"abstract set", "abstract set value(next: number)", 1},
		{"abstract pair", "abstract get value(): number\n abstract set value(next: number)", 2},
		{"public", "public get value(): number", 1},
		{"private", "private get value(): number", 1},
		{"protected", "protected set value(next: number)", 1},
		{"override", "override get value(): number", 1},
		{"declare", "declare get value(): number", 1},
		{"readonly", "readonly get value(): number", 1},
		{"quoted name", "get \"value\"(): number", 1},
		{"computed name", "get [Symbol.iterator](): number", 1},
		{"private name", "get #value(): number", 1},
		{"untyped get", "get value()", 1},
		{"untyped set", "set value(next)", 1},
		{"beside contracts", "read(): number!!\n get value(): number\n readonly region: string", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export service S {\n static readonly key = \"accessor/S\"\n " + tc.members + "\n}\n"
			p, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != 902 || !strings.Contains(d.String(), serviceAccessorSignatureText) {
					t.Errorf("unexpected diagnostic: %s", d.String())
				} else {
					count++
				}
			}
			if count != tc.want {
				t.Fatalf("want %d accessor errors, got %d\n%s", tc.want, count, source)
			}
		})
	}
}

// A written whole shape and a static accessor keep their own member rule,
// and an accessor with a body keeps the implementation rule: one EK0902 each.
func TestServiceAccessorSignatureNeighbours(t *testing.T) {
	for _, tc := range []struct{ name, source, text string }{
		{"whole shape", "type Shape = { value: number }\nexport service S: Shape {\n static readonly key = \"accessor/S\"\n get value(): number\n}\n", "A service with a written shape admits only"},
		{"static", "export service S {\n static readonly key = \"accessor/S\"\n static get value(): number\n}\n", "Move other static members outside the service."},
		{"body", "export service S {\n static readonly key = \"accessor/S\"\n get value(): number { return 1 }\n}\n", "value has an implementation"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != 902 || !strings.Contains(d.String(), tc.text) {
					t.Errorf("unexpected diagnostic: %s", d.String())
				} else {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("want one member error, got %d", count)
			}
		})
	}
}

func TestServiceAccessorSignatureControls(t *testing.T) {
	const source = "export service Named {\n static readonly key = \"accessor/named\"\n get: number\n set(next: number): void\n readonly value: number\n}\nexport service Optional {\n static readonly key = \"accessor/optional\"\n get?(): number\n set?: string\n}\nexport interface Accessors { get value(): number; set value(next: number) }\nexport abstract class Native {\n abstract get value(): number\n abstract set value(next: number)\n get other(): number { return 1 }\n}\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
}
