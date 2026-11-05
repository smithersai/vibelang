package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestStreamLoopBodyIdentityQuoted(t *testing.T) {
	const quote = "An outward \x60return\x60 is \x60EK2002\x60, and a labeled jump out is \x60EK2003\x60"
	if !strings.Contains(SpecText("002-running.md"), quote) {
		t.Fatal("Stream-loop body authority changed")
	}
}
func FuzzStreamLoopBodyIdentity(f *testing.F) {
	startShortBudget(f)
	for shape := uint8(0); shape < 5; shape++ {
		f.Add(shape, false)
		f.Add(shape, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape uint8, alias bool) {
		TestStreamLoopBodyIdentityQuoted(t)
		name := "Stream"
		if alias {
			name = "S"
		}
		stream := name + ".make(1)"
		body := []string{
			"for try(const n of " + stream + ")return n",
			"outer:{for try(const n of " + stream + ")break outer}",
			"outer:for(const item of [" + stream + "]){for try(const n of item){continue outer}}",
			"for try(const n of xs){}",
			"for try(const n of " + stream + "){if(n)break}",
		}[shape%5]
		want := [][]string{{"EK2002"}, {"EK2003"}, {"EK2003"}, {"EK2004"}, nil}[shape%5]
		source := "import * as " + name + " from 'effect/Stream';\nexport effect function run(xs:AsyncIterable<number>){" + body + "}"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzStreamLoopBodyIdentity", fmt.Sprintf("%d/%t", shape, alias), "each Stream-loop restriction retains its owner error without generic head diagnostics; got %v want %v", got, want)
		}
	})
}
