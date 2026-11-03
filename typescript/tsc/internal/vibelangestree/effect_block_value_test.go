package vibelangestree

import (
	"strings"
	"testing"
)

func TestEffectBlockIsProgramValue(t *testing.T) {
	for _, source := range []string{
		"export const value = effect { return 1 }",
		"export const values = [effect { return 1 }]",
		"export const values = { value: effect { return 1 } }",
		"export function make() { return effect { return 1 } }",
		"consume(effect { return 1 })",
	} {
		t.Run(source, func(t *testing.T) {
			tree := parse(t, "test.vibe", source)
			programs := 0
			for _, call := range find(tree, "CallExpression") {
				callee := call["callee"].(map[string]any)
				if callee["name"] != "$effect" {
					continue
				}
				programs++
				if callee["synthesized"] != true {
					t.Fatalf("builder leaks a binding: %v", callee)
				}
				start, end := rangeOf(callee)
				if source[start:end] != "effect" {
					t.Fatalf("builder spans %q", source[start:end])
				}
				arguments := call["arguments"].([]any)
				if len(arguments) != 1 || arguments[0].(map[string]any)["type"] != "ArrowFunctionExpression" {
					t.Fatalf("lost lexical program function: %v", arguments)
				}
			}
			if programs != 1 {
				t.Fatalf("got %d program-value builders, want 1: %s", programs, source)
			}
		})
	}
}

func TestEffectBlockArgumentIsNotHandler(t *testing.T) {
	source := "Effect.catchCause(effect { return 1 }, effect (cause) => cause)"
	tree := parse(t, "test.vibe", source)
	for _, call := range find(tree, "CallExpression") {
		start, end := rangeOf(call)
		if !strings.HasPrefix(source[start:end], "Effect.catchCause(") {
			continue
		}
		args := call["arguments"].([]any)
		if args[0].(map[string]any)["type"] != "CallExpression" {
			t.Fatalf("program argument reads as a handler: %v", args[0])
		}
		if args[1].(map[string]any)["type"] != "ArrowFunctionExpression" {
			t.Fatalf("written handler lost its function shape: %v", args[1])
		}
		return
	}
	t.Fatal("lost catchCause")
}
