package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Every VibeLang body loop consumes a token on each pass. A pass that reports
// an error without consuming one allocates a node forever: the compiler, and an
// editor showing the file, runs until it is out of memory.
func TestVibeLangBodyParseProgress(t *testing.T) {
	const child = "VIBELANG_BODY_PARSE_PROGRESS_CHILD"
	if os.Getenv(child) != "1" {
		// Isolate runaway parser allocations from the test process. The last
		// input printed by the child identifies the parser state.
		ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestVibeLangBodyParseProgress$")
		cmd.Env = append(os.Environ(), child+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			lines := strings.Split(strings.TrimSpace(string(output)), "\n")
			t.Fatalf("body parse subprocess failed: %v (%v)\n%s", err, ctx.Err(), strings.Join(lines[max(0, len(lines)-12):], "\n"))
		}
		return
	}
	bodies := []string{
		"service S { } layer L: S { @ }",
		"layer L: S { n: 1; @ }",
		"data D { @ }",
		"data D { A { @ } }",
		"service S { @ }",
		"error E { @ }",
		"schema error E { @ }",
		"schema C { @ }",
		"const v = match (x) { @ };",
		"const v = match (x) { when { @ }: 1; };",
		"const v = match (x) { when [ @ ]: 1; };",
		"const v = match (x) { when P( @ ): 1; };",
		"effect function f(L) { provide L { @ } }",
		"effect function f() { uninterruptible { @ } }",
		"effect function f(xs) { for concurrent (const x of xs) { @ } }",
		"const v = do { @ };",
		"const v = effect { @ };",
		"class C { effect m() { @ } }",
	}
	tokens := []string{
		"default", "case", "else", "catch", "finally", "extends", "implements", "in", "of", "as",
		")", "]", ":", ",", "=>", "=", ".", "?", "...", "*", "%", "|>", "!", "#", "\\", "<", ">",
		"default default 1", ") )", "; )", "n : default",
	}
	for _, body := range bodies {
		for _, token := range tokens {
			source := strings.Replace(body, "@", token, 1)
			fmt.Fprintln(os.Stderr, source)
			parseAs(parseKind{"/fuzz/main.vibe", core.ScriptKindTS}, source)
		}
	}
}
