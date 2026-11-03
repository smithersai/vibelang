package vibelangfuzz

import (
	"context"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const asyncMaskPlacementQuote = "`EK2201` fires, not `EK2111`"
const asyncMaskBoundaryQuote = "an `async match` is one, as a nested `async` function is"

func TestAsyncMaskPlacementQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", asyncMaskPlacementQuote)
	chapterSays(t, "002-running.md", asyncMaskBoundaryQuote)
}
func FuzzAsyncMaskPlacement(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", asyncMaskPlacementQuote)
	chapterSays(f, "002-running.md", asyncMaskBoundaryQuote)
	forms := []string{"declaration", "expression", "arrow", "class-method", "object-method", "generator", "do", "computed-name", "nested-mask", "outer-mask-async", "effect-control"}
	words := []string{"uninterruptible", "interruptible", "restore"}
	keys := []string{}
	for _, form := range forms {
		for _, word := range words {
			k := form + ":" + word
			keys = append(keys, k)
			f.Add([]byte(k))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		form := forms[choice/3]
		word := words[choice%3]
		body := word + " {}"
		want := 1
		source := ""
		switch form {
		case "declaration":
			source = "async function f(){" + body + "}"
		case "expression":
			source = "const f=async function(){" + body + "}"
		case "arrow":
			source = "const f=async ()=>{" + body + "}"
		case "class-method":
			source = "class C {async f(){" + body + "}}"
		case "object-method":
			source = "const o={async f(){" + body + "}}"
		case "generator":
			source = "async function* f():AsyncGenerator<number,void,unknown>{" + body + ";yield 1}"
		case "do":
			source = "async function f(){const value=do {" + body + ";0}}"
		case "computed-name":
			source = "async function f(){const o={[(do {" + body + "},\"m\")](){return 1}}}"
		case "nested-mask":
			source = "async function f(){uninterruptible {" + body + "}}"
			want = 2
		case "outer-mask-async":
			source = "effect function outer(){uninterruptible {const later=async ()=>{" + body + "}}}"
		case "effect-control":
			if word == "restore" {
				body = "uninterruptible {" + body + "}"
			}
			source = "async function f(){const value=effect {" + body + "};return 0}"
			want = 0
		}
		r, err := w.Compile(context.Background(), Single("import {Effect} from \"effect\";"+source+";export {}"))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := 0
		bad := false
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				if IsEK(d) && d.Code() == 2201 {
					got++
				} else {
					bad = true
				}
			}
		}
		if bad || got != want {
			Gap(t, "FuzzAsyncMaskPlacement", keys[choice], "%s; want %d EK2201 only, got %v\n%s", asyncMaskPlacementQuote, want, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzAsyncMaskPlacement", keys[choice])
		ExpectPending(t, "FuzzAsyncMaskPlacement", specCorpusKey(t))
	})
}
