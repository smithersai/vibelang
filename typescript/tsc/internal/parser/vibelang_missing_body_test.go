package parser_test

import (
	"strings"
	"testing"
)

func TestSchemaDataMissingBodyDiagnosticCodes(t *testing.T) {
	for _, kind := range []string{"schema", "data"} {
		want := int32(1503)
		if kind == "data" {
			want = 1604
		}
		for _, suffix := range []string{"", ";", "\nconst next=1", "\n}", " /* missing */"} {
			source := kind + " Missing" + suffix
			t.Run(source, func(t *testing.T) {
				ds := parseVibe(t, source).Diagnostics()
				got := 0
				for _, d := range ds {
					if d.Source() == "EK" && d.Code() == want {
						got++
					}
					if d.Code() == 1005 {
						t.Errorf("native missing-brace diagnostic remains: %v", d)
					}
				}
				if got != 1 {
					t.Fatalf("got %d EK%d, want one; %v", got, want, ds)
				}
			})
		}
	}
	for _, source := range []string{"schema S {}", "schema S=string", "schema S\n=string", "data D {}", "data D<T>\n{Some {value:T}}", "error E", "schema error E"} {
		t.Run(source, func(t *testing.T) {
			for _, d := range parseVibe(t, source).Diagnostics() {
				if d.Code() == 1503 || d.Code() == 1604 {
					t.Fatalf("valid header rejected: %v", d)
				}
			}
		})
	}
	// Native contextual identifier syntax keeps the TypeScript parser's codes.
	for _, source := range []string{"schema\nMissing", "data\nMissing", "(schema as number)", "(data satisfies number)"} {
		t.Run(source, func(t *testing.T) {
			for _, d := range parseVibe(t, source).Diagnostics() {
				if d.Source() == "EK" && strings.Contains(d.String(), "declaration needs") {
					t.Fatalf("ordinary identifier became declaration: %v", d)
				}
			}
		})
	}
}

func TestGenericDataMissingBodyDiagnostic(t *testing.T) {
	for _, source := range []string{"data Missing<T>", "data Missing\n<T>", "export data Missing<T>;", "namespace N {data Missing<T>\n}"} {
		t.Run(source, func(t *testing.T) {
			found := 0
			for _, d := range parseVibe(t, source).Diagnostics() {
				if d.Source() == "EK" && d.Code() == 1604 {
					found++
				}
				if d.Code() == 1005 {
					t.Errorf("native brace diagnostic remains: %v", d)
				}
			}
			if found != 1 {
				t.Fatalf("got %d EK1604, want one", found)
			}
		})
	}
}
