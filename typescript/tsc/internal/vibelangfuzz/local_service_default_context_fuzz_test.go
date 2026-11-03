package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const localDefaultKeyQuote = "A service in a file outside any package (or in one whose `package.json` has no string `name`), or declared inside a function or block, has no derived key"
const localDefaultContextQuote = "The special `static readonly defaultValue` initializer of a `service` has that same source class-field boundary, including the reset of enclosing `fork`/`join` reservation"

func localDefaultRules(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("005-services.md"), localDefaultKeyQuote) {
		t.Fatal("VIP-9 local-service key rule changed; review the oracle")
	}
	if !strings.Contains(SpecText("002-running.md"), localDefaultContextQuote) {
		t.Fatal("VIP-17 service default field context changed; review the oracle")
	}
}
func TestLocalServiceDefaultContextQuoted(t *testing.T) { localDefaultRules(t) }

func FuzzLocalServiceDefaultContext(f *testing.F) {
	startShortBudget(f)
	localDefaultRules(f)
	type row struct {
		key, activation, word, form string
		hasKey                      bool
	}
	var rows []row
	for _, activation := range []string{"function", "producer", "block"} {
		for _, word := range []string{"fork", "join"} {
			for _, form := range []string{"call", "call-pair", "parameter", "binding", "nested"} {
				for _, hasKey := range []bool{true, false} {
					key := fmt.Sprintf("%s-%s-%s-key-%t", activation, word, form, hasKey)
					rows = append(rows, row{key, activation, word, form, hasKey})
				}
			}
		}
	}
	keys := make([]string, len(rows))
	for i, row := range rows {
		keys[i] = row.key
		f.Add([]byte(row.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		index, tail := keyedChoice(keys, data)
		row := rows[index]
		value := 4
		if len(tail) != 0 {
			value = int(tail[0]) % 7
		}
		var factory string
		switch row.form {
		case "call":
			factory = fmt.Sprintf("() => ({ value: %s(%d) })", row.word, value)
		case "call-pair":
			inner := "join"
			if row.word == "join" {
				inner = "fork"
			}
			factory = fmt.Sprintf("() => ({ value: %s(%s(%d)) })", row.word, inner, value)
		case "parameter":
			factory = fmt.Sprintf("(%s = %d) => ({ value: %s })", row.word, value, row.word)
		case "binding":
			factory = fmt.Sprintf("({ %s } = { %s: %d }) => ({ value: %s })", row.word, row.word, value, row.word)
		case "nested":
			factory = fmt.Sprintf("((%s = %d) => () => ({ value: %s }))()", row.word, value, row.word)
		}
		key := ""
		if row.hasKey {
			key = "static readonly key = \"fuzz/local-default\";"
		}
		body := "service Local { value: number; " + key + " static readonly defaultValue = " + factory + " };"
		var activation string
		switch row.activation {
		case "function":
			activation = "export effect function run() { " + body + " return (try Local).value }"
		case "producer":
			activation = "export effect function* run() { " + body + " yield (try Local).value }"
		case "block":
			activation = "export const run = effect { " + body + " return (try Local).value }"
		}
		source := "import { Effect, Stream, Context } from \"effect\";\nfunction fork(n: number) { return n + 1 }\nfunction join(n: number) { return n + 2 }\n" + activation + "\n"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		missing := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 903 {
				missing++
			} else {
				errors = append(errors, d.String())
			}
		}
		want := 1
		if row.hasKey {
			want = 0
		}
		if missing != want || len(errors) != 0 {
			Gap(t, "FuzzLocalServiceDefaultContext", row.key, "%s; %s; want EK0903 x%d and no other error, got %v\n%s", localDefaultKeyQuote, localDefaultContextQuote, want, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzLocalServiceDefaultContext", row.key)
		ExpectPending(t, "FuzzLocalServiceDefaultContext", specCorpusKey(t))
	})
}
