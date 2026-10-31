package vibelangfuzz

import (
	"reflect"
	"slices"
	"strings"
	"testing"
)

// These fixtures exercise the mutator's own contract, not an independent
// language-semantics oracle. Each has two distinct valid nodes of its category.
// Unlike a random sample of the case/snippet corpus, category coverage must
// survive additions, removals and reordering of unrelated real-world programs.
var spliceCategoryFixtures = [spliceCategories]struct{ key, text string }{
	spliceStatement:    {"statement", "function f() { const a = 1; const b = 2; }"},
	spliceExpression:   {"expression", "const x = 1 + 2;"},
	spliceType:         {"type", "type T = number | string;"},
	spliceClassMember:  {"class-member", "class C { a = 1; b = 2; }"},
	spliceObjectMember: {"object-member", "const x = { a: 1, b: 2 };"},
	spliceTypeMember:   {"type-member", "interface I { a: number; b: string; }"},
	spliceArm:          {"match-arm", "const x = match (0) { when 0: 1; when 1: 2; };"},
	spliceBlockParam:   {"block-param", "f() { 1 }; f() { 2 };"},
	spliceDeclaration:  {"declaration", "const a = 1; const b = 2;"},
}

// checkSpliceCategory forces the category, leaving node, mode and donor choices
// to the fuzz bytes. The seed chooses a same-file donor, so all categories have
// a guaranteed witness even if the acceptance-case corpus disappears.
func checkSpliceCategory(t *testing.T, category spliceCategory, choices []byte) bool {
	t.Helper()
	text := spliceCategoryFixtures[category].text
	nodes, syntaxError := spliceNodes(text)
	if syntaxError {
		t.Fatal("invalid mutator fixture")
	}
	var categories []spliceCategory
	for c := range spliceCategories {
		if len(nodes[c]) != 0 {
			categories = append(categories, c)
		}
	}
	index := slices.Index(categories, category)
	if index < 0 {
		t.Fatalf("fixture has no %s", category)
	}
	input := append([]byte{byte(index)}, choices...)
	got, ok := spliceOnce(&spliceChoices{data: input}, text)
	again, okAgain := spliceOnce(&spliceChoices{data: input}, text)
	if ok != okAgain || !reflect.DeepEqual(got, again) {
		t.Fatalf("category %s choices %x produced different splices:\n%+v\n%+v", category, choices, got, again)
	}
	if !ok {
		return false // arbitrary fuzz choices may exhaust the bounded donor search
	}
	if got.node.category != category || got.old == got.new ||
		got.recipientText[got.node.start:got.node.end] != got.old ||
		!spliceValid(category, got.node.kind, got.old) ||
		!spliceValid(category, got.donorKind, got.new) {
		t.Fatalf("category %s choices %x invalid splice: %s", category, choices, got)
	}
	return true
}

func TestSpliceMutationCategories(t *testing.T) {
	for c := range spliceCategories {
		t.Run(spliceCategoryFixtures[c].key, func(t *testing.T) {
			// node 0, same-file donor of any kind, donor 0.
			if !checkSpliceCategory(t, c, []byte{0, 2, 0}) {
				t.Fatalf("guaranteed %s splice failed", c)
			}
		})
	}
}

// FuzzSpliceMutation checks replay, source spans and category preservation for
// all node/donor selection modes around the deterministic category witnesses.
// Keyed inputs retain their category when fixtures are added or reordered.
func FuzzSpliceMutation(f *testing.F) {
	startShortBudget(f)
	for _, fixture := range spliceCategoryFixtures {
		for mode := range 4 {
			f.Add(fixture.key + "\x00" + string([]byte{0, byte(mode), 0}))
		}
	}
	f.Fuzz(func(t *testing.T, input string) {
		key, rest, named := strings.Cut(input, "\x00")
		category := spliceCategory(0)
		if named {
			found := false
			for c, fixture := range spliceCategoryFixtures {
				if fixture.key == key {
					category, found = spliceCategory(c), true
					break
				}
			}
			if !found {
				return
			}
		} else if len(input) != 0 {
			category = spliceCategory(input[0] % byte(spliceCategories))
			rest = input[1:]
		}
		checkSpliceCategory(t, category, []byte(rest))
	})
}
