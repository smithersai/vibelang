package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

func TestOptionIteratorRepairQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("chapter 007 no longer says %q", migrationDeclarationFixQuote)
	}
}

// Static safe-repair oracle: an eager return would close active iterators.
func FuzzOptionIteratorRepair(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"binding", "discard", "return", "nested"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestOptionIteratorRepairQuoted(t)
		option, imports := "Option", ""
		if variant%2 != 0 {
			option = "O"
			imports = "import * as O from \"effect/Option\";\n"
		}
		value := option + ".none<number>()"
		if variant%4 >= 2 {
			value = option + ".some(1)"
		}
		body := "const y = yield* " + value + ";"
		switch key {
		case "discard":
			body = "yield* " + value + ";"
		case "return":
			body = "return yield* " + value + ";"
		case "nested":
			body = "for (const inner of xs) { " + body + " }"
		}
		source := imports + fmt.Sprintf("export const f = (xs: Iterable<number>) => %s.gen(function* () { for (const x of xs) { %s } return 1; });", option, body)
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		found := false
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 1002 {
				found = true
				if toolsOffersQuickFix(t, w, r, "main.vibe", d) {
					Gap(t, "FuzzOptionIteratorRepair", key, "VIP-34 editor must refuse iterator-changing Option.gen repair: %s", source)
				}
			}
		}
		if !found {
			Gap(t, "FuzzOptionIteratorRepair", key+":diagnostic", "Option.gen fixture must reach EK1002")
		}
	})
}
