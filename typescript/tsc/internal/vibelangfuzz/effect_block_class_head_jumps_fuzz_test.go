package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectBlockHeadJumpTarget = "FuzzEffectBlockClassHeadJumps"
const effectBlockHeadJumpQuote = "A `break` or `continue` inside an `effect { … }` block whose target lies outside the block is `EK0202`"

const effectBlockHeadTypeScriptQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."

func TestEffectBlockClassHeadJumpsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", effectBlockHeadJumpQuote)
	chapterSays(t, "000-intro.md", effectBlockHeadTypeScriptQuote)
}

func FuzzEffectBlockClassHeadJumps(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", effectBlockHeadJumpQuote)
	chapterSays(f, "000-intro.md", effectBlockHeadTypeScriptQuote)
	heads := []struct{ key, source string }{
		{"computed-method", "class C { [do { %; \"m\" }](){} }"},
		{"computed-field", "class C { [do { %; \"m\" as const }]=0 }"},
		{"member-decorator", "class C { @(do { %; ((v:unknown,c:unknown)=>{}) }) m(){} }"},
		{"class-decorator", "@(do { %; ((v:unknown,c:unknown)=>{}) }) class C {}"},
		{"heritage", "class C extends do { %; (class {}) } {}"},
		{"object-method", "const object = { [do { %; \"m\" }](){} }"},
	}
	keys := make([]string, len(heads))
	for i, h := range heads {
		keys[i] = h.key
		for _, mode := range []byte{0, 1, 2, 3, 4, 5, 8, 9, 16, 17, 24, 25} {
			f.Add(append([]byte(h.key+":"), mode))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, tail := keyedChoice(keys, data)
		var mode byte
		if len(tail) > 0 {
			mode = tail[0]
		}
		jump := "break"
		if mode&1 != 0 {
			jump = "continue"
		}
		if mode&2 == 0 {
			jump += " outer"
		}
		if mode&8 != 0 {
			jump = "(do { " + jump + ";0 })"
		}
		head := strings.Replace(heads[i].source, "%", jump, 1)
		outer := "outer:for(const n of [1])"
		kind := "effect function"
		if mode&4 != 0 && mode&16 == 0 {
			kind = "function"
		}
		if mode&16 != 0 {
			outer = "outer:for concurrent(const n of [1])"
		}
		source := kind + " f(){" + outer + "{const e=effect {" + head + "};}}"
		inputs := []string{
			source,
			"effect function f(){const e=effect {class C { [do { local:{break local}; \"m\" }](){} }}}",
			"effect function f(){const e=effect {class C { [do { for(let i=0;i<1;i++){continue}; \"m\" }](){} }}}",
			"effect function f(){const e=effect {class C { m(){local:{break local};return 1} }}}",
		}
		for j, input := range inputs {
			var config map[string]any
			if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
				t.Fatal(err)
			}
			config["compilerOptions"].(map[string]any)["allowUnusedLabels"] = true
			config["files"] = []string{"main.vibe"}
			raw, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			project := Single(input)
			project.Config = string(raw)
			result, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			var got []int32
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			result.Remove()
			var want []int32
			if j == 0 {
				want = []int32{202}
				if heads[i].key == "computed-field" {
					// Non-entity field names separately retain TypeScript's TS1166.
					want = append(want, 1166)
				}
			}
			slices.Sort(got)
			if !slices.Equal(got, want) {
				key := fmt.Sprintf("%s:%d:%d", heads[i].key, mode&31, j)
				Gap(t, effectBlockHeadJumpTarget, key, "%s; %s; want %v, got %v\n%s", effectBlockHeadJumpQuote, effectBlockHeadTypeScriptQuote, want, got, input)
				return
			}
		}
	})
}
