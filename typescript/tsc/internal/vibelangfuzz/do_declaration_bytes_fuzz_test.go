package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const doDeclarationBytesTarget = "FuzzDoDeclarationBytes"

var doDeclarationQuotes = []struct{ chapter, quote string }{
	{"001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare."},
	{"002-running.md", "Their outward returns and typed failures are still checked at the enclosing activation."},
}

func TestDoDeclarationBytesQuoted(t *testing.T) {
	for _, rule := range doDeclarationQuotes {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("%s no longer says %q; update the oracle", rule.chapter, rule.quote)
		}
	}
}

// Compare raw bytes, without the migration canonicalizer, for Foldkit's
// concise match arrow and neighbouring nested return/break/continue patterns.
// Runtime behavior is checked only by the canonical VIP-2 differential generator.
func FuzzDoDeclarationBytes(f *testing.F) {
	startShortBudget(f)
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	for _, key := range []string{"foldkit-match-return", "loop-jumps", "inferred-return", "async-inferred-return", "completion-values", "completion-empty", "extractor-capture", "bind-only-fallback", "finite-match-do"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(5))
		if key == "extractor-capture" {
			f.Add(key, uint8(64))
			f.Add(key, uint8(128))
			f.Add(key, uint8(192))
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestDoDeclarationBytesQuoted(t)
		defer recoverCompilerPanic(t, doDeclarationBytesTarget)
		depth := int(variant % 6)
		wrap := func(body string) string {
			for i := 0; i <= depth; i++ {
				body = "(do { " + body + " })"
			}
			return body
		}
		var source, counterpart string
		switch key {
		case "loop-jumps":
			source = "export function update(n: number): number { let sum = 0; outer: for (const x of [1,2,3]) { const first = x, value = " + wrap("if (first === 1) continue outer; if (first === 3) break outer; first") + "; sum += value }; return sum + n }"
			counterpart = "export function update(n: number): number { let sum = 0; outer: for (const x of [1,2,3]) { const first = x; if (first === 1) continue outer; if (first === 3) break outer; const value = first; sum += value }; return sum + n }"
		case "bind-only-fallback":
			source = "export const update = (n: 0 | 1): string => match (n) { when 0: 'zero'; when let rest: " + wrap("if (rest === 1) return 'one'; 'other'") + "; }"
			counterpart = "export const update = (n: 0 | 1): string => { if (n === 0) return 'zero'; if (n === 1) return 'one'; return 'other' }"
		case "finite-match-do":
			source = "export const update = (n: 0 | 1): string => match (n) { when 0: " + wrap("'zero'") + "; when 1: " + wrap("'one'") + "; }"
			counterpart = "export const update = (n: 0 | 1): string => { if (n === 0) return 'zero'; return 'one' }"
		case "extractor-capture":
			value := "Option.some(n)"
			if variant&128 != 0 {
				value = "Option.none<number>()"
			}
			prefix := "import { Option } from \"effect\"; export function update(n: number): number { const subject = " + value + "; "
			source = prefix + "return " + wrap("if (subject is Option.Some(let value)) return value; -1") + " }"
			if variant&64 != 0 {
				source = prefix + "if (subject is Option.Some(let value)) return value; return -1 }"
			}
			counterpart = prefix + "if (Option.isSome(subject)) return subject.value; return -1 }"
		case "completion-values":
			source = "export const update = (n: number): number | string => " + wrap("if (n > 0) { 'positive' } else { n }")
			counterpart = "export const update = (n: number): number | string => { if (n > 0) return 'positive'; return n }"
		case "completion-empty":
			source = "export const update = (n: number): number | undefined => " + wrap("if (n > 0) { n } else {}")
			counterpart = "export const update = (n: number): number | undefined => { if (n > 0) return n; return undefined }"
		case "inferred-return", "async-inferred-return":
			source = "export function update(n: number) { const value = " + wrap("if (n > 0) return 'early'; n") + "; return value }"
			counterpart = "export function update(n: number) { if (n > 0) return 'early'; const value = n; return value }"
			if key == "async-inferred-return" {
				source = strings.Replace(source, "export function", "export async function", 1)
				counterpart = strings.Replace(counterpart, "export function", "/** @throws {never} */\nexport async function", 1)
			}
		default:
			key = "foldkit-match-return"
			source = "export const update = (n: number): number => match (n) { when 1: " + wrap("return 7") + "; default: 9; }"
			counterpart = "export const update = (n: number): number => { if (n === 1) return 7; return 9 }"
			if variant == 0 {
				raw, err := os.ReadFile(filepath.Join("testdata", "do-jumps", "foldkit-kanban-match-return.vibe"))
				if err != nil {
					t.Fatal(err)
				}
				source = string(raw)
			}
		}
		project := Project{Files: map[string]string{"main.vibe": source}, Config: fmt.Sprintf(errorTwinConfig, "main.vibe")}
		var c *Compilation
		var err error
		within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		gap := fmt.Sprintf("%s:depth-%d", key, depth)
		if c.Program == nil || HasError(c.Diagnostics) {
			Gap(t, doDeclarationBytesTarget, "compile:"+gap, "VIP-2: outward jumps must retain the enclosing signature: %v\n%s", SortedKeys(Keys(c.Dir, c.Diagnostics)), source)
		}
		stock := Project{Files: map[string]string{"main.ts": counterpart}, Config: fmt.Sprintf(errorTwinConfig, "main.ts")}
		dir := emitDeclarationIdentityStock(t, w, tsc, stock)
		defer os.RemoveAll(dir)
		want, err := os.ReadFile(filepath.Join(dir, "__identity_out", "main.d.ts"))
		if err != nil {
			t.Fatal(err)
		}
		got, ok := c.Outputs["__identity_out/main.d.ts"]
		if !ok {
			t.Fatal("missing declaration output", c.Outputs)
		}
		if diff := compareDeclarationTexts(t, string(want), got); diff != "" {
			Gap(t, doDeclarationBytesTarget, "bytes:"+gap, "Chapter 1: %s\nstock TypeScript:\n%s\nVibeLang:\n%s\nsource:\n%s\ncounterpart:\n%s\nAPI:\n%s", doDeclarationQuotes[0].quote, want, got, source, counterpart, diff)
		}
		ExpectPending(t, doDeclarationBytesTarget, "compile:"+gap)
		ExpectPending(t, doDeclarationBytesTarget, "bytes:"+gap)
		ExpectPending(t, doDeclarationBytesTarget, specCorpusKey(t))
	})
}
