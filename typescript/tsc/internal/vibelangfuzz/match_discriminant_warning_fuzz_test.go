package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const literalDiscriminantWarningQuote = "A match without `default` over objects with literal-typed discriminant fields other than `_tag` reports warning `EK0708` when cases remain."

func TestLiteralDiscriminantWarningQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), literalDiscriminantWarningQuote) {
		t.Fatal("literal discriminant warning rule changed")
	}
}

// The input starts with a stable key; the remaining bytes vary the union's
// size, arm subset, field names, literal kinds and nesting independently.
func FuzzLiteralDiscriminantWarning(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("004-match.md"), literalDiscriminantWarningQuote) {
		f.Fatal("missing warning contract")
	}
	for _, key := range []string{"kind", "type", "phase", "nested", "mixed", "mixed-fixed", "open", "default", "generic", "union-field"} {
		f.Add([]byte(key + "\x00\x04\x05"))
		f.Add([]byte(key + "\x00\x03\xff"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, tail, found := strings.Cut(string(data), "\x00")
		if !found {
			key = "kind"
			tail = string(data)
		}
		b := []byte(tail)
		at := func(i int) byte {
			if i < len(b) {
				return b[i]
			}
			return 0
		}
		n := 2 + int(at(0)%5)
		mask := int(at(1)) & ((1 << n) - 1)
		// The grammar requires at least one arm.
		if mask == 0 {
			mask = 1
		}
		field := "kind"
		if key == "type" {
			field = "type"
		} else if key == "phase" {
			field = "phase"
		}
		var types, arms []string
		for i := 0; i < n; i++ {
			prop := field
			if key == "mixed" && i == n-1 {
				prop = "_tag"
			}
			value := fmt.Sprintf("%q", fmt.Sprintf("case%d", i))
			if at(2)%2 != 0 {
				value = fmt.Sprint(i + 1)
			}
			member := "{" + prop + ":" + value + "}"
			if key == "mixed-fixed" && i == n-1 {
				member = "Fixed"
			}
			pattern := member
			if key == "nested" {
				pattern = "{value:" + pattern + "}"
			}
			types = append(types, member)
			if mask&(1<<i) != 0 {
				arms = append(arms, "when "+pattern+":"+fmt.Sprint(i)+";")
			}
		}
		domain := strings.Join(types, "|")
		if key == "union-field" {
			var values []string
			for i := 0; i < n; i++ {
				if at(2)%2 != 0 {
					values = append(values, fmt.Sprint(i+1))
				} else {
					values = append(values, fmt.Sprintf("%q", fmt.Sprintf("case%d", i)))
				}
			}
			domain = "{kind:" + strings.Join(values, "|") + "}"
		}
		if key == "nested" {
			domain = `{outer:"wrapper";value:` + domain + "}"
		}
		if key == "open" {
			domain = "{kind:string}"
		}
		if key == "default" {
			arms = append(arms, "default:0;")
		}
		params := ""
		subject := domain
		if key == "generic" {
			params = "<T extends " + domain + ">"
			subject = "T"
		}
		prefix := ""
		if key == "mixed-fixed" {
			prefix = "error Fixed;"
		}
		source := prefix + "export function inspect" + params + "(s:" + subject + "){return match(s){" + strings.Join(arms, "") + "}}"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 708 {
				got++
				if d.Category() != diagnostics.CategoryWarning {
					t.Fatalf("EK0708 category: %v", d)
				}
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected diagnostic: %v\n%s", d, source)
			}
		}
		want := 0
		if key != "open" && key != "default" && mask != (1<<n)-1 {
			want = 1
		}
		if got != want {
			Gap(t, "FuzzLiteralDiscriminantWarning", "literal-discriminant:"+key, "EK0708 count=%d want=%d\n%s", got, want, source)
		}
	})
}
