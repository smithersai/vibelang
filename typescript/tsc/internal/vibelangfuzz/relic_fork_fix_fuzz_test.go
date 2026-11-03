package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const relicForkFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestRelicForkFixQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil || !strings.Contains(string(text), relicForkFixQuote) {
		t.Fatalf("missing preserving-fix authority: %v", err)
	}
}

// This is a migration generator, not a new language construct. Compare the
// compiler with itself before/after the source repair, as 007 requires.
func FuzzRelicForkFix(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"success", "failure", "defect", "capture", "nested", "cleanup", "adjacent", "newline"} {
		f.Add(key, byte(7))
	}
	w := NewWorkspace(f)
	var node *Node
	f.Cleanup(func() {
		if node != nil {
			node.Close()
		}
	})
	f.Fuzz(func(t *testing.T, key string, value byte) {
		key = strings.SplitN(key, ":", 2)[0]
		body := fmt.Sprintf("return %d", value)
		switch key {
		case "failure":
			body = fmt.Sprintf("return try Effect.fail(%d)", value)
		case "defect":
			body = fmt.Sprintf("return try Effect.die(%d)", value)
		case "capture":
			body = "return captured"
		case "nested":
			body = fmt.Sprintf("const inner = fork { return %d }; return join inner", value)
		case "cleanup":
			body = fmt.Sprintf("return try Effect.ensuring(Effect.succeed(%d), Effect.sync(() => { events.push(1) }))", value)
		case "adjacent", "newline":
		default:
			key = "success"
		}
		source := fmt.Sprintf("export effect function main() { const captured = %d; const events: number[] = []; const child = fork /* KEEP */ { %s }; const result = try Effect.exit(Fiber.join(child)); return { result, events }; }", value, body)
		wanted := "fork /* KEEP */ effect {"
		if key == "adjacent" {
			source = strings.Replace(source, "fork /* KEEP */ {", "fork{", 1)
			wanted = "fork effect {"
		}
		if key == "newline" {
			source = strings.Replace(source, "fork /* KEEP */ {", "fork\n{", 1)
			wanted = "fork\neffect {"
		}
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, "FuzzRelicForkFix", files)
		defer before.Remove()
		if !toolsErrorFree(before) {
			t.Fatalf("invalid source %v: %s", before.Diagnostics, source)
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil || len(fixed.Refused) > 0 {
			t.Fatalf("fix failed: %v %+v", fixed.Err, fixed.Refused)
		}
		changed := false
		for name, file := range fixed.Files {
			if strings.HasSuffix(name.AsString(), "/main.vibe") {
				files["main.vibe"] = file.Text
				changed = strings.Contains(file.Text, wanted) && !strings.Contains(file.Text, "fork {")
			}
		}
		if !changed {
			Gap(t, "FuzzRelicForkFix", key, "VIP-2/17: preserving bare fork migration missing")
			return
		}
		after := toolsCompile(t, w, "FuzzRelicForkFix", files)
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("fixed program invalid: %v", after.Diagnostics)
		}
		for name, text := range before.Outputs {
			if strings.HasSuffix(name, ".d.ts") && after.Outputs[name] != text {
				Gap(t, "FuzzRelicForkFix", key, "007: declaration bytes changed: before %s after %s", text, after.Outputs[name])
				return
			}
		}
		if node == nil {
			var err error
			node, err = NewNode(w.Dir)
			if err != nil {
				t.Fatal(err)
			}
		}
		found := false
		for name := range before.Outputs {
			if filepath.Base(name) != "main.js" {
				continue
			}
			found = true
			was, now := node.Run(before, name, "main"), node.Run(after, name, "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(now) {
				t.Fatalf("invalid Exit comparison: %+v %+v", was, now)
			}
			if !toolsSameOutcome(was, now) {
				Gap(t, "FuzzRelicForkFix", key, "007: Exit or cleanup changed: before %+v after %+v", was, now)
				return
			}
		}
		if !found {
			t.Fatal("no runnable output")
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) > 0 {
			t.Fatalf("not a fixed point: %+v", again)
		}
	})
}
