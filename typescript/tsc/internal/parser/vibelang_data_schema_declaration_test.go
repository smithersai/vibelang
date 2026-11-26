package parser_test

import (
	"strings"
	"testing"
)

func TestDataSchemaDeclarationStartsRequireBodies(t *testing.T) {
	for _, source := range []string{
		"schema X", "schema X\n",
		"const schema=1; type T=number; schema as T;",
		"const schema=1; type T=number; schema satisfies T;",
		"const data=1; type T=number; data as T;",
		"const data=1; type T=number; data satisfies T;",
	} {
		t.Run(source, func(t *testing.T) {
			wantCode := int32(1503)
			if strings.HasPrefix(source, "const data") {
				wantCode = 1604
			}
			end := len(strings.TrimSuffix(source, "\n"))
			if index := strings.LastIndex(source, " T;"); index >= 0 {
				end = index
			}
			if ds := parseVibe(t, source).Diagnostics(); len(ds) != 1 || ds[0].Code() != wantCode || ds[0].Pos() != end || ds[0].End() != end {
				t.Fatalf("want EK%04d at %d, got %v", wantCode, end, ds)
			}
		})
	}
	for _, source := range []string{
		"schema X\n{role:\n | \"a\"\n | \"b\"}",
		"schema X\n=string;",
		"data as {}",
		"const schema=1; type T=number; (schema as T);",
		"const data=1; type T=number; (data satisfies T);",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parseVibe(t, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("valid declaration or expression rejected: %v", ds[0])
			}
		})
	}
}
