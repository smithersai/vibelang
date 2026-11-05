package vibelangfuzz

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangestree"
)

const concurrentESTreeQuote = "Evaluate the limit once before entering the operand's head environment."

func TestConcurrentESTreeIdentifiersQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentESTreeQuote)
}

// The source limit remains visible exactly once. Its cached name is compiler
// bookkeeping, while a written dollar-prefixed name retains its lexical uses.
func FuzzESTreeConcurrentIdentifiers(f *testing.F) {
	startShortBudget(f)
	keys := []string{"literal", "call", "source-name", "mixed"}
	for _, key := range keys {
		for mode := uint8(0); mode < 4; mode++ {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		chapterSays(t, "002-running.md", concurrentESTreeQuote)
		limit := "2"
		switch key {
		case "call":
			limit = "limit(1)"
		case "source-name":
			limit = "$concurrentLimit1"
		case "mixed":
			limit = "$concurrentLimit1 + limit(1)"
		default:
			key = "literal"
		}
		gap := []string{" ", "\n", "/* 😀 */", "\r\n"}[mode%4]
		source := "effect function f($concurrentLimit1: number) { for concurrent" + gap + "(" + limit + ") (const item of items()) { use(item, $concurrentLimit1) } }"
		name := "main.vibe"
		if mode&4 != 0 {
			name = "main.vibex"
		}
		tree, failure := vibelangestree.Parse(name, source)
		if failure != nil {
			t.Fatal(failure)
		}
		var value any
		if err := json.Unmarshal([]byte(tree), &value); err != nil {
			t.Fatal(err)
		}
		authored, limitCalls := 0, 0
		var visit func(any)
		visit = func(value any) {
			switch v := value.(type) {
			case []any:
				for _, child := range v {
					visit(child)
				}
			case map[string]any:
				if v["type"] == "Identifier" {
					name, _ := v["name"].(string)
					if name == "$concurrentLimit1" {
						if v["synthesized"] == true {
							Gap(t, "FuzzESTreeConcurrentIdentifiers", key, "written identifier became synthetic: %s", source)
						}
						authored++
					} else if strings.HasPrefix(name, "$concurrentLimit") && v["synthesized"] != true {
						Gap(t, "FuzzESTreeConcurrentIdentifiers", key, "generated identifier %s is not synthetic: %s", name, source)
					}
				}
				if v["type"] == "CallExpression" {
					callee, _ := v["callee"].(map[string]any)
					if callee["name"] == "limit" {
						limitCalls++
					}
				}
				for _, child := range v {
					visit(child)
				}
			}
		}
		visit(value)
		wantCalls := 0
		if strings.Contains(limit, "limit(") {
			wantCalls = 1
		}
		if authored < 2 || limitCalls != wantCalls {
			Gap(t, "FuzzESTreeConcurrentIdentifiers", key, "lost source uses or repeated limit: authored=%d calls=%d want=%d", authored, limitCalls, wantCalls)
		}
	})
}
