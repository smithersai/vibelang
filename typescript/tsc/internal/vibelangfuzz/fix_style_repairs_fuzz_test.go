package vibelangfuzz

import (
	"strings"
)

// A style construct: its declaration line, the rule that reports it, the
// port and lint codes that name the rule, and the comment-free text the
// repair writes, or "" when a comment makes the repair decline.
type fixStyleConstruct struct {
	source, port, lint, fixed string
}

// fixStyleConstructs are keyed (RULES.md 11). alchemy-effect-arrow-object is
// the conversion alchemy's lint rejected.
var fixStyleConstructs = map[string]fixStyleConstruct{
	"alchemy-effect-arrow-object": {"export const make = effect (value: number) => { return { value }; }", "EK4823", "EK38123", "export const make = effect (value: number) => ({ value })"},
	"plain-arrow":                 {"export const inc = (n: number) => { return n + 1 }", "EK4823", "EK38123", "export const inc = (n: number) => n + 1"},
	"callback-comma":              {"export const pairs = [1, 2].map((n) => { return n, 3 })", "EK4823", "EK38123", "export const pairs = [1, 2].map((n) => (n, 3))"},
	"empty-method-pipe":           {"export const empty = Effect.succeed(1).pipe()", "EK4824", "EK38126", "export const empty = Effect.succeed(1)"},
	"empty-function-pipe":         {"export const bare = pipe(Effect.succeed(1))", "EK4824", "EK38126", "export const bare = Effect.succeed(1)"},
	"function-chain": {"export const chain = pipe(pipe(Effect.succeed(1), Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))", "EK4825", "EK38127",
		"export const chain = pipe(Effect.succeed(1), Effect.map((n: number) => n + 1), Effect.map((n: number) => n * 2))"},
	"commented-empty-pipe": {"export const kept = Effect.succeed(1).pipe(/* why */)", "EK4824", "EK38126", ""},
	"commented-chain":      {"export const noted = pipe(pipe(Effect.succeed(1), /* first */ Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))", "EK4825", "EK38127", ""},
}

var fixStyleSeverities = []string{"off", "suggestion", "warning", "error"}

// declarationsOf returns r's declaration outputs by name.
func declarationsOf(r *Result) map[string]string {
	out := map[string]string{}
	for name, text := range r.Outputs {
		if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
			out[name] = text
		}
	}
	return out
}
