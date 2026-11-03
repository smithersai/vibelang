package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const errorAmbientPriorityQuote = "Check the ambient-context rule before classifying members."
const errorAmbientDiagnosticQuote = "a recognized `error` or `schema error` declaration in an ambient source context, explicit or inherited, as for a [service](005-services.md#static-rules): `declare error Missing`; it comes ahead of the declaration\u0027s other diagnostics"

func TestErrorAmbientPriorityQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", errorAmbientPriorityQuote, errorAmbientDiagnosticQuote)
}

type errorAmbientPriorityRow struct {
	key, source string
	count       int
}

func errorAmbientPriorityRows() []errorAmbientPriorityRow {
	var rows []errorAmbientPriorityRow
	for _, form := range []string{"error", "schema error"} {
		for _, context := range []struct{ key, source string }{
			{"declare", "declare %s\nexport {}"},
			{"namespace", "declare namespace API { export %s }\nexport {}"},
			{"global", "declare global { %s }\nexport {}"},
		} {
			for _, member := range []struct{ key, source string }{
				{"constructor", "Entry { constructor() { super() } }"},
				{"setter", "Entry { set value(n: number) {} }"},
				{"static", "Entry { static field = 1 }"},
				{"static-block", "Entry { static { 1; } }"},
				{"generic", "Entry<T> {}"},
				{"tag", "Entry { _tag: string }"},
				{"initialized", "Entry { value = 1 }"},
			} {
				rows = append(rows, errorAmbientPriorityRow{strings.ReplaceAll(form, " ", "-") + "/" + context.key + "/" + member.key, fmt.Sprintf(context.source, form+" "+member.source), 1})
			}
		}
	}
	rows = append(rows, errorAmbientPriorityRow{"combined-declarations", "declare error First { constructor() { super() } }\ndeclare schema error Second { static field = 1 }\nexport {}", 2}, errorAmbientPriorityRow{"combined-members", "declare error Entry { constructor() { super() }; static field = 1 }\nexport {}", 1})
	return rows
}

func FuzzErrorAmbientPriority(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", errorAmbientPriorityQuote, errorAmbientDiagnosticQuote)
	rows := errorAmbientPriorityRows()
	var keys []string
	for _, row := range rows {
		keys = append(keys, row.key)
	}
	r4Seeds(f, keys)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzErrorAmbientPriority"
		row := rows[r4Pick(data, keys)]
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": row.source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		codes := r4Errors(result.Diagnostics)
		key := "priority:" + row.key
		valid := len(codes) == row.count
		for _, code := range codes {
			valid = valid && code == "EK1307"
		}
		if !valid {
			Gap(t, target, key, "003: %s; want EK1307 alone, got %v\n%s", errorAmbientPriorityQuote, codes, row.source)
		}
		ExpectPending(t, target, key)
		if corpus := corpusFile(t, target); corpus != "" {
			ExpectPending(t, target, "corpus:"+corpus)
		}
	})
}

func TestErrorAmbientPriorityKeys(t *testing.T) {
	rows := errorAmbientPriorityRows()
	var keys []string
	seen := map[string]bool{}
	for _, row := range rows {
		if strings.ContainsAny(row.key, " \t\n") || seen[row.key] {
			t.Fatalf("invalid or duplicate key %q", row.key)
		}
		seen[row.key] = true
		keys = append(keys, row.key)
	}
	for i, key := range keys {
		if got := r4Pick([]byte("key:"+key), keys); got != i {
			t.Fatalf("key %s maps to %d, want %d", key, got, i)
		}
	}
}
