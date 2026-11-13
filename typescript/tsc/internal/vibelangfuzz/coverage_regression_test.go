package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Appendix A's table is the edit alphabet's authority. Every contextual word
// must be reachable by an incremental insertion or replacement.
func TestIncrementalKeywordCoverage(t *testing.T) {
	tokens := toolsEditTokens()
	rows := grammarReadKeywordTable(SpecText(grammarAppendix))
	if len(tokens) > 256 {
		t.Fatal("edit tokens exceed the one-byte selector")
	}
	if len(rows) == 0 {
		t.Fatal("no contextual keywords read")
	}
	for _, row := range rows {
		for _, word := range row.Words {
			if index := slices.Index(tokens, word); index >= 0 {
				start, end, token := toolsIncrementalEdit("x", 0, 0, byte(index))
				if start != end || token != word {
					t.Errorf("keyword %q cannot be inserted: %q", word, token)
				}
			}
			if !slices.Contains(tokens, word) {
				t.Errorf("incremental edits cannot insert keyword %q", word)
			}
		}
	}
}

// A deleted sentence must require reviewing its reader, just as a changed
// production does. Never silently keep a prose rule that matches nothing.
func TestGrammarProseRulesMatched(t *testing.T) {
	text := SpecText(grammarAppendix)
	for _, rule := range grammarProseRuleTexts {
		if !rule.re.MatchString(text) {
			t.Errorf("prose reader %q matches no current Appendix A sentence", rule.kind)
		}
	}
}

func TestGrammarMissingProseReader(t *testing.T) {
	text := strings.ReplaceAll(SpecText(grammarAppendix), "keyword only before the tokens listed, on the same line", "changed keyword boundary")
	_, missing := grammarReadProseRules(text)
	if !slices.Equal(missing, []string{"same-line-all"}) {
		t.Fatalf("missing readers = %v", missing)
	}
}

func TestIncrementalKeywordInsertions(t *testing.T) {
	for i, seed := range toolsKeywordEditSeeds() {
		text := seed.source
		edit := seed.edits
		_, operation, choice := toolsIncrementalSelectors(edit[0], edit[1], 1)
		start, end, insert := toolsIncrementalEdit(text, operation, int(edit[2])<<8|int(edit[3]), choice)
		want := []string{"effect ", "try "}[i]
		if start != end || insert != want {
			t.Fatalf("seed %d inserts %q at %d:%d, want %q", i, insert, start, end, want)
		}
		text = text[:start] + insert + text[end:]
		_, operation, choice = toolsIncrementalSelectors(edit[4], edit[5], 1)
		start, end, insert = toolsIncrementalEdit(text, operation, int(edit[6])<<8|int(edit[7]), choice)
		text = text[:start] + insert + text[end:]
		if strings.Join(strings.Fields(text), " ") != strings.Join(strings.Fields(seed.source), " ") {
			t.Fatalf("seed %d did not remove its keyword: %s", i, text)
		}
	}
}

func TestIsCallbackBooleanWitness(t *testing.T) {
	requireIsCallbackInferenceQuote(t)
	w := NewWorkspace(t)
	for _, row := range []struct {
		expression string
		allowed    bool
	}{
		{"true as boolean", true}, {"true as any", false}, {"true as unknown", false},
		{"1", false}, {`"text"`, false}, {"true", false}, {"false", false},
	} {
		t.Run(row.expression, func(t *testing.T) {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": isCallbackContext("declaration", isCallbackBooleanWitness(row.expression))}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			errors := []string{}
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprint(d))
				}
			}
			if (len(errors) == 0) != row.allowed {
				t.Fatalf("allowed=%t, errors=%v", row.allowed, errors)
			}
		})
	}
}

// Every admitted project file must be editable with every token and operation.
// Enumerate the byte domain independently of the selector's implementation.
func TestIncrementalProjectEditCoverage(t *testing.T) {
	tokens := toolsEditTokens()
	for count := 1; count <= 256; count++ {
		files := map[string]string{}
		for i := range count {
			files[fmt.Sprintf("file%d.vibe", i)] = ""
		}
		if toolsTooLarge(files) {
			break
		}
		seen := map[[3]int]bool{}
		for selector := range 256 {
			for token := range 256 {
				file, operation, choice := toolsIncrementalSelectors(byte(selector), byte(token), count)
				seen[[3]int{file, int(operation % 6), int(choice) % len(tokens)}] = true
			}
		}
		for file := range count {
			for operation := range 6 {
				for token, word := range tokens {
					if !seen[[3]int{file, operation, token}] {
						t.Fatalf("files=%d file=%d operation=%d token=%q is unreachable", count, file, operation, word)
					}
				}
			}
		}
	}
}
