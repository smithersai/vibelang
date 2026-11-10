package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const parameterDecoratorAwaitQuote = "Forbidden `await` in directly evaluated formal-parameter initialization of an Effect callable or producer is `EK0102`"

func TestEffectParameterDecoratorAwaitQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", parameterDecoratorAwaitQuote)
}

func parameterDecoratorAwaitRules() []effectAwaitPlacementRule {
	var rules []effectAwaitPlacementRule
	for _, head := range []struct{ key, source string }{
		{"class", "@(KEY) class {}"},
		{"method", "class { @(KEY) read() {} }"},
		{"field", "class { @(KEY) value = 1 }"},
		{"getter", "class { @(KEY) get read() { return 1 } }"},
		{"setter", "class { @(KEY) set read(value: number) {} }"},
	} {
		for _, home := range []struct{ key, source string }{
			{"declaration", "export effect function read(%s) { return 0 }"},
			{"expression", "export const read = effect function(%s) { return 0 }"},
			{"arrow", "export const read = effect (%s) => 0"},
			{"method", "export class Home { effect read(%s) { return 0 } }"},
			{"object", "export const home = { effect read(%s) { return 0 } }"},
			{"producer", "export effect function* read(%s) { yield 0 }"},
		} {
			for _, operand := range []struct{ key, value string }{
				{"promise", "Promise.resolve(\"read\")"},
				{"scalar", "1"},
				{"any", "(undefined as any)"},
				{"effect", "Effect.succeed(\"read\")"},
			} {
				for _, shape := range []string{"direct", "moved"} {
					key := "((await " + operand.value + ") as unknown as typeof decorate)"
					parameter := "base = " + strings.ReplaceAll(head.source, "KEY", key)
					if shape == "moved" {
						parameter = "early = do { if (false) return; 0 }, " + parameter
					}
					rules = append(rules, effectAwaitPlacementRule{
						head.key + ":" + home.key + ":" + shape + ":" + operand.key,
						"import {Effect} from \"effect\";\nconst decorate = (...args: any[]) => {};\n" + fmt.Sprintf(home.source, parameter),
					})
				}
			}
		}
	}
	return rules
}

func FuzzEffectParameterDecoratorAwait(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "001-functions.md", parameterDecoratorAwaitQuote)
	rules := parameterDecoratorAwaitRules()
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
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": rule.source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		found := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 102 {
				found++
			} else {
				errors = append(errors, d.String())
			}
		}
		if found != 1 || len(errors) != 0 {
			Gap(t, "FuzzEffectParameterDecoratorAwait", rule.key, "%s\nwant only EK0102, got count=%d other=%v\n%s", parameterDecoratorAwaitQuote, found, errors, rule.source)
		}
	})
}
