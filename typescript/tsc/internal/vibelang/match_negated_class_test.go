package vibelang

import "testing"

// VIP-7 types a negated ordinary-class arm as the false branch of instanceof.
// The native statement is a positive control for each matching pattern test.
func TestNegatedOrdinaryClassNarrowing(t *testing.T) {
	for _, test := range []struct{ decl, subject, matcher, member string }{
		{"", "Date", "Date", "getUTCFullYear()"},
		{"", "RegExp", "RegExp", "source"},
		{"", "Map<string, number>", "Map", "size"},
		{"", "Set<number>", "Set", "size"},
		{"class Plain { n = 1 }", "Plain", "Plain", "n"},
		{"class Plain { n = 1 }; const Alias = Plain", "Plain", "Alias", "n"},
		{"class Plain { n = 1 }; const helpers = { Plain }", "Plain", "helpers.Plain", "n"},
	} {
		for _, form := range []string{"native", "match", "is"} {
			body := "if (!(s instanceof " + test.matcher + ")) return s.kind; return s." + test.member
			if form == "match" {
				body = "return match(s) { when not " + test.matcher + ": s.kind; default: s." + test.member + "; }"
			}
			if form == "is" {
				body = "if (s is not " + test.matcher + ") return s.kind; return s." + test.member
			}
			source := test.decl + "; export function probe(s: " + test.subject + " | { kind: string }) { " + body + " }"
			if ds := errorsOf(t, source); len(ds) != 0 {
				t.Errorf("%s %s: %v\n%s", form, test.matcher, ds, source)
			}
		}
	}
}
