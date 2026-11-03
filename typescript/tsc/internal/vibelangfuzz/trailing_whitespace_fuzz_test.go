package vibelangfuzz

import (
	"fmt"
	"strings"
)

// The Chapter 7 migration preserves the old trailing block's behavior.
// FuzzFix supplies the existing declaration and runtime preservation oracles.
const trailingWhitespaceFixKey = "key:trailing-whitespace\n"

func trailingWhitespaceFixSources(input string) (string, string) {
	data := []byte(strings.TrimPrefix(input, trailingWhitespaceFixKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	spaces := []string{" ", "\t", "\v", "\f", "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u202f", "\u205f", "\u3000", "\ufeff", " \u00a0\t"}
	heads := []string{"g(1)", "g(1,)", "g<number>(1)", "zero()", "zero"}
	source := fmt.Sprintf("function g<T>(n:T, cb:()=>number) { return cb() }; function zero(cb:()=>number) { return cb() }; export function main() { const n = %s%s{return %d;}; return Effect.succeed(n); }", heads[int(pick(1))%len(heads)], spaces[int(pick(0))%len(spaces)], int(pick(2)))
	// Chapter 7's mechanical repair is the explicit native callback argument.
	// Give FuzzFix a stock-TypeScript reference because the denied legacy input
	// also carries a callback-type error and cannot be its own runtime oracle.
	callbackHeads := []string{"g(1, () => ", "g(1, () => ", "g<number>(1, () => ", "zero(() => ", "zero(() => "}
	reference := fmt.Sprintf(`import { Effect } from "effect"; function g<T>(n:T, cb:()=>number) { return cb() }; function zero(cb:()=>number) { return cb() }; export function main() { const n = %s{return %d;}); return Effect.succeed(n); }`, callbackHeads[int(pick(1))%len(callbackHeads)], int(pick(2)))
	return source, reference
}
