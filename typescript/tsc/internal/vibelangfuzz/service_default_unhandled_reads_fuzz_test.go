package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

func TestServiceDefaultUnhandledReadsQuoted(t *testing.T) {
	for _, quote := range []string{"including the corresponding type and value reads", migrationDeclarationFixQuote} {
		chapter := "007-tooling.md"
		if strings.HasPrefix(quote, "including") {
			chapter = "900-appendices.md"
		}
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}
func FuzzServiceDefaultTypeReadRefusal(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"alias", "parentheses", "union", "instantiation"} {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestServiceDefaultUnhandledReadsQuoted(t)
		service := []string{"Flags", "Options"}[variant%2]
		read := "type K = \"default\"; export type Value = (typeof %[1]s)[K];"
		switch key {
		case "parentheses":
			read = "export type Value = (typeof %[1]s)[(\"default\")];"
		case "union":
			read = "export type Value = (typeof %[1]s)[\"default\" | \"key\"];"
		case "instantiation":
			read = "export type Value = typeof %[1]s.default.read<string>;"
		}
		source := fmt.Sprintf("service %[1]s { static readonly key = \"app/%[1]s\"; static readonly default: %[1]s.Shape = { enabled: true, read: <T>(x:T) => x }; enabled: boolean; read: <T>(x:T) => T }\n", service) + fmt.Sprintf(read, service)
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if !toolsErrorFree(r) {
			t.Fatalf("invalid source fixture: %v", SortedKeys(Keys(r.Dir, r.Diagnostics)))
		}
		found := false
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4855 {
				found = true
				if toolsOffersQuickFix(t, w, r, "main.vibe", d) {
					Gap(t, "FuzzServiceDefaultTypeReadRefusal", key, "VIP-9/34: editor offers partial default migration: %s", source)
				}
			}
		}
		if !found {
			Gap(t, "FuzzServiceDefaultTypeReadRefusal", key+":diagnostic", "manual repair must retain EK4855 and refusal explanation")
		}
	})
}
