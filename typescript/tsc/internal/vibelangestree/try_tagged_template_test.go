package vibelangestree

import "testing"

// `try e` before any operand but a call parses as $try(e), and its ESTree is
// that call; before a call or a tagged template it is the call or template
// itself, flagged. A call statement runs, but a tagged template statement
// reads to ESLint as an unused expression: t3code's
// statement try sql`VACUUM INTO ${target}` reported no-unused-expressions. A tried
// tagged template is therefore $try(template), as other operands are.
func TestTryTaggedTemplateIsTryCall(t *testing.T) {
	text := "declare const sql: (s: TemplateStringsArray, ...a: unknown[]) => unknown\n" +
		"export const run = effect {\n  try sql`VACUUM INTO ${1}`\n  const r = try sql`x`\n  try f()\n  return r\n}\n" +
		"declare const f: () => unknown\n"
	tree := parse(t, "test.vibe", text)
	calls := 0
	for _, call := range find(tree, "CallExpression") {
		callee := call["callee"].(map[string]any)
		if callee["name"] != "$try" {
			continue
		}
		calls++
		if callee["synthesized"] != true {
			t.Errorf("$try callee not marked synthesized: %v", callee)
		}
		if start, end := rangeOf(callee); text[start:end] != "try" {
			t.Errorf("$try callee spans %q; want the try keyword", text[start:end])
		}
		arguments := call["arguments"].([]any)
		if len(arguments) != 1 {
			t.Fatalf("$try has %d arguments", len(arguments))
		}
		template := arguments[0].(map[string]any)
		if template["type"] != "TaggedTemplateExpression" {
			t.Fatalf("$try argument is %v; want TaggedTemplateExpression", template["type"])
		}
		if start, end := rangeOf(template); text[start:start+3] != "sql" {
			t.Errorf("tagged template starts at %q; want its tag", text[start:end])
		}
		if start, end := rangeOf(call); text[start:start+7] != "try sql" {
			t.Errorf("$try call starts at %q; want try", text[start:end])
		}
	}
	if calls != 2 {
		t.Fatalf("found %d $try calls of tagged templates; want 2", calls)
	}
	for _, call := range find(tree, "CallExpression") {
		if callee := call["callee"].(map[string]any); callee["name"] == "f" {
			return // try f() stays the call f() itself
		}
	}
	t.Fatal("try f() lost its call")
}
