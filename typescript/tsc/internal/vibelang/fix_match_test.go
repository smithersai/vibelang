package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// D472: EK4839's quick fix writes a Match chain as a match expression with
// the same arms, the same choice, and the same type.
// Chapter 007 / supported Match chain finishers preserve the written handlers: docs/design/src/007-tooling.md#00ff7d35845ac8f0
func TestMatchChainQuickFixes(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"literals with a fallback", `export function label(status: "idle" | "busy" | "failed"): string {
  return Match.value(status).pipe(
    Match.when("idle", () => "Idle"),
    // anything else
    Match.orElse((other) => "Other " + other),
  )
}
`, `export function label(status: "idle" | "busy" | "failed"): string {
  return match (status) {
    when "idle": "Idle";
    // anything else
    when let other: "Other " + other;
  }
}
`},
		{"a primitive type keeps its name", "export const label = (n: 1 | 2) => Match.value(n).pipe(Match.when(1, () => \"one\"), Match.when(2, () => \"two\"), Match.exhaustive)\n",
			"export const label = (n: 1 | 2) => do { const $matchResult: string = match (n) { when 1: \"one\"; when 2: \"two\"; }; $matchResult; }\n"},
		{"a const takes the type", "export function kind(n: 1 | 2) {\n  const k = Match.value(n).pipe(Match.when(1, () => \"one\"), Match.orElse(() => \"many\"))\n  return k\n}\n",
			"export function kind(n: 1 | 2) {\n  const k: string = match (n) { when 1: \"one\"; default: \"many\"; }\n  return k\n}\n"},
		{"tags with fields", `type Shape = { readonly _tag: "Circle"; readonly radius: number } | { readonly _tag: "Square"; readonly side: number }
export function area(shape: Shape): number {
  return Match.value(shape).pipe(
    Match.tag("Circle", ({ radius }) => Math.PI * radius * radius),
    Match.tag("Square", (square) => square.side * square.side),
    Match.exhaustive,
  )
}
`, `type Shape = { readonly _tag: "Circle"; readonly radius: number } | { readonly _tag: "Square"; readonly side: number }
export function area(shape: Shape): number {
  return match (shape) {
    when { _tag: "Circle", let radius }: Math.PI * radius * radius;
    when { _tag: "Square" } and let square: square.side * square.side;
  }
}
`},
		{"tagsExhaustive and withReturnType", `type Event = { readonly _tag: "Opened" } | { readonly _tag: "Closed"; readonly reason: string }
export const describe = (event: Event) =>
  Match.value(event).pipe(
    Match.withReturnType<string>(),
    Match.tagsExhaustive({
      Opened: () => "open",
      Closed: ({ reason }) => {
        const text = reason.trim()
        return "closed: " + text
      },
    }),
  )
`, `type Event = { readonly _tag: "Opened" } | { readonly _tag: "Closed"; readonly reason: string }
export const describe = (event: Event) =>
  do { const $matchResult: string = match (event) {
    when { _tag: "Opened" }: "open";
    when { _tag: "Closed", let reason }: do {
      const text = reason.trim()
      "closed: " + text
    };
  }; $matchResult; }
`},
		{"objects, or, not and refinements", `type Config = { readonly method: "token" | "oauth" | "none"; readonly value: string | number }
export function kind(config: Config): string {
  return Match.value(config).pipe(
    Match.when({ method: "token", value: Match.string }, () => "token text"),
    Match.whenOr({ method: "oauth" }, { method: "none" }, (c) => c.method),
    Match.not({ value: Match.number }, () => "other"),
    Match.orElse(() => "numbered"),
  )
}
`, `type Config = { readonly method: "token" | "oauth" | "none"; readonly value: string | number }
export function kind(config: Config): string {
  return match (config) {
    when { method: "token", value: String }: "token text";
    when ({ method: "oauth" } or { method: "none" }) and let c: c.method;
    when not { value: Number }: "other";
    default: "numbered";
  }
}
`},
		// A handler's program stays a value in the arm: by-name runs retired (VIP-1, VIP-5).
		{"a handler that builds a program", "export const f = (n: 1 | 2) => Match.value(n).pipe(Match.when(1, () => Effect.log(\"one\")), Match.orElse(() => Effect.void))\n", "export const f = (n: 1 | 2) => match (n) { when 1: Effect.log(\"one\"); default: Effect.void; }\n"},
		{"pipe and Match.type", "export const size = pipe(\n  Match.type<number | string>(),\n  Match.when(Match.number, (n) => n),\n  Match.when(Match.string, (s) => s.length),\n  Match.exhaustive\n)\n",
			"export const size = (u: string | number): number => match (u) {\n  when Number and let n: n;\n  when String and let s: s.length;\n}\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := applyQuickFix(t, test.source, EK4839.Code)
			if got != test.want {
				t.Fatalf("edited source differs:\ngot:\n%s\nwant:\n%s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == EK4839.Code {
					t.Errorf("the fixed source reports %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

// Where a match would choose differently, run what the chain only built, or
// have another type, EK4839 has no quick fix and its note says why.
// Destructuring fallbacks are positive cases in TestMatchDefaultDestructureFoldkit.
// Chapter 007 / unsupported Match patterns and handlers retain source: docs/design/src/007-tooling.md#5d8fbe0b4f027c86
func TestMatchChainRefusals(t *testing.T) {
	for _, test := range []struct{ name, source, why string }{
		{"a predicate", "export const f = (n: number) => Match.value(n).pipe(Match.when((x) => x > 1, () => \"big\"), Match.orElse(() => \"small\"))\n", "has no match pattern"},
		{"an array pattern", "export const f = (xs: ReadonlyArray<number>) => Match.value(xs).pipe(Match.when([1], () => \"one\"), Match.orElse(() => \"other\"))\n", "has no match pattern"},
		{"a handler that is not an arrow", "function one() { return \"one\" }\nexport const f = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, one), Match.orElse(() => \"two\"))\n", "is not an arrow function"},
		{"a handler with early returns", "export const f = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, () => { if (n) return \"a\"; return \"b\" }), Match.orElse(() => \"two\"))\n", "does not end in its only return"},
		{"a type no name writes", "type Box = { readonly n: number }\nexport const f = (n: 1 | 2) => Match.value(n).pipe(Match.when(1, (): Box => ({ n: 1 })), Match.orElse((): Box | undefined => undefined))\n", "the match's type would be its arms'"},
		{"a comment in a stage", "export const f = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, /* one */ () => \"one\"), Match.orElse(() => \"two\"))\n", "a comment stands in a stage"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var found *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4839.Code {
					found = d
				}
			}
			if found == nil {
				t.Fatalf("missing EK4839 in:\n%s", test.source)
			}
			notes := ""
			for _, chained := range found.MessageChain() {
				notes += chained.String() + "\n"
			}
			if !strings.Contains(notes, "No quick fix") || !strings.Contains(notes, test.why) {
				t.Fatalf("EK4839's note %q does not say %q", notes, test.why)
			}
		})
	}
}

// A chain that does not end in a finisher, or whose value runs, draws nothing:
// a partial matcher has no match form.
func TestMatchChainNotReported(t *testing.T) {
	for _, source := range []string{
		"export const f = (n: number) => Match.value(n).pipe(Match.when(1, () => \"one\"), Match.option)\n",
		"export const partial = Match.type<number>().pipe(Match.when(1, () => \"one\"))\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() == diagnosticSource && d.Code() == EK4839.Code {
				t.Errorf("unexpected EK4839 in %s: %s", source, d.String())
			}
		}
	}
}
// VIP-7 refuse native Match migration when contextual types cannot be preserved; rule: docs/design/vips/0007-match.md#ac19cae21b402757
