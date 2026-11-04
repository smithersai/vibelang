package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"strings"
	"testing"
)

func TestServiceDefaultUnhandledReadsQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"900-appendices.md": serviceDefaultReadsQuote,
		"007-tooling.md":    migrationDeclarationFixQuote,
	} {
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
		read := "type K = \"default\"; export type Read = (typeof %[1]s)[K];"
		switch key {
		case "parentheses":
			read = "export type Read = (typeof %[1]s)[(\"default\")];"
		case "union":
			read = "export type Read = (typeof %[1]s)[\"default\" | \"key\"];"
		case "instantiation":
			read = "export type Read = typeof %[1]s.default.read<string>;"
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

		typeBefore := serviceDefaultReadType(t, r)
		// Historical target/corpus names stay stable. The native-key action
		// keeps the member, so these reads now permit a complete safe fix.
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir), vibelang.FixOptions{})
		if fixed.Err != nil || len(fixed.Refused) > 0 {
			t.Fatalf("%v; %+v", fixed.Err, fixed.Refused)
		}
		text := source
		for _, file := range fixed.Files {
			text = file.Text
		}
		if !strings.Contains(text, "class "+service+" extends ") || !strings.Contains(text, "static readonly default") {
			Gap(t, "FuzzServiceDefaultTypeReadRefusal", key, "complete cached native action missing: %s", text)
			return
		}
		after, err := w.Compile(t.Context(), Single(text))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzServiceDefaultTypeReadRefusal", key, "fixed source errors: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
			return
		}
		if got := serviceDefaultReadType(t, after); got != typeBefore {
			Gap(t, "FuzzServiceDefaultTypeReadRefusal", key, "type read changed: %s -> %s", typeBefore, got)
		}
		// A union can retain a private shape alias in TypeToString. Compare
		// actual consumer APIs with stock TypeScript, so private renaming
		// cannot masquerade as a changed exported type.
		if diff := compareServiceDefaultDeclarations(t, w, r, after); diff != "" {
			Gap(t, "FuzzServiceDefaultTypeReadRefusal", key, "declaration API changed: %s", diff)
		}
		ExpectPending(t, "FuzzServiceDefaultTypeReadRefusal", key)
	})
}
