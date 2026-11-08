package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const forConstTarget = "FuzzForHeadConstDestructuring"
const forConstQuote = "Source assignments keep ordinary `const` immutability."

func TestForHeadConstDestructuringQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), forConstQuote) {
		t.Fatal("const assignment rule changed")
	}
}

func FuzzForHeadConstDestructuring(f *testing.F) {
	startShortBudget(f)
	keys := []string{"object", "array", "renamed", "nested", "rest"}
	for _, key := range keys {
		f.Add(key, uint8(0), uint8(0), true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, operation, home uint8, constant bool) {
		TestForHeadConstDestructuringQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		selected := keys[int(key[0])%len(keys)]
		for _, k := range keys {
			if key == k {
				selected = k
			}
		}
		pattern, value, binding := "{n}", "{n:1}", "n"
		switch selected {
		case "array":
			pattern, value = "[n]", "[1]"
		case "renamed":
			pattern, value = "{a:n}", "{a:1}"
		case "nested":
			pattern, value = "{a:{n}}", "{a:{n:1}}"
		case "rest":
			pattern, value, binding = "{...rest}", "{n:1}", "rest"
		}
		word := "let"
		if constant {
			word = "const"
		}
		write := []string{binding + "=2", binding + "+=2", binding + "++"}[operation%3]
		if selected == "rest" {
			write = "rest={n:2}"
		}
		init, test, update := word+" "+pattern+"="+value, "(1 is let cell)", ""
		switch home % 3 {
		case 1:
			test, update = "true", "(1 is let cell)"
		case 2:
			init += ",ready=(1 is let cell)"
			test = "ready"
		}
		source := fmt.Sprintf("export function f(){for(%s;%s;%s){%s;return %s}}", init, test, update, write, binding)
		native := strings.ReplaceAll(source, "(1 is let cell)", "true")
		var expected int
		for _, row := range []struct{ file, source string }{{"main.ts", native}, {"main.vibe", source}} {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{row.file: row.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			count := 0
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() != 2588 {
					t.Fatalf("invalid witness %s: %s\\n%s", row.file, specDiagnosticText(d), row.source)
				}
				count++
			}
			if row.file == "main.ts" {
				expected = count
				want := 0
				if constant {
					want = 1
				}
				if count != want {
					t.Fatalf("native const witness got %d, want %d", count, want)
				}
			} else if count != expected {
				Gap(t, forConstTarget, fmt.Sprintf("%s/%d/%d/%t", selected, operation%3, home%3, constant), forConstQuote+"; native has %d TS2588, VibeLang has %d\\n%s", expected, count, source)
			}
		}
	})
}
