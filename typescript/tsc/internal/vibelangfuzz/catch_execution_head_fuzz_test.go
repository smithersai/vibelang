package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

const catchExecutionTarget = "FuzzCatchExecutionHead"

func catchExecutionChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		"`try x catch h`: write `try x` or `x catch h`, never both",
		"Actual source parentheses still stop the search; grouping added by emission is not a source grouping choice.",
		"are transparent along the unary/binary path",
		"For `EK0505`'s head search",
		"Ordinary TypeScript checks on each wrapper still apply",
	} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 2 no longer says %q", quote)
		}
	}
}

func TestCatchExecutionHeadQuoted(t *testing.T) { catchExecutionChapter(t) }

// The spec defines a syntactic head search, independently of the operand's
// type. Generate erased wrappers and unary/binary paths, paired with an
// actual source-parentheses barrier. Exercise both scalar and Effect-valued
// results: operand typing must not hide the syntactic head diagnostic.
// Ordinary wrapper errors remain visible.
func FuzzCatchExecutionHead(f *testing.F) {
	startShortBudget(f)
	catchExecutionChapter(f)
	heads := []string{"try p", "fork p", "join fiber", "try Effect.currentSpan"}
	wraps := []string{"direct", "as", "assertion", "satisfies", "nonnull", "instantiation", "left", "right", "unary"}
	for _, head := range []string{"try", "fork", "join"} {
		for _, wrap := range wraps {
			f.Add([]byte(head + ":" + wrap))
			f.Add([]byte("scalar:" + head + ":" + wrap))
		}
	}
	f.Add([]byte("t3code:current-span"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		h, v, depth := 0, 0, 1
		if len(data) > 0 {
			h = int(data[0]) % len(heads)
		}
		if len(data) > 1 {
			v = int(data[1]) % len(wraps)
		}
		if len(data) > 2 {
			depth = 1 + int(data[2])%4
		}
		key := string(data)
		scalar := len(data) > 3 && data[3]&1 != 0
		scalarKey := strings.HasPrefix(key, "scalar:")
		if scalarKey {
			scalar = true
			key = strings.TrimPrefix(key, "scalar:")
		}
		for i, name := range []string{"try", "fork", "join"} {
			for j, wrap := range wraps {
				if key == name+":"+wrap {
					h, v, depth = i, j, 1
					scalar = scalarKey
				}
			}
		}
		if key == "t3code:current-span" {
			h, v, depth = 3, 0, 1
			scalar = false
		}
		wrap := func(s string) string {
			switch wraps[v] {
			case "as":
				return s + " as any"
			case "assertion":
				return "<any>" + s
			case "satisfies":
				return s + " satisfies any"
			case "nonnull":
				return s + "!"
			case "instantiation":
				return s + "<number>"
			case "left":
				return s + " + 1"
			case "right":
				return "1 + " + s
			case "unary":
				return "- " + s
			}
			return s
		}
		bad, good := heads[h], "("+heads[h]+")"
		for range depth {
			bad, good = wrap(bad), wrap(good)
		}
		result := "P"
		if scalar {
			result = "number"
		}
		source := fmt.Sprintf("import { Effect, Fiber } from 'effect'; type P = Effect.Effect<number, string> & (<T>() => T); declare const p: Effect.Effect<%s, string>; declare const fiber: Fiber.Fiber<%s, string>; export effect function main() { %s catch () => 0; %s catch () => 0; return 0 }", result, result, bad, good)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		synthetic := 0
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 505 {
				count++
			}
			if (d.Code() == 2322 || d.Code() == 2739 || d.Code() == 2740) && strings.Contains(d.String(), "Effect<unknown, unknown, unknown>") {
				synthetic++
			}
		}
		precise := fmt.Sprintf("%d:%s:depth%d", h, wraps[v], depth)
		if scalar {
			precise = "scalar:" + precise
		}
		if count != 1 || synthetic != 0 {
			Gap(t, catchExecutionTarget, precise, "VIP-5 requires one EK0505 through wrappers, none through source parentheses; got %d and %d synthetic operand mismatches:\n%s\n%v", count, synthetic, source, r.Diagnostics)
			return
		}
		ExpectPending(t, catchExecutionTarget, precise)
	})
}
