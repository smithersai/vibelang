package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const serviceKeyInferenceQuote = `class Users extends Context.Service<Users, $Users$Shape>()("@acme/app/src/users#Users") {}`

func TestServiceKeyInferenceQuoted(t *testing.T) {
	serviceKeyInferenceQuoted(t)
}

func serviceKeyInferenceQuoted(t testing.TB) {
	if !strings.Contains(SpecText("005-services.md"), serviceKeyInferenceQuote) {
		t.Fatal("VIP-9's native service counterpart changed")
	}
}

// VIP-9's native key literal is part of the declaration type, rather than a
// fresh initializer type. Alias, bracket and destructuring reads must retain
// the same literal when inferred as an Effect's success or a plain return.
func FuzzServiceKeyInference(f *testing.F) {
	startShortBudget(f)
	serviceKeyInferenceQuoted(f)
	forms := []string{"direct", "bracket", "alias", "destructured", "optional", "stored"}
	for _, form := range forms {
		f.Add([]byte(form))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		form := string(data)
		i := slices.Index(forms, form)
		if i < 0 {
			i = 0
			if len(data) != 0 {
				i = int(data[0]) % len(forms)
			}
			form = forms[i]
		}
		read := []string{"Key.key", `Key["key"]`, "Alias.key", "key", "Key?.key", "stored"}[i]
		source := fmt.Sprintf(`import { Effect } from "effect"
service Key { static readonly key = "fuzz/Key"; value: number }
const Alias = Key
const { key } = Key
const stored = Key.key
export effect function effectRead() { return %s }
export function plainRead() { return %s }
type Success = Effect.Success<ReturnType<typeof effectRead>>
const effectExact: "fuzz/Key" = null! as Success
const plainExact: "fuzz/Key" = plainRead()
export { effectExact, plainExact }
`, read, read)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if got := SortedKeys(Keys(r.Dir, r.Diagnostics)); len(got) != 0 {
			Gap(t, "FuzzServiceKeyInference", form, "VIP-9 native key literal must survive return inference: %v\n%s", got, source)
		}
	})
}
