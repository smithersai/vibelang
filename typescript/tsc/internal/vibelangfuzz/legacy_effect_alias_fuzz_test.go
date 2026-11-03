package vibelangfuzz

import (
	"context"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const legacyAliasQuote = "`EK4856` selects the resolved legacy symbol: local and imported types named `Effect` retain their TypeScript meaning."

func legacyAliasQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{legacyAliasQuote, legacyHeritageQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatal(quote)
		}
	}
}
func TestLegacyEffectAliasQuoted(t *testing.T) { legacyAliasQuotes(t) }

// Chapter 007 / transitional legacy Effect alias warning follows the resolved symbol: docs/design/src/007-tooling.md#1605bee798b7ae9f
func FuzzLegacyEffectAlias(f *testing.F) {
	startShortBudget(f)
	keys := append([]string{"legacy-global", "local-type", "imported-type"}, legacyHeritageKeys...)
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	legacyAliasQuotes(f)
	legacyHeritageNativeControls(f, w, StockTypeScript(f))
	for _, key := range legacyHeritageKeys {
		f.Add(key, uint8(11))
	}
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
		heritage := slices.Contains(legacyHeritageKeys, key)
		if heritage {
			files, _ = legacyHeritageProject(key, shape, false)
			use = files["main.vibe"]
		}
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
		if strings.HasPrefix(key, "legacy-") {
			want = 1
		}
		if warnings != want || len(errors) != 0 {
			Gap(t, "FuzzLegacyEffectAlias", key, "chapter 007 %q: want %d EK4856 and no errors; got %d, %v; %s", legacyAliasQuote, want, warnings, errors, use)
		}
		if heritage {
			checkLegacyHeritageFix(t, w, key, shape, r)
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

// Chapter 007 / legacy Effect alias migration follows resolved bindings: docs/design/src/007-tooling.md#1a09c1e0aa1b713f
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

// Heritage clauses cannot contain the A!E!R spelling. These programs cover
// interface extends and class implements with all three generic arities.
// Local/imported aliases remain TypeScript types under the same spellings.
var legacyHeritageKeys = []string{"legacy-interface", "legacy-class", "local-interface", "local-class", "imported-interface", "imported-class"}

const legacyHeritageQuote = "and with qualified `Effect.Effect<A, E, R>` otherwise, heritage elements included"

func legacyHeritageProject(key string, shape uint8, native bool) (map[string]string, string) {
	typ := []string{"number", "string", "number | string", "readonly number[]"}[int(shape)%4]
	args := typ
	arity := int(shape/4)%3 + 1
	if arity >= 2 {
		args += ", Error"
	}
	if arity == 3 {
		args += ", { readonly need: true }"
	}
	scope, form, _ := strings.Cut(key, "-")
	alias := "type Effect<A,E=never,R=never> = {readonly value:A; readonly error:E; readonly requirements:R};\n"
	prefix, base, heritage := "", "Effect.Effect<"+args+">", "Effect<"+args+">"
	files := map[string]string{}
	switch scope {
	case "local":
		prefix = alias
		base = heritage
	case "imported":
		prefix = "import type { Effect } from \"./native.js\";\n"
		files["native.ts"] = "export " + alias
		base = heritage
	case "legacy":
		if native {
			prefix = "import { Effect } from \"effect\";\n"
			heritage = base
		}
	}
	clause := "extends "
	body := "export interface Child extends " + heritage + " { readonly marker:true }\n"
	if form == "class" {
		clause = "implements "
		body = "declare const Base: new () => " + base + ";\nexport class Child extends Base implements " + heritage + " { readonly marker=true }\n"
	}
	file := "main.vibe"
	if native {
		file = "main.ts"
	}
	files[file] = prefix + body
	wanted := clause + heritage
	if scope == "legacy" {
		wanted = clause + "Effect.Effect<" + args + ">"
	}
	return files, wanted
}

func legacyHeritageNativeControls(tb testing.TB, w *Workspace, tsc string) {
	tb.Helper()
	files := map[string]string{}
	for _, key := range legacyHeritageKeys {
		for shape := uint8(0); shape < 12; shape++ {
			project, _ := legacyHeritageProject(key, shape, true)
			for name, text := range project {
				files[key+"-"+strconv.Itoa(int(shape))+"/"+name] = text
			}
		}
	}
	dir, err := w.writeProject(Project{Files: files})
	if err != nil {
		tb.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(tb.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil || err != nil {
		tb.Fatalf("heritage stock TypeScript controls did not compile: %v %v\n%s", ctx.Err(), err, output)
	}
	tb.Log("72 stock TypeScript heritage controls compile: six symbol/context families, four A types and three arities")
}

func checkLegacyHeritageFix(t *testing.T, w *Workspace, key string, shape uint8, r *Result) {
	t.Helper()
	files, wanted := legacyHeritageProject(key, shape, false)
	config := toolsConfig(w, r.Dir)
	if config == nil || len(config.Errors) != 0 {
		t.Fatal("missing valid heritage fix configuration")
	}
	var fixed *vibelang.FixResult
	toolsRun(t, "FuzzLegacyEffectAlias", "heritage-fix", Archive(files), nil, func() {
		fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
	})
	if fixed.Err != nil {
		t.Fatalf("heritage fix failed: %v", fixed.Err)
	}
	after := maps.Clone(files)
	for path, file := range fixed.Files {
		rel, err := filepath.Rel(r.Dir, path.AsString())
		if err != nil {
			t.Fatal(err)
		}
		if rel != "main.vibe" {
			t.Fatalf("heritage fix changed an unowned/dependency file: %s", rel)
		}
		after[rel] = file.Text
	}
	compact := func(text string) string { return strings.Join(strings.Fields(text), "") }
	if !strings.Contains(compact(after["main.vibe"]), compact(wanted)) {
		Gap(t, "FuzzLegacyEffectAlias", "fix:"+key, "chapter 007 %q: retain argument/default slots and use the grammar's heritage spelling %q; got:\n%s", legacyHeritageQuote, wanted, after["main.vibe"])
	}
	compiled, err := w.Compile(t.Context(), Project{Files: after})
	if err != nil {
		t.Fatal(err)
	}
	defer compiled.Remove()
	for _, d := range compiled.Diagnostics {
		if d.Category() == diagnostics.CategoryError || d.Source() == "EK" && d.Code() == 4856 {
			Gap(t, "FuzzLegacyEffectAlias", "fixed:"+key, "the heritage fix must compile and retire its legacy-alias warning: %s\n%s", d.String(), after["main.vibe"])
		}
	}
}
