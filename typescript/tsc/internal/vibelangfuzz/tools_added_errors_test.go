package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

func TestToolsAddedErrorsReportsNewDiagnostic(t *testing.T) {
	w := NewWorkspace(t)
	original := "class Base { read(): number { return 1 } }\nclass Loud extends Base { read(): string { return 'existing' } }\ninterface Reader { read(): string }\n"
	added := "class Bad implements Reader { read(): number { return 1 } }\n"
	compile := func(source string) *Result {
		t.Helper()
		r, err := w.Compile(context.Background(), Project{Files: map[string]string{"main.ts": source}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(r.Remove)
		return r
	}
	before := compile(original)
	after := compile(original + added)
	got := toolsAddedErrors(before, after)
	if len(got) == 0 || got[0] != "main.ts: TS2416" {
		t.Fatalf("missing error count delta: %v", got)
	}
	text := strings.Join(got, "\n")
	if !strings.Contains(text, "'Bad'") || strings.Contains(text, "'Loud'") {
		t.Fatalf("expected the added Bad diagnostic rather than existing Loud:\n%s", text)
	}
}
func TestToolsAddedErrorsKeepsCountOracle(t *testing.T) {
	w := NewWorkspace(t)
	compile := func(source string) *Result {
		t.Helper()
		r, err := w.Compile(context.Background(), Project{Files: map[string]string{"main.ts": source}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(r.Remove)
		return r
	}
	a := compile("const old: number = 'old'\n")
	b := compile("const changed: number = 'changed'\n")
	clean := compile("const value: number = 1\n")
	for _, pair := range []struct {
		name          string
		before, after *Result
	}{
		{"same diagnostic", a, a}, {"same count new message", a, b}, {"removed error", a, clean}, {"no errors", clean, clean},
	} {
		t.Run(pair.name, func(t *testing.T) {
			if got := toolsAddedErrors(pair.before, pair.after); len(got) != 0 {
				t.Fatalf("count oracle changed: %v", got)
			}
		})
	}
}
