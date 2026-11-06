package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestJoinNativeResultQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "| \x60join f\x60 | \x60yield* Fiber.join(f)\x60 |")
}

// Both programs use the native signature; bidirectional assignments compare
// their success, failure and requirement channels without executing any input.
func FuzzJoinNativeResultChannels(f *testing.F) {
	startShortBudget(f)
	rows := []struct{ key, generic, typ string }{
		{"any", "", "any"}, {"never", "", "never"},
		{"any-alias", "", "Unchecked"}, {"never-alias", "", "Empty"},
		{"any-union", "", "any|undefined"}, {"never-intersection", "", "number&never"},
		{"never-generic", "<T extends never>", "T"},
	}
	for _, row := range rows {
		for flags := uint8(0); flags < 8; flags++ {
			f.Add(row.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestJoinNativeResultQuoted(t)
		index := -1
		for i, row := range rows {
			if row.key == key {
				index = i
				break
			}
		}
		if index < 0 {
			index = 0
			for _, b := range []byte(key) {
				index = (index*31 + int(b)) % len(rows)
			}
		}
		row := rows[index]
		operand := []string{"input", "(input)", "identity(input)", "(input satisfies Fiber.Fiber<any,any>)"}[flags%4]
		source := "import {Effect,Fiber} from \"effect\";type Unchecked=any;type Empty=never;const identity=<T>(x:T):T=>x;" +
			"export function native" + row.generic + "(input:" + row.typ + "){return Effect.gen(function*(){return yield* Fiber.join(" + operand + ")})}" +
			"export effect function actual" + row.generic + "(input:" + row.typ + "){/* café 😀 */ return join " + operand + "}" +
			"const forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
		var config map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		if flags&4 != 0 {
			config["vibe"] = map[string]any{"effectGlobals": false, "effectModules": false}
		}
		raw, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: string(raw)})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if got := r3Errors(result.Diagnostics); len(got) != 0 {
			Gap(t, "FuzzJoinNativeResultChannels", fmt.Sprintf("%s:%d", row.key, flags%8), "native Fiber.join API identity reported %v", got)
		}
	})
}
