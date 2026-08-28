package compiler

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"testing"
	"unicode/utf16"
)

// Ordering author-controlled strings.
//
// THE DEFECT THIS FILE EXISTS FOR. On 2026-08-28 the two backends minted
// different contract digests for the same accepted program, with no diagnostic
// from either. An Action whose success type had the field names `"�b"` and
// `"\u{1F600}a"` produced descriptor fields `[😀a, �b]` from the reference and
// `[�b, 😀a]` from the Go fork, and therefore a different successSchema digest,
// a different contractDigest, and a different Plan digest. The cause was one
// line: `durableTypeDescriptor` sorted properties with Go's native `<`.
//
// Go's `<` on strings compares UTF-8 bytes. Every ordering in the reference
// frontend compares UTF-16 code units — JavaScript's `<`, its default
// `Array#sort`, and the explicit `compareText` in `poc/src/durable/schema.ts`
// and `poc/src/language/semantic.ts` are all that same order. The two rules
// disagree exactly when two names straddle the surrogate range: an astral
// character is a surrogate pair beginning at 0xD800 in UTF-16 but four bytes
// beginning at 0xF0 in UTF-8, while U+E000–U+FFFF are three bytes beginning at
// 0xEE–0xEF. So astral sorts BEFORE the U+E000–U+FFFF block in UTF-16 and AFTER
// it in UTF-8.
//
// The fork already knew the rule — `sortUTF16` existed and was used correctly in
// five places — and one site simply never learned it. That is the shape this
// file is built against: not the single line, but the ease of adding the next
// one. `TestPinnedForkBridgeByteOrderSortsAreReviewed` is the part that has
// teeth: it makes an unreviewed `sort.Strings` in the bridge a build failure, so
// a new byte-order sort over author-controlled data has to argue for itself in
// this table instead of appearing quietly.

// byteOrderSortReview is one reviewed `sort.Strings` call in the fork bridge.
//
// A site belongs here ONLY if byte order is provably correct for it — the
// strings are compiler-generated ASCII, or the result is a process-local
// equality key that no one observes as an order. Anything ordering
// author-controlled text (a field name, a class name, a module path) belongs in
// `sortUTF16`/`sortUTF16By`/`compareUTF16` instead, and adding it here would be
// the regression this test is for.
type byteOrderSortReview struct {
	file     string
	function string
	reason   string
}

var reviewedByteOrderSorts = []byteOrderSortReview{
	{
		file:     "durable.go.txt",
		function: "durableExpressionDependencies",
		reason: "Plan node ids minted by stableNodeID as `src-` plus 24 hex digits. " +
			"Provably ASCII, so byte order and UTF-16 order are the same order.",
	},
	{
		file:     "hostrules.go.txt",
		function: "ambientRequirementsForMembers",
		reason: "This file's own closed capability vocabulary (Clock, Host, ...), " +
			"never anything the author spells.",
	},
	{
		file:     "nativeprovenance.go.txt",
		function: "nativeFlowValueKey",
		reason: "An equality key, not an observed order: compared only against keys " +
			"this same function built in this same process, where any deterministic " +
			"total order yields identical equality classes.",
	},
	{
		file:     "nativeprovenance.go.txt",
		function: "nativeFlowBindingsKey",
		reason:   "A process-local equality key, as in nativeFlowValueKey.",
	},
	{
		file:     "assets.go.txt",
		function: "assetAttributesKey",
		reason: "A process-local equality key for the SMITHERS5215 conflict test and " +
			"the assetModules map; never rendered as an order.",
	},
}

// bridgeSourcesUnderReview is every embedded bridge source this census covers.
// It is the same list `fork.go` embeds, written out by hand because Go's
// `//go:embed` of a single file produces a plain `[]byte` with no directory to
// walk. That is this guard's one blind spot and it is stated rather than
// glossed: a NEW bridge file added to `fork.go` and not added here would be
// unreviewed and this test would still be green. Adding a file to `fork.go` and
// not to this map is the mistake to watch for.
func bridgeSourcesUnderReview() map[string][]byte {
	return map[string][]byte{
		"assets.go.txt":           forkAssetSource,
		"checker.go.txt":          forkCheckerBridgeSource,
		"comptime.go.txt":         forkComptimeSource,
		"durable.go.txt":          forkDurableSource,
		"effectmanifest.go.txt":   forkEffectManifestSource,
		"hostrules.go.txt":        forkHostRulesSource,
		"lowering.go.txt":         forkLoweringSource,
		"main.go.txt":             forkBridgeSource,
		"mustconsume.go.txt":      forkMustConsumeSource,
		"nativeprovenance.go.txt": forkNativeProvenanceSource,
		"retired.go.txt":          forkRetiredSyntaxSource,
	}
}

var bridgeFuncPattern = regexp.MustCompile(`(?m)^func (?:\([^)]*\) )?([A-Za-z0-9_]+)`)

// enclosingBridgeFunction names the function an offset falls inside. Keyed on
// the function name rather than the line number deliberately: a census that
// drifts red every time an unrelated line is inserted above a site teaches
// people to re-record it without reading it.
func enclosingBridgeFunction(source string, offset int) string {
	name := "<file scope>"
	for _, match := range bridgeFuncPattern.FindAllStringSubmatchIndex(source, -1) {
		if match[0] > offset {
			break
		}
		name = source[match[2]:match[3]]
	}
	return name
}

func TestPinnedForkBridgeByteOrderSortsAreReviewed(t *testing.T) {
	reviewed := make(map[string]string, len(reviewedByteOrderSorts))
	for _, entry := range reviewedByteOrderSorts {
		if strings.TrimSpace(entry.reason) == "" {
			t.Fatalf("%s %s is in the census with no recorded reason", entry.file, entry.function)
		}
		reviewed[entry.file+"#"+entry.function] = entry.reason
	}

	found := make(map[string]int)
	for file, source := range bridgeSourcesUnderReview() {
		text := string(source)
		for offset := 0; ; {
			index := strings.Index(text[offset:], "sort.Strings(")
			if index < 0 {
				break
			}
			at := offset + index
			found[file+"#"+enclosingBridgeFunction(text, at)]++
			offset = at + len("sort.Strings(")
		}
	}

	unreviewed := make([]string, 0)
	for key := range found {
		if _, ok := reviewed[key]; !ok {
			unreviewed = append(unreviewed, key)
		}
	}
	sort.Strings(unreviewed)
	if len(unreviewed) != 0 {
		t.Fatalf("byte-order sort(s) in the fork bridge that no one has reviewed: %s\n"+
			"Go's sort.Strings compares UTF-8 bytes; the reference frontend compares UTF-16 code units, "+
			"and the two disagree on any pair of names straddling the surrogate range. If the site orders "+
			"author-controlled text, use sortUTF16, sortUTF16By, or compareUTF16. If it orders "+
			"provably-ASCII compiler-generated text, or builds a process-local equality key, add it to "+
			"reviewedByteOrderSorts with the reason.", strings.Join(unreviewed, ", "))
	}

	stale := make([]string, 0)
	for key := range reviewed {
		if found[key] == 0 {
			stale = append(stale, key)
		}
	}
	sort.Strings(stale)
	if len(stale) != 0 {
		t.Fatalf("reviewedByteOrderSorts names %s, which no longer holds a sort.Strings call; "+
			"drop the entry so the census stays a census", strings.Join(stale, ", "))
	}
}

// TestPinnedForkBridgeSortsDescriptorPropertiesByUTF16 pins the one line that
// shipped the divergence, by name, so a revert to `properties[i].Name <` is a
// test failure and not a silent digest change. The conformance case
// 17-durable/action-success-field-order-is-utf16-not-utf8 measures the same rule
// end to end across both backends; this is the unit-level statement of it, which
// runs even when the fork checkout is not prepared.
func TestPinnedForkBridgeSortsDescriptorPropertiesByUTF16(t *testing.T) {
	source := string(forkDurableSource)
	if !strings.Contains(source, "sortUTF16By(properties, func(property *ast.Symbol) string { return property.Name })") {
		t.Fatal("durableTypeDescriptor no longer sorts descriptor properties with sortUTF16By; " +
			"the field order it produces is hashed into the Action contract digest, so byte order " +
			"there mints a different contract from the reference for boundary-straddling field names")
	}
	if strings.Contains(source, "properties[i].Name < properties[j].Name") {
		t.Fatal("durableTypeDescriptor compares property names with Go's byte-order `<` again")
	}
}

// TestPinnedForkUTF16OrderDisagreesWithByteOrderAtTheBoundary is the behavioural
// half: it states, in this package, the fact the bridge's helpers depend on.
// Everything above is source-text assertion, which is worth exactly as much as
// the claim it encodes — so the claim itself is measured here rather than
// asserted in a comment.
func TestPinnedForkUTF16OrderDisagreesWithByteOrderAtTheBoundary(t *testing.T) {
	// compareUTF16 lives in the bridge sources, which are compiled inside the
	// fork checkout, not in this package. This is the same computation, and the
	// test would be worthless if it were not: it exists to show that the two
	// orders really do differ, which is why the bridge may not use `<`.
	compareUTF16Units := func(left string, right string) int {
		leftUnits := utf16.Encode([]rune(left))
		rightUnits := utf16.Encode([]rune(right))
		for index := 0; index < len(leftUnits) && index < len(rightUnits); index++ {
			if leftUnits[index] != rightUnits[index] {
				if leftUnits[index] < rightUnits[index] {
					return -1
				}
				return 1
			}
		}
		switch {
		case len(leftUnits) < len(rightUnits):
			return -1
		case len(leftUnits) > len(rightUnits):
			return 1
		}
		return 0
	}

	for _, probe := range []struct {
		name  string
		left  string
		right string
		utf16 int
		bytes int
	}{
		{name: "astral against the replacement character", left: "\U0001F600a", right: "�b", utf16: -1, bytes: 1},
		{name: "astral against fullwidth latin", left: "\U0001F600a", right: "ｘx", utf16: -1, bytes: 1},
		{name: "astral against a private use character", left: "\U0001F600a", right: "\uE000p", utf16: -1, bytes: 1},
		{name: "below U+D800 the two orders agree", left: "\U00020000a", right: "\u4E00b", utf16: 1, bytes: 1},
		{name: "ascii is unaffected", left: "m", right: "�b", utf16: -1, bytes: -1},
		{name: "two BMP names agree", left: "ｘx", right: "�m", utf16: -1, bytes: -1},
	} {
		t.Run(probe.name, func(t *testing.T) {
			byteOrder := 0
			switch {
			case probe.left < probe.right:
				byteOrder = -1
			case probe.left > probe.right:
				byteOrder = 1
			}
			if byteOrder != probe.bytes {
				t.Fatalf("UTF-8 byte order of %q vs %q = %d, want %d", probe.left, probe.right, byteOrder, probe.bytes)
			}
			if got := compareUTF16Units(probe.left, probe.right); got != probe.utf16 {
				t.Fatalf("UTF-16 code-unit order of %q vs %q = %d, want %d", probe.left, probe.right, got, probe.utf16)
			}
		})
	}

	// And the sort-level consequence, which is what a descriptor field list is.
	names := []string{"�b", "m", "\U0001F600a"}
	byBytes := append([]string(nil), names...)
	sort.Strings(byBytes)
	byUnits := append([]string(nil), names...)
	sort.SliceStable(byUnits, func(i, j int) bool { return compareUTF16Units(byUnits[i], byUnits[j]) < 0 })
	if fmt.Sprint(byBytes) == fmt.Sprint(byUnits) {
		t.Fatalf("the two orders agreed on %v, so this probe cannot detect the defect it was written for", names)
	}
	if want := []string{"m", "\U0001F600a", "�b"}; fmt.Sprint(byUnits) != fmt.Sprint(want) {
		t.Fatalf("UTF-16 order = %v, want %v", byUnits, want)
	}
}
