package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-10 denies an implicit lookup through S.member, including when try is
// written before the call. Actual properties of the key keep their TS meaning.
func TestVIP10ServiceShorthand(t *testing.T) {
	prefix := "interface Shape { find(id: string): string!!; value(): number; name(): string }\nservice Users: Shape { static readonly key = \"vip10/users\" }\n"
	for _, test := range []struct {
		name, body string
		code       int32
	}{
		{"effect method", "export effect function f() { return try Users.find(\"42\") }", 2339},
		{"held method", "export effect function f() { return Users.find(\"42\") }", 2339},
		{"plain member", "export effect function f() { return Users.value() }", 2339},
		{"ordinary function", "export function f() { return Users.value() }", 2339},
		{"top level", "export const x = Users.value()", 2339},
		{"member value", "export effect function f() { return Users.value }", 2339},
		{"class name value", "export effect function f() { const n: string = Users.name; return n }", 0},
		{"class name call", "export effect function f() { return Users.name() }", 2349},
		{"key value", "export effect function f() { const k: string = Users.key; return k }", 0},
		{"key call", "export effect function f() { return Users.key() }", 2349},
		{"explicit effect", "export effect function f() { return try (try Users).find(\"42\") }", 0},
		{"explicit plain", "export effect function f() { return (try Users).value() }", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+test.body)
			errors := program.GetSemanticDiagnostics(t.Context(), file)
			found := false
			for _, d := range errors {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == "" && d.Code() == test.code {
					found = true
					continue
				}
				t.Errorf("unexpected error: %s", d.String())
			}
			if test.code != 0 && !found {
				t.Errorf("missing TS%d; got %v", test.code, errors)
			}
		})
	}
}

func TestVIP10ServiceKeyCompletions(t *testing.T) {
	source := "service Users {static readonly key=\"vip10/completions\"; find(n:number):number!!; value:number}\nexport effect function f(){return Users. }"
	_, file, service, _ := editorProgram(t, source)
	result, err := service.GetCompletionsAtPosition(t.Context(), file, strings.Index(source, "Users.")+len("Users."), nil, true)
	if err != nil || result == nil {
		t.Fatalf("completions: result=%v err=%v", result, err)
	}
	names := map[string]bool{}
	for _, item := range result.Items {
		names[item.Label] = true
	}
	if names["find"] || names["value"] || !names["key"] {
		t.Fatalf("completion list exposes implementation or loses native key: %v", names)
	}
}
