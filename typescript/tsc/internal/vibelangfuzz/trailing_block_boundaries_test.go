package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestTrailingBlockBoundariesQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"002-running.md":  "\x60effect { … }\x60 is an expression.",
		"005-services.md": "\x60service Name { members }\x60 is the only way to declare a service.",
		"006-data.md":     "A \x60schema\x60 declaration requires a field body or \x60= type\x60; a \x60data\x60 declaration requires a variant body, even if empty.",
		"004-match.md":    "return match (d) {",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
	trailingBlocksQuoted(t)
}

type trailingBoundaryCase struct {
	key, source string
	block       bool
}

func trailingBoundaryCases() []trailingBoundaryCase {
	return []trailingBoundaryCase{
		{"namespace-dotted", "namespace A.B %s{export const value=1;}\n", false},
		{"effect-block", "export const value=effect %s{return 1;};\n", false},
		{"uninterruptible", "export effect function f(){uninterruptible %s{return 1;}}\n", false},
		{"interruptible", "export effect function f(){interruptible %s{return 1;}}\n", false},
		{"restore", "export effect function f(){uninterruptible {restore %s{return 1;}}}\n", false},
		{"match", "export const value=match (1) %s{when 1: 2; default: 3;};\n", false},
		{"error", "error Boundary %s{value:number}\n", true},
		{"service", "service Boundary %s{value:number}\n", true},
		{"schema", "schema Boundary %s{value:number}\n", true},
		{"data", "data Boundary %s{Ready; Waiting}\n", true},
	}
}

// R14 OPUS-2: recognized language blocks/declarations and native namespaces
// cannot become banned legacy trailing-call blocks merely because their
// head ends in a name or parenthesis. This tests admission, not the unsettled
// legacy repair classifier or its retirement phase.
func FuzzTrailingBlockBoundaries(f *testing.F) {
	startShortBudget(f)
	rows := trailingBoundaryCases()
	for _, row := range rows {
		for style := uint8(0); style < 3; style++ {
			f.Add(row.key, style, false)
		}
		if row.block {
			f.Add(row.key, uint8(0), true)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, style uint8, nested bool) {
		TestTrailingBlockBoundariesQuoted(t)
		index := slices.IndexFunc(rows, func(row trailingBoundaryCase) bool { return row.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rows)
		}
		row := rows[index]
		source := fmt.Sprintf(row.source, []string{" ", "\t", " /* boundary */ "}[style%3])
		if nested && row.block {
			source = "{" + source + "}\n"
		}
		result := toolsCompile(t, w, "FuzzTrailingBlockBoundaries", map[string]string{"main.vibe": source})
		defer result.Remove()
		gaps := &Gaps{Target: "FuzzTrailingBlockBoundaries", Input: source}
		name := fmt.Sprintf("%s:%d:%t", row.key, style%3, nested && row.block)
		if HasError(result.Diagnostics) {
			gaps.Add(name, "an admitted VIP block/declaration or native namespace must compile, got %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
		} else {
			ExpectPending(t, "FuzzTrailingBlockBoundaries", name)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
