package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// FuzzFormat's structural, type, diagnostic, comment and idempotence oracles
// check these Smithers captured-operation witnesses. Chapter 7 distinguishes
// source-derived text from ordinary string data: changes to the former do
// not excuse changes to the latter. Deployment hashes remain source-sensitive.
func TestFormatCapturedFunctionTextQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "Ordinary layout and lexical-spelling normalization may change emitted JavaScript bytes.")
	chapterSays(t, "007-tooling.md", "\u0060Function.prototype.toString\u0060, generated source text, source offsets, line/column and stack presentation may reflect the formatted text.")
	chapterSays(t, "007-tooling.md", "This source-text boundary never permits changes to ordinary strings/data")
}

func TestFormatCapturedFunctionTextCorpus(t *testing.T) {
	for _, key := range []string{"block-arrow", "expression-arrow", "function", "method", "nested"} {
		name := "smithers-captured-function-text-" + key
		data, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", name+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var corpus struct{ Source string }
		if err = json.Unmarshal(data, &corpus); err != nil {
			t.Fatal(err)
		}
		data, err = os.ReadFile(filepath.Join(repoTestdata(), "fuzz/FuzzFormat", name))
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		if len(lines) != 2 || lines[0] != "go test fuzz v1" || !strings.HasPrefix(lines[1], "string(") {
			t.Fatalf("%s: invalid seed", name)
		}
		source, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "string("), ")"))
		if err != nil || source != corpus.Source {
			t.Fatalf("%s: corpus and seed differ: %v", name, err)
		}
		if !strings.Contains(source, "Function.prototype.toString.call(operation)") || !strings.Contains(source, "keep this data") {
			t.Fatalf("%s: incomplete source-text/data witness", name)
		}
	}
}
