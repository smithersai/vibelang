package vibelangmapper

import (
	"strings"
	"testing"
)

func TestProjectWrittenEffectDeclarations(t *testing.T) {
	cases := map[string]string{
		"class pure":              "class Example { effect run() { return 7 } }",
		"class static":            "class Example { static effect run() { return 7 } }",
		"class private":           "class Example { effect #run() { return 7 } }",
		"class alias":             "type Result = number!!; class Example { effect run(): Result { return 7 } }",
		"function alias":          "type Result = number!!; effect function run(): Result { return 7 }",
		"function imported alias": "import type { Result } from './host.js'; effect function run(): Result { return 7 }",
		"default function alias":  "type Result = number!!; export default effect function (): Result { return 7 }",
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			projected := Project(source, testContext)
			if !strings.Contains(projected.Text, "function*") {
				t.Fatalf("VIP-1: written effect declaration lost its Effect body:\n%s\n%s", source, projected.Text)
			}
		})
	}
}

func TestProjectWrittenDeclarationMarkDoesNotReachSibling(t *testing.T) {
	source := "class Example { effect run() { return 7 } plain(): number { return 8 } }"
	projected := Project(source, testContext)
	if got := strings.Count(projected.Text, "function*"); got != 1 {
		t.Fatalf("want only the marked method's generator, got %d:\n%s", got, projected.Text)
	}
}

// Traversal sees bodies on namespaces, static blocks and statements too.
// Only function/method declarations have a function parameter list.
func TestWrittenDeclarationTraversalNonFunctionBodies(t *testing.T) {
	for _, source := range []string{
		"namespace Hidden { export function plain(): number { return 1 } }",
		"class Static { static { const value = 1 } effect run() { return 7 } }",
		"try { throw 1 } catch (error) { const value = error }",
		"while (false) { break }",
	} {
		t.Run(source, func(t *testing.T) {
			projected := Project(source, testContext)
			if projected.Text == "" {
				t.Fatal("projection returned no source")
			}
		})
	}
}
