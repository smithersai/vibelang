package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-55's task and workflow declarations: the static shape rule and the
// contextual keywords, read from the services chapter.
const durableShapeQuote = "A `task` or `workflow` body holds exactly one non-static `effect call` method, not a generator, and `static readonly` members with initializers, nothing else. A task's `call` writes a type for each parameter and its return type. Anything else is the syntax error `EK5501`."
const durableContextualQuote = "`task` and `workflow` are contextual: each starts a declaration only at the start of a statement, with a name other than `as`, `satisfies` or `is` after it on the same line, so `const task = 1`, `task as Job` and `workflow.run()` keep their TypeScript meaning."
const durableWorkflowBodyQuote = "WorkflowDeclaration = WorkflowStart \"{\" DurableMember* \"}\"   (VIP-55: exactly one CallMember with a body)"

func durableDeclarationQuotes(tb testing.TB) {
	tb.Helper()
	services := SpecText("005-services.md")
	for _, quote := range []string{durableShapeQuote, durableContextualQuote} {
		if !strings.Contains(services, quote) {
			tb.Fatalf("durable declaration rule changed: %q", quote)
		}
	}
	if !strings.Contains(SpecText("900-appendices.md"), durableWorkflowBodyQuote) {
		tb.Fatalf("durable declaration grammar changed: %q", durableWorkflowBodyQuote)
	}
}

func TestDurableDeclarationsQuoted(t *testing.T) { durableDeclarationQuotes(t) }

// durableMember is one member a generated body may hold: its source, and
// whether it is the call, an admitted option, or rejected.
type durableMember struct {
	key    string
	source string
	call   bool // a non-static effect call method, not a generator
	typed  bool // writes a type for each parameter and its return type
	body   bool
	option bool // static readonly with an initializer
}

var durableMembers = []durableMember{
	{key: "call", source: "effect call(id: string, n: number): number!string { return n }", call: true, typed: true, body: true},
	{key: "call-object", source: "effect call(input: { id: string; tags: ReadonlyArray<string> }): ReadonlyArray<string>!never { return input.tags }", call: true, typed: true, body: true},
	{key: "call-untyped-parameter", source: "effect call(id): number!string { return 1 }", call: true, body: true},
	{key: "call-no-return", source: "effect call(id: string) { return id.length }", call: true, body: true},
	{key: "call-bodyless", source: "effect call(order: string): number!string", call: true, typed: true},
	{key: "call-plain", source: "call(id: string): number { return 1 }"},
	{key: "call-static", source: "static effect call(id: string): number!never { return 1 }"},
	{key: "call-generator", source: "effect *call(id: string): number!never { yield 1 }"},
	{key: "option", source: "static readonly retryPolicy = { initialMs: 1000, factor: 2, maxMs: 4000, maxAttempts: 3 }", option: true},
	{key: "option-key", source: "static readonly key = \"billing/Charge\"", option: true},
	{key: "option-quoted", source: "static readonly \"maxRounds\" = 3", option: true},
	{key: "option-writable", source: "static maxRounds = 3"},
	{key: "option-uninitialized", source: "static readonly maxRounds: number"},
	{key: "field", source: "readonly retries = 1"},
	{key: "method", source: "helper() { return 1 }"},
	{key: "effect-method", source: "effect helper(id: string) { return id }"},
}

// durableContexts are the statement positions a declaration may take.
var durableContexts = []string{"%s", "export %s", "function scope() {\n%s\n}", "effect function scope() {\n%s\n}"}

func durableMemberByKey(key string, b byte) durableMember {
	for _, m := range durableMembers {
		if m.key == key {
			return m
		}
	}
	return durableMembers[int(b)%len(durableMembers)]
}

func FuzzDurableDeclarations(f *testing.F) {
	startShortBudget(f)
	durableDeclarationQuotes(f)
	for _, m := range durableMembers {
		for _, flags := range []uint8{0, 1, 2, 5, 6, 9, 13} {
			f.Add(m.key, "", flags)
			f.Add("option", m.key, flags)
			f.Add(m.key, "call", flags)
		}
	}
	// A ; after the call's body is an empty class element, not a member
	// (campaign find: task, call then option, "; " separator).
	f.Add("call", "option", uint8(74))
	f.Fuzz(func(t *testing.T, first string, second string, flags uint8) {
		workflow := flags&1 != 0
		word := "task"
		if workflow {
			word = "workflow"
		}
		var members []durableMember
		for _, key := range []string{first, second} {
			if key == "" {
				continue
			}
			b := byte(0)
			if len(key) > 0 {
				b = key[0]
			}
			members = append(members, durableMemberByKey(key, b))
		}
		calls, valid := 0, true
		for _, m := range members {
			switch {
			case m.call:
				calls++
				if !workflow && !m.typed || workflow && !m.body {
					valid = false
				}
			case !m.option:
				valid = false
			}
		}
		if calls != 1 {
			valid = false
		}
		separator := []string{"\n  ", "; ", "\n\n  "}[int(flags>>1)%3]
		var body []string
		for _, m := range members {
			body = append(body, m.source)
		}
		declaration := fmt.Sprintf("%s Shape {\n  %s\n}", word, strings.Join(body, separator))
		context := durableContexts[int(flags>>3)%len(durableContexts)]
		source := fmt.Sprintf(context, declaration) + "\nconst task = 1\nconst workflow = { run: () => task }\ntask as number\nworkflow.run()\n"
		fileName := "/main.vibe"
		if flags&64 != 0 {
			fileName = "/main.vibex"
		}
		var keys []string
		for _, m := range members {
			keys = append(keys, m.key)
		}
		precise := fmt.Sprintf("%s:%s:%d", word, strings.Join(keys, "+"), flags)
		t.Logf("durable profile=%s", precise)
		file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
		var shape, other []*ast.Diagnostic
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" && d.Code() == parser.DurableCallDiagnosticCode {
				shape = append(shape, d)
			} else {
				other = append(other, d)
			}
		}
		// An admitted body is valid TypeScript class syntax: nothing else in
		// it may draw a diagnostic of its own.
		if valid && len(other) != 0 {
			Gap(t, "FuzzDurableDeclarations", precise+":other", "an admitted body drew a parse diagnostic: %v", other)
		}
		if valid && len(shape) != 0 {
			Gap(t, "FuzzDurableDeclarations", precise+":admitted", "a body the rule admits drew EK5501: %v", shape)
		}
		if !valid && len(shape) == 0 {
			Gap(t, "FuzzDurableDeclarations", precise+":rejected", "a body the rule rejects drew no EK5501")
		}
		declared := 0
		for _, form := range forms {
			if form.Kind == parser.VibeSyntaxDeclaration && (form.Name == parser.VibeSyntaxTask || form.Name == parser.VibeSyntaxWorkflow) {
				declared++
				if form.Name != word || !strings.HasPrefix(source[form.Head.Pos():form.Head.End()], word+" Shape") {
					Gap(t, "FuzzDurableDeclarations", precise+":head", "recorded %s head %q", form.Name, source[form.Head.Pos():form.Head.End()])
				}
			}
		}
		// The contextual uses after the declaration stay identifiers.
		if declared != 1 {
			Gap(t, "FuzzDurableDeclarations", precise+":contextual", "want one recorded declaration, got %d", declared)
		}
	})
}
