package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentClassJumpTarget = "FuzzConcurrentClassHeadJumps"
const concurrentClassBreakQuote = "`break` that would leave head binding initialization or the body"
const concurrentClassContinueQuote = "a labeled `continue` in head binding initialization or the body naming a statement that encloses the `for concurrent`"

func TestConcurrentClassHeadJumpsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentClassBreakQuote)
	chapterSays(t, "002-running.md", concurrentClassContinueQuote)
	chapterSays(t, "002-running.md", concurrentUsedLabelQuote)
}

func FuzzConcurrentClassHeadJumps(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", concurrentClassBreakQuote)
	chapterSays(f, "002-running.md", concurrentClassContinueQuote)
	chapterSays(f, "002-running.md", concurrentUsedLabelQuote)
	heads := []struct{ key, source string }{
		{"computed-name", "class C { [do { %; \"m\" }](){} }"},
		{"member-decorator", "class C { @(do { %; ((v:unknown,c:unknown)=>{}) }) m(){} }"},
		{"class-decorator", "@(do { %; ((v:unknown,c:unknown)=>{}) }) class C {}"},
		{"heritage", "class C extends do { %; (class {}) } {}"},
	}
	keys := make([]string, len(heads))
	for i, head := range heads {
		keys[i] = head.key
		for _, mode := range []byte{0, 1, 2, 3, 4, 6, 8, 10, 15, 16, 18, 31} {
			f.Add(append([]byte(head.key+":"), mode))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, tail := keyedChoice(keys, data)
		var mode byte
		if len(tail) > 0 {
			mode = tail[0]
		}
		jump, code := "break outer", int32(1903)
		if mode&2 != 0 {
			jump, code = "continue outer", 1905
		}
		limit := ""
		if mode&1 != 0 {
			limit = "(1)"
		}
		outer := "outer:for(const n of [1])"
		if mode&4 != 0 {
			outer = "outer:for concurrent(const n of [1])"
		}
		head := strings.Replace(heads[i].source, "%", jump, 1)
		item := "for concurrent" + limit + "(const m of [1]){" + head + "}"
		if mode&8 != 0 {
			item = "for concurrent" + limit + "(const {m=do {" + head + ";0}} of [{m:0}]){}"
		}
		if mode&16 != 0 {
			outer = strings.Replace(outer, "outer:", "outer:unused:", 1)
		}
		source := "effect function f(){" + outer + "{" + item + "}}"
		controls := []string{
			"effect function f(){for concurrent(const n of [1]){class C { [do { local:{break local}; \"m\" }](){} }}}",
			"effect function f(){for concurrent(const n of [1]){class C { [do { for(let i=0;i<1;i++){continue}; \"m\" }](){} }}}",
			"effect function f(){for concurrent(const n of [1]){class C { m(){return 1} }}}",
		}
		for j, input := range append([]string{source}, controls...) {
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
			r, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			var got []int32
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			r.Remove()
			var want []int32
			if j == 0 {
				want = append(want, code)
				if mode&16 != 0 {
					want = append(want, 7028)
				}
			}
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				key := fmt.Sprintf("%s:%d:%d", heads[i].key, mode&31, j)
				Gap(t, concurrentClassJumpTarget, key, "%s; %s; want %v, got %v\n%s", concurrentClassBreakQuote, concurrentClassContinueQuote, want, got, input)
				return
			}
		}
	})
}
