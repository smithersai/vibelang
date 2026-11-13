package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestBindingRenameOwnershipQuoted(t *testing.T) {
	text := SpecText("007-tooling.md")
	for _, quote := range []string{"Preserve runtime behavior and comments;"} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 007 no longer says %q", quote)
		}
	}
}

// Migration permits equivalent layout. Compare scanner tokens rather than
// incidental spaces in an expanded shorthand; keep every identifier/operator
// and comment. Return is the templates' line-break-sensitive production.
func bindingRenameOwnedTokens(a, b string) bool {
	left, right := toolsScan(a), toolsScan(b)
	if !slices.EqualFunc(left, right, func(x, y toolsToken) bool { return x.kind == y.kind && x.text == y.text }) {
		return false
	}
	for i, token := range left {
		if token.text != "return" {
			continue
		}
		j := i + 1
		for j < len(left) && toolsIsComment(left[j]) {
			j++
		}
		if j < len(left) && strings.ContainsAny(a[token.end:left[j].start], "\r\n\u2028\u2029") != strings.ContainsAny(b[right[i].end:right[j].start], "\r\n\u2028\u2029") {
			return false
		}
	}
	return true
}

func TestBindingRenameOwnershipTokenOracle(t *testing.T) {
	for _, tc := range []struct {
		a, b  string
		equal bool
	}{
		{"id:let id2", "id: let id2", true},
		{"return id;", "return id2;", false},
		{"return id;", "return\nid;", false},
		{"return /* note\n */ id;", "return /* note */ id;", false},
		{"/* keep */ return id;", "return id;", false},
	} {
		if got := bindingRenameOwnedTokens(tc.a, tc.b); got != tc.equal {
			t.Errorf("token oracle(%q,%q)=%t, want%t", tc.a, tc.b, got, tc.equal)
		}
	}
}
