package vibelangfuzz

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Two copies of a production, one in its chapter and one in Appendix A,
// drifted apart in review after review, so these tests keep the grammar in
// one place. They read it with spec_grammar.go.

// TestSpecProductionsOnlyInAppendixA fails when a chapter other than the
// appendices defines a production.
func TestSpecProductionsOnlyInAppendixA(t *testing.T) {
	dir := filepath.Join(Root(), "docs/design/src")
	chapters, err := filepath.Glob(filepath.Join(dir, "*.md"))
	if err != nil || len(chapters) == 0 {
		t.Fatalf("no chapters in %s: %v", dir, err)
	}
	for _, path := range chapters {
		name := filepath.Base(path)
		if name == grammarAppendix {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for n, line := range grammarLines(string(data)) {
			if m := production.FindStringSubmatch(line); m != nil {
				t.Errorf("%s:%d defines the production %s; write it in Appendix A only, and name it here", name, n, m[1])
			}
		}
	}
}

// productionLink is a chapter's citation of a production: a link to its
// anchor in the appendices, [TryExpression](900-appendices.md#tryexpression).
// A production's name is PascalCase, so a link such as
// [appendix](900-appendices.md#denied-vips) is prose, not a citation, and so
// is a PascalCase link to a section other than a production's, such as
// [Declarations](900-appendices.md#notes-on-the-productions).
var productionLink = regexp.MustCompile(`\[([A-Z][A-Za-z0-9]*)\]\(` + regexp.QuoteMeta(grammarAppendix) + `#([a-z0-9-]+)\)`)

// TestSpecCitedProductionsExist checks that every production a chapter cites
// is defined in Appendix A, under the anchor its name gives (lowercase, no
// separators), and that every production Appendix A defines has that anchor.
func TestSpecCitedProductionsExist(t *testing.T) {
	dir := filepath.Join(Root(), "docs/design/src")
	data, err := os.ReadFile(filepath.Join(dir, grammarAppendix))
	if err != nil {
		t.Fatal(err)
	}
	appendix := string(data)
	defined := appendixProductions(appendix)
	if len(defined) == 0 {
		t.Fatalf("%s defines no production under Appendix A's ### Productions", grammarAppendix)
	}
	have := anchors(appendix)
	productionAnchors := map[string]bool{}
	for name := range defined {
		productionAnchors[strings.ToLower(name)] = true
		if !have[strings.ToLower(name)] {
			t.Errorf("Appendix A defines %s but has no anchor %q for chapters to link", name, strings.ToLower(name))
		}
	}
	chapters, err := filepath.Glob(filepath.Join(dir, "*.md"))
	if err != nil {
		t.Fatal(err)
	}
	cited := 0
	for _, path := range chapters {
		text, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range productionLink.FindAllStringSubmatch(string(text), -1) {
			name, anchor := m[1], m[2]
			if anchor != strings.ToLower(name) && have[anchor] && !productionAnchors[anchor] {
				continue
			}
			cited++
			switch {
			case !defined[name]:
				t.Errorf("%s cites the production %s, which Appendix A does not define", filepath.Base(path), name)
			case anchor != strings.ToLower(name):
				t.Errorf("%s links %s to #%s; its anchor is #%s", filepath.Base(path), name, anchor, strings.ToLower(name))
			}
		}
	}
	t.Logf("%d productions in Appendix A, %d citations in the chapters", len(defined), cited)
}
