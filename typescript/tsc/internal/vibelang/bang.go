package vibelang

import (
	"regexp"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// The ! form of Effect types.
//
// .vibe code writes Effect<A, E, R> as A!E!R, with an empty slot for never
// (D127; the parser expands it). Hovers and messages about .vibe code write
// types the same way; declaration files keep Effect<A, E, R>, so TypeScript
// consumers see Effect's own types.

func init() {
	ls.RegisterQuickInfoTextHook(bangQuickInfo)
}

// bangQuickInfo rewrites the Effect types of a hover on .vibe code into the
// ! form.
func bangQuickInfo(c *checker.Checker, node *ast.Node, text string) string {
	if !isVibeLangFile(ast.GetSourceFileOfNode(node)) {
		return text
	}
	return bangTypes(text)
}

// bangText writes an Effect type from the texts of its channels, A, E, and R,
// in the ! form. A missing or never channel is an empty slot.
func bangText(channels ...string) string {
	slots := make([]string, 3)
	for i := range slots {
		// An empty error or requirement slot is never; the success slot has
		// no empty form, so a never success stays written.
		if i < len(channels) && (channels[i] != "never" || i == 0) {
			slots[i] = bangSlot(channels[i], i > 0)
		}
	}
	return slots[0] + "!" + slots[1] + "!" + slots[2]
}

// bangSlot parenthesizes a channel's text when it would not stay one slot: a
// union, intersection, function, constructor, or conditional type, which would take the slots after
// it, an Effect type in the ! form, or, after a !, an object type, whose {
// would start a function body.
func bangSlot(text string, afterBang bool) string {
	if hasTopLevel(text, "=>") || hasTopLevel(text, "?") || hasTopLevel(text, "!") || hasTopLevel(text, "|") || hasTopLevel(text, "&") || afterBang && strings.HasPrefix(text, "{") {
		return "(" + text + ")"
	}
	return text
}

// hasTopLevel reports whether text contains token outside brackets and string
// literals.
func hasTopLevel(text string, token string) bool {
	depth := 0
	for i := 0; i < len(text); i++ {
		switch ch := text[i]; {
		case strings.HasPrefix(text[i:], "=>"):
			if token == "=>" && depth == 0 {
				return true
			}
			i++
		case ch == '"' || ch == '\'' || ch == '`':
			i = skipString(text, i)
		case ch == '(' || ch == '[' || ch == '{' || ch == '<':
			depth++
		case ch == ')' || ch == ']' || ch == '}' || ch == '>':
			depth--
		case depth == 0 && strings.HasPrefix(text[i:], token):
			return true
		}
	}
	return false
}

// skipString returns the index of the quote that closes the string literal
// that starts at text[start].
func skipString(text string, start int) int {
	quote := text[start]
	for i := start + 1; i < len(text); i++ {
		switch text[i] {
		case '\\':
			i++
		case quote:
			return i
		}
	}
	return len(text) - 1
}

// effectStart matches the start of an Effect type in type text: Effect<,
// Effect.Effect<, or an import type of effect/Effect's Effect.
var effectStart = regexp.MustCompile(`(?:import\("[^"]*"(?:, \{[^()]*\})?\)\.)?(?:Effect\.)?Effect<`)

// bangTypes rewrites every Effect<A, E, R> in text, a type or a declaration
// that TypeScript printed, into the ! form, innermost first.
func bangTypes(text string) string {
	var out strings.Builder
	rest := text
	for {
		loc := effectStart.FindStringIndex(rest)
		if loc == nil {
			out.WriteString(rest)
			return out.String()
		}
		start, open := loc[0], loc[1]
		if start > 0 && isIdentifierChar(rest[start-1]) {
			out.WriteString(rest[:open])
			rest = rest[open:]
			continue
		}
		close, arguments := typeArguments(rest, open)
		if close < 0 || len(arguments) == 0 || len(arguments) > 3 {
			out.WriteString(rest[:open])
			rest = rest[open:]
			continue
		}
		for i, argument := range arguments {
			arguments[i] = bangTypes(argument)
		}
		bang := bangText(arguments...)
		before := strings.TrimRight(out.String()+rest[:start], " ")
		after := strings.TrimLeft(rest[close+1:], " ")
		if strings.HasSuffix(before, "|") || strings.HasSuffix(before, "&") || strings.HasPrefix(after, "|") || strings.HasPrefix(after, "&") || strings.HasPrefix(after, "[") {
			bang = "(" + bang + ")"
		}
		out.WriteString(rest[:start])
		out.WriteString(bang)
		rest = rest[close+1:]
	}
}

// typeArguments reads the type arguments that start after the < at
// text[open-1]. It returns the index of the closing > and each argument's
// text, or -1 when the arguments do not close.
func typeArguments(text string, open int) (int, []string) {
	depth := 0
	var arguments []string
	last := open
	for i := open; i < len(text); i++ {
		switch ch := text[i]; {
		case strings.HasPrefix(text[i:], "=>"):
			i++
		case ch == '"' || ch == '\'' || ch == '`':
			i = skipString(text, i)
		case ch == '(' || ch == '[' || ch == '{' || ch == '<':
			depth++
		case ch == ')' || ch == ']' || ch == '}':
			depth--
		case ch == '>':
			if depth == 0 {
				return i, append(arguments, strings.TrimSpace(text[last:i]))
			}
			depth--
		case ch == ',' && depth == 0:
			arguments = append(arguments, strings.TrimSpace(text[last:i]))
			last = i + 1
		}
	}
	return -1, nil
}

func isIdentifierChar(ch byte) bool {
	return ch == '_' || ch == '$' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9'
}
