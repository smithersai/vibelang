package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const serviceKeyInferenceQuote = `class Users extends Context.Service<Users, $Users$Shape>()("@acme/app/src/users#Users") {}`

func TestServiceKeyInferenceQuoted(t *testing.T) {
	serviceKeyInferenceQuoted(t)
}

// The compatibility rewrite preserves the local's former string type without
// widening the service key itself or changing initializer evaluation.
func FuzzServiceKeyInferenceMigration(f *testing.F) {
	startShortBudget(f)
	serviceKeyInferenceQuoted(f)
	for _, key := range []string{"direct", "bracket", "parenthesized"} {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := string(data)
		read := "Key.key"
		switch key {
		case "bracket":
			read = `Key["key"]`
		case "parenthesized":
			read = "(Key.key)"
		default:
			key = "direct"
		}
		source := `service Key { static readonly key = "fuzz/Key"; value: number }
export function read() { let value = ` + read + `; value = "other"; return value }
`
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, "FuzzServiceKeyInferenceMigration", files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) != 0 {
			t.Fatal("invalid migration fixture config")
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		fixed := result.Files[tspath.RootedFilePath(filepath.ToSlash(before.Dir)+"/main.vibe")]
		if result.Err != nil || fixed == nil || !strings.Contains(fixed.Text, "let value: string = "+read) {
			Gap(t, "FuzzServiceKeyInferenceMigration", key, "VIP-9 key inference compatibility must preserve the mutable binding: %+v", result)
			return
		}
		after := toolsCompile(t, w, "FuzzServiceKeyInferenceMigration", map[string]string{"main.vibe": fixed.Text})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzServiceKeyInferenceMigration", key, "rewritten binding must compile: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
	})
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
