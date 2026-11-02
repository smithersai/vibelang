package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-10 denies shorthand because name/key/length and other actual key
// properties retain their ordinary TypeScript meaning.
func TestServiceKeyPropertiesKeepNativeMeaning(t *testing.T) {
	prefix := "interface Api { key: number; name(): number; length(): number; pipe(): number; toString(): number; of(value: Api): number }\nservice Users: Api { static readonly key = \"vip10/native-key\" }\n"
	for _, test := range []struct {
		key, body string
		want      int32
	}{
		{"key", "const value: string = Users.key; return value", 0},
		{"name", "const value: string = Users.name; return value", 0},
		{"length", "const value: number = Users.length; return value", 0},
		{"toString", "const value: string = Users.toString(); return value", 0},
		{"pipe", "const value: typeof Users = Users.pipe(); return value", 0},
		{"of", "const value: Api = Users.of(null as unknown as Api); return value", 0},
		{"name-call", "return Users.name()", 2349},
		{"length-call", "return Users.length()", 2349},
		{"key-call", "return Users.key()", 2349},
		{"implementation-name", "return (try Users).name()", 0},
		{"implementation-key", "const value: number = (try Users).key; return value", 0},
	} {
		t.Run(test.key, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+"export effect function probe() { "+test.body+" }\n")
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == test.want && d.Source() == "" {
					found = true
					continue
				}
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
			if test.want != 0 && !found {
				t.Errorf("missing native TS%d", test.want)
			}
		})
	}
}
