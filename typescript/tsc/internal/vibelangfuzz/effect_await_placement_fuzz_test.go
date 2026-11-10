package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectAwaitParameterQuote = "Forbidden `await` in directly evaluated formal-parameter initialization of an Effect callable or producer is `EK0102`"

const effectAwaitPlacementQuote = "`await`, `for await` and `await using` inside effect code are errors"

func effectAwaitPlacementCited(t testing.TB) {
	t.Helper()
	chapterSays(t, "001-functions.md", effectAwaitParameterQuote)
	chapter, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	appendix, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), effectAwaitPlacementQuote) {
		t.Fatalf("chapter 2 no longer says %q", effectAwaitPlacementQuote)
	}
	if !strings.Contains(string(appendix), "| `EK0102` |") {
		t.Fatal("Appendix B no longer assigns EK0102")
	}
}
func TestEffectAwaitPlacementQuoted(t *testing.T) { effectAwaitPlacementCited(t) }

type effectAwaitPlacementRule struct{ key, source string }

func effectAwaitPlacementRules() []effectAwaitPlacementRule {
	var rules []effectAwaitPlacementRule
	for _, operand := range []struct{ key, prelude, value string }{
		{"promise", "", "Promise.resolve(1)"}, {"thenable", "declare const value: PromiseLike<number>;", "value"},
		{"scalar", "", "1"}, {"any", "declare const value: any;", "value"}, {"unknown", "declare const value: unknown;", "value"},
		{"never", "declare const value: never;", "value"}, {"effect", "", "Effect.succeed(1)"},
		{"fiber", "declare const value: Fiber.Fiber<number>;", "value"}, {"deferred", "declare const value: Deferred.Deferred<number>;", "value"},
		{"union", "declare const value: number | Promise<number>;", "value"}, {"parentheses", "", "((Promise.resolve(1)))"},
		{"comment", "", "/* wait 😀 */ Promise.resolve(1)"},
	} {
		for _, context := range []struct{ key, body string }{
			{"function", "effect function f() { %s; return 0 }"}, {"arrow", "const f = effect () => { %s; return 0 }"},
			{"block", "const f = effect { %s; return 0 }"}, {"producer", "effect function* f() { %s; yield 0 }"},
		} {
			rules = append(rules, effectAwaitPlacementRule{operand.key + ":" + context.key, "import { Effect, Fiber, Deferred } from \"effect\";\n" + operand.prelude + "\n" + fmt.Sprintf(context.body, "await "+operand.value)})
		}

		for _, home := range []struct{ key, source string }{
			{"declaration", "export effect function f(%s) { return 0 }"},
			{"expression", "export const f = effect function(%s) { return 0 }"},
			{"arrow", "export const f = effect (%s) => 0"},
			{"method", "export class Home { effect f(%s) { return 0 } }"},
			{"object", "export const home = { effect f(%s) { return 0 } }"},
			{"producer", "export effect function* f(%s) { yield 0 }"},
		} {
			for _, shape := range []string{"direct", "moved"} {
				parameter := "base = class extends ((await " + operand.value + ") as any) {}"
				if shape == "moved" {
					parameter = "early = do { if (false) return; 0 }, " + parameter
				}
				body := fmt.Sprintf(home.source, parameter)
				rules = append(rules, effectAwaitPlacementRule{
					operand.key + ":heritage-" + home.key + "-" + shape,
					"import {Effect,Fiber,Deferred} from \"effect\";\n" + operand.prelude + "\n" + body,
				})
			}
		}

		if operand.key == "promise" || operand.key == "scalar" || operand.key == "any" || operand.key == "effect" {
			for _, kind := range []string{"declaration", "arrow", "method", "producer"} {
				for _, shape := range []string{"returning", "earlier", "later"} {
					parameter := "flag=false,value=do {if(flag)return; await " + operand.value + "}"
					if shape == "earlier" {
						parameter = "value=await " + operand.value + ",flag=false,last=do {if(flag)return; 1}"
					}
					if shape == "later" {
						parameter = "first=do {if(false)return; 1},value=await " + operand.value
					}
					body := "export effect function f(" + parameter + "){return value}"
					if kind == "arrow" {
						body = "export const f=effect (" + parameter + ")=>value"
					}
					if kind == "method" {
						body = "export class C {effect f(" + parameter + "){return value}}"
					}
					if kind == "producer" {
						body = "export effect function* f(" + parameter + "){yield value}"
					}
					rules = append(rules, effectAwaitPlacementRule{operand.key + ":moved-" + kind + "-" + shape, "import {Effect,Fiber,Deferred} from \"effect\";\n" + operand.prelude + "\n" + body})
				}
			}
		}
	}
	return rules
}

func FuzzEffectAwaitPlacement(f *testing.F) {
	startShortBudget(f)
	effectAwaitPlacementCited(f)
	rules := effectAwaitPlacementRules()
	for _, rule := range rules {
		f.Add([]byte(rule.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := 0
		if len(data) > 0 {
			choice = int(data[0]) % len(rules)
		}
		for i, rule := range rules {
			if string(data) == rule.key {
				choice = i
				break
			}
		}
		rule := rules[choice]
		good, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": "export async function f() { return await Promise.resolve(1) }"}})
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range good.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				good.Remove()
				t.Fatalf("native async control failed: %s", d.String())
			}
		}
		good.Remove()
		bad, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": rule.source}})
		if err != nil {
			t.Fatal(err)
		}
		defer bad.Remove()
		placement, legacy := 0, false
		var got []string
		for _, d := range bad.Diagnostics {
			got = append(got, d.String())
			if !IsEK(d) {
				continue
			}
			if d.Code() == 102 && d.Category() == diagnostics.CategoryError {
				placement++
			}
			if d.Code() >= 4601 && d.Code() <= 4604 {
				legacy = true
			}
		}
		if placement != 1 || legacy {
			Gap(t, "FuzzEffectAwaitPlacement", rule.key, "chapter 2: %s; Appendix B assigns EK0102; got count=%d legacy=%v\n%s\n%s", effectAwaitPlacementQuote, placement, legacy, rule.source, strings.Join(got, "\n"))
		}
	})
}
