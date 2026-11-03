package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const plainTryCatchTarget = "FuzzPlainTryCatch"

// Chapter 1; alchemy-13 (decided detail 205: a plain try/catch is JavaScript's).
const plainTryCatchQuote = "A `try { } catch { }` statement at the top level, or in a plain or `async` function, is JavaScript's, as in TypeScript. Only effect code bans it (VIP-5)."

func TestPlainTryCatchQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), plainTryCatchQuote) {
		t.Fatalf("Chapter 1 no longer says %q", plainTryCatchQuote)
	}
}

func plainTryCatchForms() map[string]string {
	return map[string]string{
		"catch":             "try { return parse(s) } catch { return fallback }",
		"catch-binding":     "try { return parse(s) } catch (e) { return String(e) }",
		"catch-rethrow":     "try { return parse(s) } catch (e) { throw e }",
		"finally":           "let out = fallback; try { out = parse(s) } finally { void out } return out",
		"catch-finally":     "let out = fallback; try { out = parse(s) } catch { out = fallback } finally { void out } return out",
		"nested":            "try { try { return parse(s) } catch { return fallback } } catch { return fallback }",
		"catch-in-loop":     "for (const part of s.split(\",\")) { try { return parse(part) } catch { continue } } return fallback",
		"catch-in-callback": "return [s].map((part) => { try { return parse(part) } catch { return fallback } })[0] ?? fallback",
	}
}

func plainTryCatchHomes() []string {
	return []string{"function", "arrow", "method", "async-function", "top-level", "effect-function"}
}

// plainTryCatchProgram puts the statement into a home. The effect-function home
// is the one home where Chapter 1 bans the statement.
func plainTryCatchProgram(home, form string) string {
	prelude := "declare function parse(s: string): string;\nconst fallback = \"fallback\";\n"
	body := plainTryCatchForms()[form]
	switch home {
	case "function":
		return prelude + "export function probe(s: string): string { " + body + " }\n"
	case "arrow":
		return prelude + "export const probe = (s: string): string => { " + body + " };\n"
	case "method":
		return prelude + "export const host = { probe(s: string): string { " + body + " } };\n"
	case "async-function":
		return prelude + "export async function probe(s: string): Promise<string> { " + body + " }\n"
	case "top-level":
		if form == "catch-in-callback" {
			// Keep callback returns inside their own function and void the whole
			// expression, rather than the non-nullish left operand of ?? alone.
			return prelude + "const s = \"x\";\nvoid ([s].map((part) => { try { return parse(part) } catch { return fallback } })[0] ?? fallback);\nexport {};\n"
		}
		return prelude + "const s = \"x\";\n" + strings.ReplaceAll(body, "return ", "void ") + "\nexport {};\n"
	case "effect-function":
		return prelude + "export effect function probe(s: string): string!! { " + body + " }\n"
	}
	panic("unknown try/catch home")
}

// A plain try/catch is JavaScript's: no VibeLang diagnostic, warning or
// error, in any plain home; the identical TypeScript control compiles. In an
// effect function the statement is banned, so an EK error must appear. The
// run-time half (the fallback runs) belongs to the VIP-5 differential.
func FuzzPlainTryCatch(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#7bd7fe363a07173b
	// Chapter 001: native try/catch across plain, async and module homes (FuzzPlainTryCatch).

	startShortBudget(f)
	forms := plainTryCatchForms()
	names := make([]string, 0, len(forms))
	for name := range forms {
		names = append(names, name)
	}
	slices.Sort(names)
	homes := plainTryCatchHomes()
	for i := range homes {
		for _, name := range names {
			f.Add(name, uint8(i))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, form string, home uint8) {
		TestPlainTryCatchQuoted(t)
		if _, ok := forms[form]; !ok {
			if form == "" {
				return
			}
			form = names[int(form[0])%len(names)]
		}
		homeName := homes[int(home)%len(homes)]
		key := fmt.Sprintf("%s:%s", homeName, form)
		// A rethrow is a throw statement: outside effect and async code it is
		// EK0401 whatever try statement holds it (chapter 3).
		banned := homeName == "effect-function" || form == "catch-rethrow" && homeName != "async-function"
		for _, native := range []bool{true, false} {
			if native && banned {
				continue
			}
			source := plainTryCatchProgram(homeName, form)
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "check plain try/catch", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			ek := false
			for _, d := range result.Diagnostics {
				if IsEK(d) {
					ek = true
				}
			}
			ok := !ek && !HasError(result.Diagnostics)
			if banned {
				ok = ek
			}
			if ok {
				continue
			}
			if native {
				t.Fatalf("invalid native try/catch control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			Gap(t, plainTryCatchTarget, key, "Chapter 1: a try/catch statement outside effect code is JavaScript's (banned=%t), got %v\n%s", banned, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		ExpectPending(t, plainTryCatchTarget, key)
		ExpectPending(t, plainTryCatchTarget, specCorpusKey(t))
	})
}
