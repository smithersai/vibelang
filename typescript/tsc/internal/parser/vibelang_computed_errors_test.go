package parser_test

import "testing"

func TestComputedErrorFieldsDoNotPanic(t *testing.T) {
	for name, source := range map[string]string{
		"root":            "const key = \"id\" as const; error E { [key]: string }",
		"schema":          "const key = \"id\" as const; schema error E { [key]: string }",
		"legacy heritage": "const key = \"id\" as const; error Base { _tag: string }; error E extends Base { [key]: string }",
	} {
		t.Run(name, func(t *testing.T) { parseErrorSource(t, source) })
	}
}
