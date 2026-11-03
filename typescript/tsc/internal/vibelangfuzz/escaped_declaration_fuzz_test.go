package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const escapedDeclarationQuote = "`service`, `error`, `schema` and `data` follow TypeScript\u0027s contextual keyword `type`"

func TestEscapedDeclarationKeywordsQuoted(t *testing.T) {
	r4Quoted(t, "900-appendices.md", escapedDeclarationQuote)
}

type escapedDeclarationRow struct {
	key, source string
	errors      int
}

func escapedDeclarationRows() []escapedDeclarationRow {
	var rows []escapedDeclarationRow
	for _, form := range []struct{ key, word, format string }{
		{"error", "error", "export %s Entry { value: number }"},
		{"schema-error-schema", "schema", "export %s error Entry { value: number }"},
		{"schema-error-error", "error", "export schema %s Entry { value: number }"},
		{"schema", "schema", "export %s Entry { value: number }"},
		{"service", "service", `export %s Entry { static readonly key = "escaped-keyword-test"; value: number }`},
		{"data", "data", "export %s Entry { EntryValue { value: number } }"},
	} {
		for i, r := range form.word {
			for _, style := range []string{"four", "braced"} {
				escaped := fmt.Sprintf("\\u%04x", r)
				if style == "braced" {
					escaped = fmt.Sprintf("\\u{%x}", r)
				}
				word := form.word[:i] + escaped + form.word[i+1:]
				rows = append(rows, escapedDeclarationRow{fmt.Sprintf("%s/%d/%s", form.key, i, style), fmt.Sprintf(form.format, word), 1})
			}
		}
	}
	rows = append(rows,
		escapedDeclarationRow{"both-markers", `export sc\u0068ema er\u0072or Entry { value: number }`, 2},
		escapedDeclarationRow{"escaped-name", `export error \u0045ntry { value: number }`, 0},
		escapedDeclarationRow{"escaped-expression", `const error=1; export default er\u0072or as number`, 0},
	)
	return rows
}

// The quoted contextual-type rule supplies the oracle. Stock TypeScript5.9.3
// reports TS1260 for both Unicode escape spellings in type, and admits the
// same escapes in binding names and identifier expressions.
func FuzzEscapedDeclarationKeywords(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "900-appendices.md", escapedDeclarationQuote)
	rows := escapedDeclarationRows()
	var keys []string
	for _, row := range rows {
		keys = append(keys, row.key)
	}
	r4Seeds(f, keys)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzEscapedDeclarationKeywords"
		row := rows[r4Pick(data, keys)]
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": row.source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		codes := r4Errors(result.Diagnostics)
		valid := len(codes) == row.errors
		for _, code := range codes {
			valid = valid && code == "TS1260"
		}
		key := "keyword:" + row.key
		if !valid {
			Gap(t, target, key, "900: %s; want %d TS1260, got %v\n%s", escapedDeclarationQuote, row.errors, codes, row.source)
		}
		ExpectPending(t, target, key)
		if corpus := corpusFile(t, target); corpus != "" {
			ExpectPending(t, target, "corpus:"+corpus)
		}
	})
}

func TestEscapedDeclarationKeywordKeys(t *testing.T) {
	rows := escapedDeclarationRows()
	var keys []string
	seen := map[string]bool{}
	for _, row := range rows {
		if strings.ContainsAny(row.key, " \t\n") || seen[row.key] {
			t.Fatal(row.key)
		}
		seen[row.key] = true
		keys = append(keys, row.key)
	}
	for i, key := range keys {
		if got := r4Pick([]byte("key:"+key), keys); got != i {
			t.Fatalf("%s: %d != %d", key, got, i)
		}
	}
}
