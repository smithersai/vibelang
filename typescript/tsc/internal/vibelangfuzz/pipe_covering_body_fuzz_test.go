package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

// Chapter 2 keeps the pinned pipe proposal's yield and assignment
// covering-production errors under EK2301 (reviewPipeChapterQuote,
// reviewPipeSnapshotQuote). A whole unparenthesized yield or assignment body
// reports EK2301 and no native parse error; with parentheses an assignment
// body compiles.

const pipeCoveringBodyTarget = "FuzzPipeCoveringBody"

var pipeCoveringBodies = []struct{ name, body string }{
	{"assign", "z = %"}, {"add-assign", "z += %"}, {"nullish-assign", "z ??= %"},
	{"or-assign", "z ||= %"}, {"pow-assign", "z **= %"}, {"shift-assign", "z >>= %"},
	{"unsigned-shift-assign", "z >>>= %"}, {"member-assign", "o.k = %"},
	{"element-assign", "o[\"k\"] = %"}, {"chained-assign", "z = y = %"},
	{"yield", "yield %"}, {"yield-bare", "yield"},
}

func FuzzPipeCoveringBody(f *testing.F) {
	startShortBudget(f)
	for _, b := range pipeCoveringBodies {
		f.Add([]byte("key:" + b.name))
	}
	names := make([]string, len(pipeCoveringBodies))
	for i, b := range pipeCoveringBodies {
		names[i] = b.name
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestReviewPipeGrammarQuoted(t)
		b := pipeCoveringBodies[r3Pick(data, names)]
		stage := ""
		if len(data) > 1 && data[1]%2 == 1 {
			stage = "% + 1 |> "
		}
		compile := func(body string) []string {
			t.Helper()
			source := "declare const o: { k: number }\nlet z = 0, y = 0\nexport effect function* p() { const r = 1 |> " + stage + body + "; yield 1 }\nexport const after = 2\n"
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			return r3Errors(r.Diagnostics)
		}
		errs := compile(b.body)
		native := slices.ContainsFunc(errs, func(e string) bool { return e == "TS1005" || e == "TS1109" || e == "TS1134" || e == "TS1128" })
		if !slices.Contains(errs, "EK2301") || native {
			Gap(t, pipeCoveringBodyTarget, "code:"+b.name, "chapter 2 says %q; %s as a whole pipe body reports %v", reviewPipeChapterQuote, b.body, errs)
		}
		if strings.HasPrefix(b.name, "yield") {
			return
		}
		if errs := compile("(" + b.body + ")"); len(errs) > 0 {
			Gap(t, pipeCoveringBodyTarget, "control:"+b.name, "the parenthesized body (%s) must compile, reports %v", b.body, errs)
		}
	})
}
