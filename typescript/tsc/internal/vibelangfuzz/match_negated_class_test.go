package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const negatedClassQuote = "the false branch of the actual positive test: `!(s instanceof C)` only for an ordinary class using `instanceof`"

func TestNegatedClassQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), negatedClassQuote) {
		t.Fatalf("chapter 4 no longer says %q", negatedClassQuote)
	}
}

var negatedClassRules = []struct{ key, decl, subject, matcher, member string }{
	{"date", "", "Date", "Date", "getUTCFullYear()"},
	{"regexp", "", "RegExp", "RegExp", "source"},
	{"map", "", "Map<string,number>", "Map", "size"},
	{"set", "", "Set<number>", "Set", "size"},
	{"plain", "class C { n = 1 }", "C", "C", "n"},
	{"alias", "class C { n = 1 }; const Alias = C", "C", "Alias", "n"},
	{"member", "class C { n = 1 }; const helpers = { C }", "C", "helpers.C", "n"},
}

func FuzzNegatedClassNarrowing(f *testing.F) {
	startShortBudget(f)
	for _, r := range negatedClassRules {
		for _, form := range []string{"match", "is"} {
			f.Add(r.key+"/"+form, uint8(0))
			f.Add(r.key+"/"+form, uint8(1))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestNegatedClassQuoted(t)
		i, form := 0, "match"
		if key != "" {
			i = int(key[0]) % len(negatedClassRules)
		}
		for j, r := range negatedClassRules {
			if strings.HasPrefix(key, r.key+"/") {
				i = j
			}
		}
		if strings.HasSuffix(key, "/is") {
			form = "is"
		}
		r := negatedClassRules[i]
		read := "s.kind"
		if mode&1 != 0 {
			read = "s.missing"
		}
		prefix := r.decl + "; export function probe(s:" + r.subject + " | { kind:string }) { "
		native := prefix + "if (!(s instanceof " + r.matcher + ")) return " + read + "; return s." + r.member + " }"
		pattern := "not /* pattern */ " + r.matcher
		if mode&2 != 0 {
			pattern = "not (" + r.matcher + ")"
		}
		body := "return match(s) { when " + pattern + ": " + read + "; default: s." + r.member + "; }"
		if form == "is" {
			body = "if (s is " + pattern + ") return " + read + "; return s." + r.member
		}
		source := prefix + body + " }"
		option := reviewPatternOption{key: "strict"}
		want := reviewPatternOptionCodes(t, w, native, option, false)
		actual := reviewPatternOptionCodes(t, w, source, option, true)
		if mode&1 == 0 && len(want) != 0 {
			t.Fatalf("invalid native positive control: %v\n%s", want, native)
		}
		if mode&1 != 0 && len(want) == 0 {
			t.Fatal("native negative control unexpectedly passed")
		}
		if !slices.Equal(actual, want) {
			Gap(t, "FuzzNegatedClassNarrowing", r.key+"/"+form, "VIP-7: %s; native=%v vibe=%v\n%s", negatedClassQuote, want, actual, source)
		}
	})
}
