package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const effectSlotRecoveryQuote = "Only ordinary TypeScript source types are operands. The parser-only JSDoc forms `?T`, `T?`, `!T` and `*` are excluded, including inside parentheses; explicitly writing one gives the ordinary invalid-type diagnostic."
const effectSlotCompoundQuote = "and a function or constructor type in a slot needs its own parentheses (`A!(() => B)`, not `A!() => B`)."

func requireEffectSlotRecoveryQuotes(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{effectSlotRecoveryQuote, effectSlotCompoundQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("Appendix A no longer says %q", quote)
		}
	}
}

func TestEffectSlotRecoveryQuoted(t *testing.T) { requireEffectSlotRecoveryQuotes(t) }

var effectSlotRecoveryHeads = []struct{ key, text string }{
	{"optional", "(string?)"},
	{"typed-optional", "(x?: string)"},
	{"nested-arrow", "(x: () => string)"},
	{"rest", "(...values: string[])"},
	{"object", "(x: { readonly value: number })"},
	{"unicode-constructor", "new (café?: string)"},
}
var effectSlotRecoverySlots = []struct{ key, text string }{
	{"error", "number!%s"},
	{"optional-requirement", "number!!%s"},
	{"required-requirement", "number!Error!%s"},
}
var effectSlotRecoveryModes = []string{"recovered", "written", "grouped", "missing-return"}
var effectSlotRecoveryTrivia = []struct{ key, text string }{
	{"space", " "},
	{"block", " /* misleading => */ "},
	{"line", " // misleading =>\n"},
	{"unicode", " /* café => 🦊 */ "},
}

// The same operand parsed as native TypeScript supplies its ordinary syntax
// diagnostics. VIP-3 adds EK0301 only for a written, ungrouped function type.
// Recovery, actual arrows, nesting and misleading comment arrows are distinct.
func FuzzEffectSlotRecovery(f *testing.F) {
	startShortBudget(f)
	requireEffectSlotRecoveryQuotes(f)
	for _, h := range effectSlotRecoveryHeads {
		for _, s := range effectSlotRecoverySlots {
			for _, m := range effectSlotRecoveryModes {
				for _, tr := range effectSlotRecoveryTrivia {
					f.Add(h.key + "/" + s.key + "/" + m + "/" + tr.key)
				}
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string) {
		parts := strings.Split(key, "/")
		hi, si, mi, ti := -1, -1, -1, -1
		if len(parts) == 4 {
			for i, h := range effectSlotRecoveryHeads {
				if h.key == parts[0] {
					hi = i
				}
			}
			for i, s := range effectSlotRecoverySlots {
				if s.key == parts[1] {
					si = i
				}
			}
			mi = slices.Index(effectSlotRecoveryModes, parts[2])
			for i, tr := range effectSlotRecoveryTrivia {
				if tr.key == parts[3] {
					ti = i
				}
			}
		}
		if hi < 0 || si < 0 || mi < 0 || ti < 0 {
			var choice uint64
			for _, b := range []byte(key) {
				choice = choice*33 + uint64(b)
			}
			hi = int(choice % uint64(len(effectSlotRecoveryHeads)))
			choice /= uint64(len(effectSlotRecoveryHeads))
			si = int(choice % uint64(len(effectSlotRecoverySlots)))
			choice /= uint64(len(effectSlotRecoverySlots))
			mi = int(choice % uint64(len(effectSlotRecoveryModes)))
			choice /= uint64(len(effectSlotRecoveryModes))
			ti = int(choice % uint64(len(effectSlotRecoveryTrivia)))
		}
		h, s, m, tr := effectSlotRecoveryHeads[hi], effectSlotRecoverySlots[si], effectSlotRecoveryModes[mi], effectSlotRecoveryTrivia[ti]
		key = h.key + "/" + s.key + "/" + m + "/" + tr.key
		operand := h.text + tr.text
		switch m {
		case "written":
			operand += "=> string"
		case "grouped":
			operand = "(" + operand + "=> string)"
		case "missing-return":
			operand += "=> "
		}
		native := "export type T = " + operand + "\nexport {}\n"
		vibe := "export type T = " + fmt.Sprintf(s.text, operand) + "\nexport {}\n"
		codes := func(source, name string) (ordinary, custom []int32) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, core.ScriptKindTS)
			for _, d := range file.Diagnostics() {
				if d.Source() == "EK" {
					custom = append(custom, d.Code())
				} else {
					ordinary = append(ordinary, d.Code())
				}
			}
			slices.Sort(ordinary)
			slices.Sort(custom)
			return
		}
		nativeCodes, nativeCustom := codes(native, "/main.ts")
		if len(nativeCustom) != 0 || (len(nativeCodes) != 0) != (m == "recovered" || m == "missing-return") {
			t.Fatalf("invalid native generator control %s: ordinary=%v custom=%v\n%s", key, nativeCodes, nativeCustom, native)
		}
		ordinary, custom := codes(vibe, "/main.vibe")
		var wantCustom []int32
		if m == "written" || m == "missing-return" {
			wantCustom = []int32{301}
		}
		if !slices.Equal(custom, wantCustom) {
			Gap(t, "FuzzEffectSlotRecovery", key+":compound", "Appendix A: %s; %s; got custom=%v want=%v\n%s", effectSlotRecoveryQuote, effectSlotCompoundQuote, custom, wantCustom, vibe)
			return
		}
		if !slices.Equal(ordinary, nativeCodes) {
			Gap(t, "FuzzEffectSlotRecovery", key+":ordinary-syntax", "Appendix A: %s; ordinary diagnostics must match the same native operand: got=%v native=%v\n%s\n%s", effectSlotRecoveryQuote, ordinary, nativeCodes, vibe, native)
			return
		}
		ExpectPending(t, "FuzzEffectSlotRecovery", key)
		ExpectPending(t, "FuzzEffectSlotRecovery", specCorpusKey(t))
	})
}
