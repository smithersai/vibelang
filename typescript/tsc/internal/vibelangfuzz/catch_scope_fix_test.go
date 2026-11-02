package vibelangfuzz

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"
)

const catchScopeFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestCatchScopeFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), catchScopeFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", catchScopeFixQuote)
	}
}

// Runtime preservation is checked by FuzzFix's existing outcome comparator.
// An allowance names this exact input and fix mode, so an unrelated outcome
// change cannot hide behind a generic fix:result entry.
const nativeFixReferenceKey = "native-ts:\n"

func fixResultInputKey(archive string, vipOnly, nativeTS bool) string {
	return fmt.Sprintf("fix:result:%t:%t:%x", nativeTS, vipOnly, sha256.Sum256([]byte(archive)))
}

// Every retained native witness must compile and export a runnable program.
// This prevents an invalid pre-fix VibeLang program from looking like a
// successful runtime-preservation check when no outcome was compared.
func TestCatchScopeNativeControls(t *testing.T) {
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	count := 0
	for _, args := range CorpusInputs("FuzzFix") {
		if len(args) != 1 {
			continue
		}
		archive := args[0]
		if !strings.HasPrefix(archive, nativeFixReferenceKey) {
			continue
		}
		archive = strings.TrimPrefix(archive, nativeFixReferenceKey)
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			files := toolsUnarchive(archive)
			reference := toolsCompile(t, w, "FuzzFix", map[string]string{"main.ts": files["main.vibe"]})
			defer reference.Remove()
			if !toolsErrorFree(reference) {
				t.Fatalf("invalid native control: %v\n%s", SortedKeys(Keys(reference.Dir, reference.Diagnostics)), archive)
			}
			entries := toolsRunnableExports(reference)
			if len(entries) != 1 || entries[0].name != "main" {
				t.Fatalf("missing main control: %v", entries)
			}
			outcome := node.Run(reference, entries[0].file, entries[0].name)
			if toolsInvalidOutcome(outcome) {
				t.Fatalf("invalid native outcome: %+v", outcome)
			}
			t.Logf("native control: %+v", outcome)
		})
		count++
	}
	if count < 24 {
		t.Fatalf("expected at least24 native neighbourhood controls, got%d", count)
	}
}

// Guard the oracle against the actual old migrated spelling: evaluating the
// parser inside the catch operand widens the mapper's scope. The language is
// allowed to give this different outcome; a safe fix must not introduce it.
func TestCatchScopeOracleSeesWidening(t *testing.T) {
	w := NewWorkspace(t)
	var archive string
	for _, args := range CorpusInputs("FuzzFix") {
		if len(args) == 1 && strings.HasPrefix(args[0], nativeFixReferenceKey) &&
			strings.Contains(args[0], `JSON.parse("{not json")`) && strings.Contains(args[0], "export const main = () => (") {
			archive = strings.TrimPrefix(args[0], nativeFixReferenceKey)
			break
		}
	}
	if archive == "" {
		t.Fatal("missing literal invalid-JSON native witness")
	}
	files := toolsUnarchive(archive)
	reference := toolsCompile(t, w, "FuzzFix", map[string]string{"main.ts": files["main.vibe"]})
	defer reference.Remove()
	bad := toolsCompile(t, w, "FuzzFix", map[string]string{"main.vibe": `import { Effect, Schema } from "effect";
error K2SchemaError { message: string; cause?: unknown }
export effect function main() {
  return Schema.decodeUnknownEffect(Schema.Struct({ n: Schema.Number }))(
    try Effect.try({
      try: () => JSON.parse("{not json") as unknown,
      catch: (cause) => new K2SchemaError({ message: "K2 record content is not valid JSON", cause })
    })
  ) catch effect (cause) => {
    throw new K2SchemaError({ message: "Could not decode K2 record: " + cause.message, cause })
  }
}
`})
	defer bad.Remove()
	for name, result := range map[string]*Result{"native": reference, "widened": bad} {
		if !toolsErrorFree(result) {
			t.Fatalf("%s control must compile: %v", name, SortedKeys(Keys(result.Dir, result.Diagnostics)))
		}
	}
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	a, b := node.Run(reference, "out/main.js", "main"), node.Run(bad, "out/main.js", "main")
	if toolsInvalidOutcome(a) || toolsInvalidOutcome(b) {
		t.Fatalf("invalid controls: %+v; %+v", a, b)
	}
	if toolsSameOutcome(a, b) {
		t.Fatalf("oracle missed widened catch scope: %+v; %+v", a, b)
	}
	t.Logf("native: kind=%s value=%s; widened: kind=%s value=%s", a.Kind, a.Value, b.Kind, b.Value)
}
