package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const forTryClassHeadTarget = "FuzzForTryClassHeadJumps"
const forTryClassHeadQuote = "An outward `return` is `EK2002`, and a labeled jump out is `EK2003`, in `for try` head binding initialization or the body"
const forTryConcurrentReturnQuote = "`return` targeting the enclosing function in head binding initialization or the body: `for concurrent (const x of xs) { return x }`"

func TestForTryClassHeadJumpsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", forTryClassHeadQuote)
	chapterSays(t, "002-running.md", forTryConcurrentReturnQuote)
	chapterSays(t, "000-intro.md", "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.")
}

func FuzzForTryClassHeadJumps(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", forTryClassHeadQuote)
	chapterSays(f, "002-running.md", forTryConcurrentReturnQuote)
	heads := []struct{ key, source string }{
		{"computed-method", "class C { [do { %; \"m\" }](){} }"},
		{"computed-field", "class C { [do { %; \"m\" as const }]=0 }"},
		{"member-decorator", "class C { @(do { %; ((v:unknown,c:unknown)=>{}) }) m(){} }"},
		{"class-decorator", "@(do { %; ((v:unknown,c:unknown)=>{}) }) class C {}"},
		{"heritage", "class C extends do { %; (class {}) } {}"},
		{"object-method", "const object = { [do { %; \"m\" }](){} }"},
	}
	type choice struct {
		key                           string
		head, position, context, jump int
	}
	var choices []choice
	var keys []string
	for h, head := range heads {
		for p, position := range []string{"body", "head"} {
			for c, context := range []string{"effect", "concurrent", "block"} {
				for j, jump := range []string{"break", "continue", "return"} {
					key := head.key + ":" + position + ":" + context + ":" + jump
					choices = append(choices, choice{key, h, p, c, j})
					keys = append(keys, key)
					f.Add([]byte(key))
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, tail := keyedChoice(keys, data)
		pick := choices[i]
		head := heads[pick.head]
		var mode byte
		if len(tail) > 0 {
			mode = tail[0]
		}
		statement, code := "break outer", int32(2003)
		if pick.jump == 1 {
			statement = "continue outer"
		}
		if pick.jump == 2 {
			value := "\"m\" as const"
			if strings.Contains(head.key, "decorator") {
				value = "((v:unknown,c:unknown)=>{})"
			}
			if head.key == "heritage" {
				value = "(class {})"
			}
			statement, code = "return "+value, 2002
		}
		definition := strings.Replace(head.source, "%", statement, 1)
		loop := "for try(const item of Stream.make(1)){" + definition + "}"
		if pick.position == 1 {
			loop = "for try(const {item=do {" + definition + ";0}} of Stream.make({item:undefined as number|undefined})){}"
		}
		outer := "for(const n of [1])"
		if pick.context == 1 {
			outer = "for concurrent(const n of [1])"
		}
		if pick.jump != 2 {
			outer = "outer:" + outer
			if mode&1 != 0 {
				outer = strings.Replace(outer, "outer:", "outer:unused:", 1)
			}
		}
		source := "effect function f(){" + outer + "{" + loop + "}}"
		if pick.context == 2 {
			source = "effect function f(){const e=effect {" + outer + "{" + loop + "}}}"
		}
		inputs := []string{
			source,
			"effect function f(){for try(const item of Stream.make(1)){class C { [do { local:{break local}; \"m\" }](){} }}}",
			"effect function f(){for try(const item of Stream.make(1)){class C { m(){return 1} }}}",
		}
		for j, input := range inputs {
			var config map[string]any
			if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
				t.Fatal(err)
			}
			config["compilerOptions"].(map[string]any)["allowUnusedLabels"] = false
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
			var got, want []int32
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			result.Remove()
			if j == 0 {
				want = append(want, code)
				if head.key == "computed-field" {
					want = append(want, 1166)
				}
				if pick.context == 1 && pick.jump == 2 {
					want = append(want, 1904)
				}
				if mode&1 != 0 && pick.jump != 2 {
					want = append(want, 7028)
				}
			}
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				key := fmt.Sprintf("%s:%d:%d", pick.key, mode&1, j)
				Gap(t, forTryClassHeadTarget, key, "%s; want %v, got %v\n%s", forTryClassHeadQuote, want, got, input)
				return
			}
		}
	})
}
