package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"
)

const concurrentLabeledBreakQuote = "`break` that would leave head binding initialization or the body"

func TestConcurrentLabeledBreakQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentLabeledBreakQuote)
}

// A break that would leave a for concurrent item is EK1903 whether or not it
// names a label: an enclosing loop or block, the loop's own label, or a jump
// from its head binding initialization. Breaks that stay inside the item keep
// JavaScript's meaning, a written function keeps TypeScript's TS1107, and a
// for try inside the item reports its own outward jump as EK2003.
func FuzzConcurrentLabeledBreak(f *testing.F) {
	startShortBudget(f)
	variants := []struct{ key, head, body, want string }{
		{"unlabeled", "", "break", "EK1903"},
		{"outer-loop", "", "break outer", "EK1903"},
		{"outer-block", "", "if(x)break blk", "EK1903"},
		{"own", "", "break own", "EK1903"},
		{"native-loop", "", "for(const z of [1]){break outer}", "EK1903"},
		{"switch", "", "switch(x){case 1:break outer}", "EK1903"},
		{"nested-item", "", "for concurrent(const z of [1]){break outer}", "EK1903"},
		{"nested-own", "", "for concurrent(const z of [1]){break own}", "EK1903"},
		{"head-default", "const {v=do{if(n)break outer;7}} of [{v:undefined}]", "", "EK1903"},
		{"head-array", "const [v=do{break blk}] of [[undefined]]", "", "EK1903"},
		{"do-operand", "", "Math.max(do{if(x)break outer;1},0)", "EK1903"},
		{"for-try", "", "for try(const y of Stream.make(x)){break outer}", "EK2003"},
		{"local-loop", "", "inner:for(const z of [1]){break inner}", ""},
		{"local-block", "", "local:{if(x)break local}", ""},
		{"local-switch", "", "switch(x){case 1:break}", ""},
		{"written-callable", "", "const f=()=>{break outer}", "TS1107"},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte("key:" + v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestConcurrentLabeledBreakQuoted(t)
		v := variants[r3Pick(data, keys)]
		n := 0
		if len(data) > 0 {
			n = int(data[len(data)-1])
		}
		labels := []string{"own:", "own:alias:", "alias:own:"}
		limits := []string{"", "(1)", "(2)"}
		head := v.head
		if head == "" {
			head = "const x of [1,2]"
		}
		source := fmt.Sprintf("export effect function main(){outer:for(const n of [1]){blk:{%s for concurrent%s(%s){%s}}};return 7}", labels[n%3], limits[(n/3)%3], head, v.body)
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r3Errors(r.Diagnostics)
		count := 0
		for _, code := range errs {
			if code == "EK1903" {
				count++
			}
		}
		var bad bool
		switch v.want {
		case "":
			bad = len(errs) > 0
		case "EK1903":
			bad = count != 1 || slices.Contains(errs, "TS1107")
		case "TS1107":
			bad = count != 0 || !slices.Contains(errs, "TS1107")
		case "EK2003":
			bad = count != 0 || !slices.Contains(errs, "EK2003")
		}
		if bad {
			Gap(t, "FuzzConcurrentLabeledBreak", "code:"+v.key, "chapter 2 says %q is EK1903; expected %q once, got %v in %s", concurrentLabeledBreakQuote, v.want, errs, source)
		}
	})
}
