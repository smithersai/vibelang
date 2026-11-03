package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const genericMatchTarget = "FuzzGenericMatchCoverage"
const genericMatchQuote = "A constrained type parameter uses its finite constraint as a conservative domain; an unconstrained parameter or a broad constraint stays open."

func TestGenericMatchCoverageQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), genericMatchQuote) {
		t.Fatal("VIP-7 generic coverage rule changed")
	}
}

type genericMatchRule struct {
	key, constraint, a, b string
	open                  bool
}

var genericMatchRules = []genericMatchRule{
	{"literal", `"A" | "B"`, `"A"`, `"B"`, false},
	{"number", "1 | 2", "1", "2", false},
	{"boolean", "boolean", "true", "false", false},
	{"nullable", `"A" | null`, `"A"`, "null", false},
	{"tagged", `{_tag:"A"} | {_tag:"B"}`, `{_tag:"A"}`, `{_tag:"B"}`, false},
	{"open", "", `"A"`, `"B"`, true},
	{"broad-string", "string", `"A"`, `"B"`, true},
	{"broad-object", `{_tag:string}`, `{_tag:"A"}`, `{_tag:"B"}`, true},
}

// Generate partial/full matches, either omitted arm, explicit defaults,
// chained constraints and plain/async/effect contexts. The oracle is VIP-7's
// conservative finite domain, independent of the compiler's flow result.
func FuzzGenericMatchCoverage(f *testing.F) {
	startShortBudget(f)
	for _, rule := range genericMatchRules {
		for _, flags := range []uint8{0, 1, 2, 4, 8, 16, 32} {
			f.Add(rule.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestGenericMatchCoverageQuoted(t)
		i := slices.IndexFunc(genericMatchRules, func(r genericMatchRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(genericMatchRules)
		}
		r := genericMatchRules[i]
		params := "T"
		if r.constraint != "" {
			params += " extends " + r.constraint
		}
		if flags&8 != 0 {
			params = strings.Replace(params, "T", "U", 1) + ", T extends U"
		}
		a, b := r.a, r.b
		if flags&2 != 0 {
			a, b = b, a
		}
		arms := "when " + a + ": 1;"
		if flags&1 != 0 {
			arms += " when " + b + ": 2;"
		}
		if flags&4 != 0 {
			arms += " default: 0;"
		}
		prefix := ""
		if flags&16 != 0 {
			prefix = "async "
		}
		if flags&32 != 0 {
			prefix = "effect "
		}
		source := fmt.Sprintf("export %sfunction f<%s>(s:T){return match(s){%s}}", prefix, params, arms)
		var result *Result
		var err error
		within(t, "generic match coverage", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		missing := false
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 4701 {
				missing = true
			} else if d.Category().Name() == "error" {
				Gap(t, genericMatchTarget, r.key+":other", "unexpected diagnostic %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		want := !r.open && flags&1 == 0 && flags&4 == 0
		oracleKey := fmt.Sprintf("%s:%d", r.key, flags)
		if missing != want {
			Gap(t, genericMatchTarget, oracleKey, "VIP-7 requires EK4701=%t, got %v\n%s", want, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		ExpectPending(t, genericMatchTarget, oracleKey)
		ExpectPending(t, genericMatchTarget, specCorpusKey(t))
	})
}
