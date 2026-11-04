package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Appendix A on ModuleDeclaration (VIP-40): a module declaration is a
// top-level statement, and module stays an identifier everywhere else. In an
// expression, module followed on its line by as, satisfies, is or of and then
// { continues an expression whose operand is the identifier module. The
// parser read it as a module named as and reported EK4003, so opencode's
// packages/core/src/provider.ts, typeof (module as { model?: unknown }).model,
// did not compile (parser:module-as-assertion:EK4003). This compares the
// compiler with itself on two inputs the quote says must agree: renaming the
// binding module to module2 changes no diagnostic. A form the TypeScript twin
// parses without error must also parse without error. A module expression,
// module { } or module name { } in an expression, keeps EK4003 (EK4002 after
// export default), the recovery chapter 1's table names.
const moduleIdentifierQuote = "`module` stays an identifier everywhere else."

func moduleIdentifierChapter(tb testing.TB) {
	if !strings.Contains(SpecText("900-appendices.md"), moduleIdentifierQuote) {
		tb.Fatalf("Appendix A no longer says %q", moduleIdentifierQuote)
	}
}

func TestModuleIdentifierOperatorsQuoted(t *testing.T) { moduleIdentifierChapter(t) }

// moduleIdentifierCase is one keyed input, operator:context:shape:gap; an
// unknown field takes its list's first entry (fuzz RULES.md rule 11).
type moduleIdentifierCase struct{ operator, context, shape, gap string }

var moduleIdentifierFields = [][]string{
	{"as", "satisfies", "is", "of", "name", "nameless"},
	{"member", "typeof-member", "return", "argument", "index", "conditional", "arrow", "nested", "default", "for"},
	{"optional", "empty", "nested"},
	{"space", "comment", "tab"},
}

func parseModuleIdentifierCase(data []byte) moduleIdentifierCase {
	words := strings.Split(string(data), ":")
	values := make([]string, len(moduleIdentifierFields))
	for i, options := range moduleIdentifierFields {
		index := 0
		if i < len(data) {
			index = int(data[i]) % len(options)
		}
		values[i] = options[index]
		if i < len(words) && slices.Contains(options, words[i]) {
			values[i] = words[i]
		}
	}
	c := moduleIdentifierCase{values[0], values[1], values[2], values[3]}
	if c.operator == "of" {
		c.context = "for" // of continues only a for-of head
	}
	return c
}

func (c moduleIdentifierCase) key() string {
	return strings.Join([]string{c.operator, c.context, c.shape, c.gap}, ":")
}

// source is the .vibe text. The identifier module appears nowhere else, so
// renaming every module renames exactly the binding and its uses.
func (c moduleIdentifierCase) source() string {
	gap := map[string]string{"space": " ", "comment": " /* operand */ ", "tab": "\t"}[c.gap]
	typ := map[string]string{"optional": "{ model?: unknown }", "empty": "{}", "nested": "{ model: { id: number } }"}[c.shape]
	pattern := map[string]string{"optional": "{ model: let found }", "empty": "{}", "nested": "{ model: { id: let id } }"}[c.shape]
	object := map[string]string{"optional": "{ model: undefined }", "empty": "{}", "nested": "{ model: { id: 1 } }"}[c.shape]
	var operand string
	switch c.operator {
	case "as", "satisfies":
		operand = "module" + gap + c.operator + " " + typ
	case "is":
		operand = "module" + gap + "is " + pattern
	case "name":
		operand = "module" + gap + "text { export const n = 1 }"
	case "nameless":
		operand = "module" + gap + "{ export const n = 1 }"
	}
	if c.operator == "of" {
		return "export function f(value: unknown) {\n  let module = value\n  for (module" + gap + "of " + object + ") {}\n  return module\n}\n"
	}
	if c.context == "default" {
		return "const module = 1 as unknown\nexport default " + operand + "\n"
	}
	body := map[string]string{
		"member":        "return (" + operand + ").model",
		"typeof-member": "return typeof (" + operand + ").model",
		"return":        "return " + operand,
		"argument":      "return String(" + operand + ")",
		"index":         "return [" + operand + "][0]",
		"conditional":   "return value ? " + operand + " : undefined",
		"arrow":         "return () => " + operand,
		"nested":        "{\n    const module = { value }\n    return (" + operand + ")\n  }",
		"for":           "for (const item of [" + operand + "]) return item\n  return undefined",
	}[c.context]
	return "export function f(value: unknown) {\n  const module = value\n  " + body + "\n}\n"
}

func moduleIdentifierCodes(file *ast.SourceFile) []int32 {
	codes := []int32{}
	for _, d := range file.Diagnostics() {
		codes = append(codes, d.Code())
	}
	slices.Sort(codes)
	return codes
}

func checkModuleIdentifierOperators(t *testing.T, c moduleIdentifierCase) {
	t.Helper()
	const target = "FuzzModuleIdentifierOperators"
	defer recoverCompilerPanic(t, target)
	source := c.source()
	parse := func(name, text string) *ast.SourceFile {
		return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, text, core.ScriptKindTS)
	}
	vibe := moduleIdentifierCodes(parse("/main.vibe", source))
	if c.operator == "name" || c.operator == "nameless" {
		// Chapter 1: a module expression module { … } is EK4003; the
		// parser applies it to a named module in an expression as well, and
		// export default module … is EK4002.
		want := int32(4003)
		if c.context == "default" {
			want = 4002
		}
		if !slices.Contains(vibe, want) {
			Gap(t, target, c.key(), "Appendix A: %s; module expression %q must report EK%d, got %v", moduleIdentifierQuote, source, want, vibe)
		}
		return
	}
	renamed := moduleIdentifierCodes(parse("/main.vibe", strings.ReplaceAll(source, "module", "module2")))
	if !slices.Equal(vibe, renamed) {
		Gap(t, target, c.key(), "Appendix A: %s; renaming module to module2 in %q changed diagnostics %v to %v", moduleIdentifierQuote, source, vibe, renamed)
		return
	}
	if slices.ContainsFunc(vibe, func(code int32) bool { return code >= 4001 && code <= 4009 }) {
		Gap(t, target, c.key(), "Appendix A: %s; identifier module in %q reports a module diagnostic %v", moduleIdentifierQuote, source, vibe)
		return
	}
	if c.operator != "is" && len(moduleIdentifierCodes(parse("/main.ts", source))) == 0 && len(vibe) != 0 {
		Gap(t, target, c.key(), "Appendix A: %s; TypeScript parses %q without error, the .vibe file reports %v", moduleIdentifierQuote, source, vibe)
	}
}

// The opencode witness (provider.ts:558) and its drive variants, the other
// operators, and the module expressions that keep their diagnostics.
var moduleIdentifierSeeds = []string{
	"as:typeof-member:optional:space",
	"as:member:optional:space",
	"as:return:optional:space",
	"as:nested:optional:space",
	"as:argument:empty:comment",
	"as:index:nested:tab",
	"as:conditional:optional:space",
	"as:arrow:nested:space",
	"as:default:optional:space",
	"as:for:empty:space",
	"satisfies:member:optional:space",
	"satisfies:default:nested:comment",
	"is:member:optional:space",
	"is:return:nested:space",
	"is:conditional:empty:tab",
	"of:for:optional:space",
	"of:for:nested:comment",
	"name:member:optional:space",
	"name:default:optional:space",
	"nameless:argument:empty:space",
	"nameless:default:empty:tab",
}

func TestModuleIdentifierOperatorsRegression(t *testing.T) {
	moduleIdentifierChapter(t)
	for _, key := range moduleIdentifierSeeds {
		t.Run(key, func(t *testing.T) { checkModuleIdentifierOperators(t, parseModuleIdentifierCase([]byte(key))) })
	}
}

func FuzzModuleIdentifierOperators(f *testing.F) {
	startShortBudget(f)
	moduleIdentifierChapter(f)
	for _, key := range moduleIdentifierSeeds {
		f.Add([]byte(key))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		checkModuleIdentifierOperators(t, parseModuleIdentifierCase(data))
	})
}
