package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const legacyAliasQuote = "`EK4856` selects the resolved legacy symbol: local and imported types named `Effect` retain their TypeScript meaning."

func TestLegacyEffectAliasQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacyAliasQuote) {
		t.Fatal(legacyAliasQuote)
	}
}
func FuzzLegacyEffectAlias(f *testing.F) {
	startShortBudget(f)
	keys := []string{"legacy-global", "local-type", "imported-type"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape uint8) {
		TestLegacyEffectAliasQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		typ := []string{"number", "string", "number | string", "readonly number[]"}[int(shape)%4]
		use := "export let result: Effect<" + typ + ">;"
		files := map[string]string{}
		switch key {
		case "local-type":
			use = "type Effect<A> = { value:A };" + use
		case "imported-type":
			use = "import type { Effect } from \"./native.js\";" + use
			files["native.ts"] = "export type Effect<A> = { value:A };"
		}
		files["main.vibe"] = use
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		warnings, errors := 0, []string{}
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4856 {
				warnings++
			}
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, fmt.Sprint(d))
			}
		}
		want := 0
		if key == "legacy-global" {
			want = 1
		}
		if warnings != want || len(errors) != 0 {
			Gap(t, "FuzzLegacyEffectAlias", key, "chapter 007 %q: want %d EK4856 and no errors; got %d, %v; %s", legacyAliasQuote, want, warnings, errors, use)
		}
		ExpectPending(t, "FuzzLegacyEffectAlias", key)
		ExpectPending(t, "FuzzLegacyEffectAlias", specCorpusKey(t))
	})
}

// Loop round 15 OPUS-3: VIP-3 and chapter 7 gave EK4856's repair two triggers
// for the qualified form. Decided detail 260 (2026-11-02) fixed one rule,
// quoted here from chapter 7. The oracle checks the rule itself against the
// grammar, independent of the (pending) quick fix: the spelling it picks
// compiles and means the same type as Effect.Effect<…> in that position, and
// wherever it picks the qualified form, the shorthand without new
// parentheses does not.
const legacyAliasRepairQuote = "with `A!E!R` where that needs no new parentheses, and with qualified `Effect.Effect<A, E, R>` otherwise, heritage elements included"

func TestLegacyEffectAliasRepairQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacyAliasRepairQuote) {
		t.Fatal(legacyAliasRepairQuote)
	}
}

type aliasRepairPosition struct {
	key, tmpl  string
	needsGroup bool // the shorthand needs new parentheses here (Appendix A EffectOperand, VIP-3 2026-10-29 amendments)
	heritage   bool
}

type aliasRepairSlots struct {
	key   string
	slots []string
}

var aliasRepairPositions = []aliasRepairPosition{
	{key: "variable", tmpl: "%s"},
	{key: "type-argument", tmpl: "Array<%s>"},
	{key: "tuple", tmpl: "[%s]"},
	{key: "function-return", tmpl: "() => %s"},
	{key: "array", tmpl: "%s[]", needsGroup: true},
	{key: "union-member", tmpl: "%s | undefined", needsGroup: true},
	{key: "interface-extends", tmpl: "interface I extends %s {}", needsGroup: true, heritage: true},
	{key: "class-implements", tmpl: "declare class C implements %s {}", needsGroup: true, heritage: true},
}

var aliasRepairSlotSets = []aliasRepairSlots{
	{key: "one", slots: []string{"number"}},
	{key: "two", slots: []string{"string", "Error"}},
	{key: "written-never", slots: []string{"string", "never"}},
	{key: "three-object", slots: []string{"number", "Error", "{ n: number }"}},
	{key: "array-success", slots: []string{"number[]"}},
	{key: "union-success", slots: []string{"number | string"}},
}

func aliasRepairKeys() []string {
	var keys []string
	for _, p := range aliasRepairPositions {
		for _, s := range aliasRepairSlotSets {
			keys = append(keys, p.key+":"+s.key)
		}
	}
	return keys
}

func aliasShorthand(slots []string) string {
	a := slots[0]
	switch len(slots) {
	case 1:
		return a + "!!"
	case 2:
		return a + "!" + slots[1]
	}
	return a + "!" + slots[1] + "!" + slots[2]
}

func FuzzLegacyEffectAliasRepair(f *testing.F) {
	startShortBudget(f)
	keys := aliasRepairKeys()
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestLegacyEffectAliasRepairQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		pos := aliasRepairPositions[i/len(aliasRepairSlotSets)]
		set := aliasRepairSlotSets[i%len(aliasRepairSlotSets)]
		group := pos.needsGroup || strings.ContainsAny(set.slots[0], "|&")
		qualified := "Effect.Effect<" + strings.Join(set.slots, ", ") + ">"
		repaired := qualified
		if !group {
			repaired = aliasShorthand(set.slots)
		}
		files := map[string]string{}
		if pos.heritage {
			files["main.vibe"] = "export " + fmt.Sprintf(pos.tmpl, repaired) + "\n"
		} else {
			files["main.vibe"] = aliasSameType("main", fmt.Sprintf(pos.tmpl, repaired), fmt.Sprintf(pos.tmpl, qualified))
			if group {
				// The shorthand without new parentheses must not be a valid spelling of the same type.
				files["naive.vibe"] = aliasSameType("naive", fmt.Sprintf(pos.tmpl, aliasShorthand(set.slots)), fmt.Sprintf(pos.tmpl, qualified))
			}
		}
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		mainErrors, naiveErrors := []string{}, 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			name := ""
			if d.File() != nil {
				name = d.File().FileName().AsString()
			}
			switch {
			case strings.HasSuffix(name, "naive.vibe"):
				naiveErrors++
			case pos.key == "class-implements" && d.Code() >= 2000:
				// An ambient class that implements an Effect lacks its members; only syntax counts here.
			default:
				mainErrors = append(mainErrors, fmt.Sprint(d))
			}
		}
		if len(mainErrors) != 0 {
			Gap(t, "FuzzLegacyEffectAliasRepair", key, "chapter 007 %q: %s must compile and mean %s; got %v\n%s", legacyAliasRepairQuote, repaired, qualified, mainErrors, files["main.vibe"])
		}
		if group && !pos.heritage && naiveErrors == 0 {
			Gap(t, "FuzzLegacyEffectAliasRepair", key, "chapter 007 %q: the rule chose the qualified form, but the shorthand %s compiled as the same type without new parentheses (001: `A | B!E` is a syntax error, EK0301)", legacyAliasRepairQuote, aliasShorthand(set.slots))
		}
		ExpectPending(t, "FuzzLegacyEffectAliasRepair", key)
		ExpectPending(t, "FuzzLegacyEffectAliasRepair", specCorpusKey(t))
	})
}

// aliasSameType declares got and want and requires them mutually assignable,
// so a spelling that parses but means another type is an error.
func aliasSameType(name, got, want string) string {
	return fmt.Sprintf("type Got_%[1]s = %[2]s\ntype Want_%[1]s = %[3]s\nexport const same_%[1]s: [Got_%[1]s] extends [Want_%[1]s] ? [Want_%[1]s] extends [Got_%[1]s] ? true : false : false = true\n", name, got, want)
}
