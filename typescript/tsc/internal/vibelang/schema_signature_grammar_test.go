package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"sort"
	"strings"
	"testing"
)

func TestSchemaSignatureGrammar(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []string
	}{
		{"static", "schema S = { (static value: Missing): Missing }", []string{"EK2109", "TS1090"}},
		{"async-pattern", "schema S = { (async { p }: Missing): Missing }", []string{"EK2109", "TS1090"}},
		{"readonly", "schema S = { f(readonly value: Missing): Missing }", []string{"EK2109", "TS2369"}},
		{"public", "schema S = { (public value: Missing): Missing }", []string{"EK2109", "TS2369"}},
		{"reserved", "schema S = { (static: Missing): Missing }", []string{"EK2109", "TS1214"}},
		{"reserved-destructure", "schema S = { ({ p: static }: Missing): Missing }", []string{"EK2109", "TS1214"}},
		{"reserved-rest", "schema S = { (...static: Missing[]): Missing }", []string{"EK2109", "TS1214"}},
		{"nested-function-type", "schema S = { f: (static: Missing) => Missing }", []string{"EK2109", "TS1214"}},
		{"parameter-control", "schema S = { (value: Missing): Missing }", []string{"EK2109"}},
		{"name-control", "schema S = { static(value: Missing): Missing }", []string{"EK2109"}},
		{"property-key-control", "schema S = { ({ static: p }: Missing): Missing }", []string{"EK2109"}},
		{"body-static", "schema S { f(static value: Missing): Missing }", []string{"EK1505", "TS1090"}},
		{"body-reserved", "schema S { f(static: Missing): Missing }", []string{"EK1505", "TS1214"}},
		{"operator-reserved", "schema S = readonly { (static: Missing): Missing }", []string{"EK2109", "TS1214"}},
		{"generic-reserved", "schema S = Promise<{ (static: Missing): Missing }>", []string{"EK2109", "EK2109", "TS1214"}},
		{"class-reserved", "class C { method() { schema S = { (static: Missing): Missing } } }", []string{"EK2109", "TS1213"}},
		{"nested-class-reserved", "class C { method() { function inner() { schema S = { (...static: Missing[]): Missing } } } }", []string{"EK2109", "TS1213"}},
		{"static-class-reserved", "class C { static method() { schema S = { ({ p: static }: Missing): Missing } } }", []string{"EK2109", "TS1213"}},
		{"duplicate-readonly-parameter", "schema S = { (readonly readonly value: Missing): Missing }", []string{"EK2109", "TS1030", "TS2369"}},
		{"mixed-modifiers", "schema S = { (readonly async value: Missing): Missing }", []string{"EK2109", "TS1090", "TS2369"}},
		{"static-reserved-name", "schema S = { (static static: Missing): Missing }", []string{"EK2109", "TS1090", "TS1214"}},
	} {
		t.Run(row.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, row.source)
			var got []string
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				prefix := d.Source()
				if prefix == "" {
					prefix = "TS"
				}
				got = append(got, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
			sort.Strings(got)
			if strings.Join(got, " ") != strings.Join(row.want, " ") {
				t.Fatalf("errors %v want %v: %s", got, row.want, row.source)
			}
		})
	}
}
