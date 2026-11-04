package parser_test

import "testing"

func TestDataSchemaDeclarationStartsRequireBodies(t *testing.T) {
	for _, source := range []string{
		"schema X", "schema X\n",
		"const schema=1; type T=number; schema as T;",
		"const schema=1; type T=number; schema satisfies T;",
		"const data=1; type T=number; data as T;",
		"const data=1; type T=number; data satisfies T;",
	} {
		t.Run(source, func(t *testing.T) {
			if len(parseVibe(t, source).Diagnostics()) == 0 {
				t.Fatalf("accepted a declaration without its body: %s", source)
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
