package vibelang

import (
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// The hovers and completions that stand for those of Effect's language
// service (D246), in .vibe files:
//
//	hover on a layer          Layer: provides `Users`; needs `Db`; fails with `ConnectError`.
//	hover on wire             the order wire builds its layers in, and what each needs
//	"1 se|" for a Duration    "1 second", "1 seconds", … for every unit of Duration.Input
//	Schema.brand("|")         the name of the declaration being branded
//	// @vibelang-diagnostics |  the adjustable codes, each with its categories

func init() {
	ls.RegisterQuickInfoHook(layerQuickInfo)
	ls.RegisterCompletionHook(vibelangTextCompletions)
}

// layerQuickInfo describes the layer node names, or the order of the wire
// call whose callee node is.
func layerQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	if !ast.IsIdentifier(node) || !isVibeLangFile(ast.GetSourceFileOfNode(node)) {
		return "", ""
	}
	if call := node.Parent; call != nil && ast.IsCallExpression(call) && call.Expression() == node && isWireCall(c, call) {
		return "", wireOrderText(c, call)
	}
	provided, errors, needs := layerChannels(c, c.GetTypeAtLocation(node))
	if provided == nil {
		return "", ""
	}
	parts := []string{"provides " + typeList(c, provided, "nothing")}
	parts = append(parts, "needs "+typeList(c, needs, "nothing"))
	if text := typeList(c, errors, ""); text != "" {
		parts = append(parts, "fails with "+text)
	}
	return "", "Layer: " + strings.Join(parts, "; ") + "."
}

// typeList writes t's members in code spans joined by "and", or none when t
// is never or nil.
func typeList(c *checker.Checker, t *checker.Type, none string) string {
	if t == nil || t.Flags()&checker.TypeFlagsNever != 0 {
		return none
	}
	var names []string
	for _, member := range t.Distributed() {
		names = append(names, "`"+c.TypeToString(member)+"`")
	}
	return strings.Join(names, " and ")
}

// wireOrderText lists the order call, a wire call, builds its layers in,
// providers first, with what each provides and which arguments it needs:
// Effect's layer graph, as text.
func wireOrderText(c *checker.Checker, call *ast.Node) string {
	g := graphOfWire(c, call)
	if g.cycle != nil {
		return ""
	}
	lines := []string{"wire builds its layers in this order:"}
	for step, i := range slices.Backward(g.order) {
		argument := g.arguments[i]
		line := strconv.Itoa(len(g.order)-step) + ". `" + wireArgumentText(argument, i) + "`"
		var provides []string
		for _, t := range argument.outputs {
			provides = append(provides, "`"+c.TypeToString(t)+"`")
		}
		if len(provides) > 0 {
			line += " provides " + strings.Join(provides, " and ")
		}
		var from []string
		for _, j := range g.needs[i] {
			from = append(from, "`"+wireArgumentText(g.arguments[j], j)+"`")
		}
		if len(from) > 0 {
			line += ", using " + strings.Join(from, " and ")
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

// wireArgumentText names a, the layer at index i of a wire call, for
// wireOrderText: its source text, with the element index of a spread tuple.
func wireArgumentText(a wireArgument, i int) string {
	text := messageText(a.node, "argument "+strconv.Itoa(i+1))
	if a.index >= 0 {
		text += "[" + strconv.Itoa(a.index) + "]"
	}
	return text
}

// durationUnits are the units of effect's Duration.Input strings.
var durationUnits = []string{"millis", "seconds", "minutes", "hours", "days", "weeks", "micros", "nanos"}

// directiveLine matches a line that ends in an @vibelang-diagnostics comment
// being written: the marker's prefix, or the codes after it.
var directiveLine = regexp.MustCompile(`^\s*//\s*(@[\w-]*)$|^\s*//\s*@vibelang-diagnostics(?:-next-line)?\s+(?:\S+\s+)*(\S*)$`)

// vibelangTextCompletions completes what TypeScript cannot list in a .vibe
// file: an @vibelang-diagnostics comment, a Duration string, and the name in
// Schema.brand.
func vibelangTextCompletions(c *checker.Checker, file *ast.SourceFile, position int) []ls.TextCompletion {
	if !isVibeLangFile(file) {
		return nil
	}
	text := file.Text()
	lineStart := strings.LastIndexAny(text[:position], "\r\n") + 1
	if m := directiveLine.FindStringSubmatch(text[lineStart:position]); m != nil {
		if m[1] != "" {
			start := position - len(m[1])
			return []ls.TextCompletion{
				{Label: directiveMarker, Detail: "Change EK categories from here to the end of the file", Start: start},
				{Label: directiveMarker + directiveNextLine, Detail: "Change EK categories on the next line", Start: start},
			}
		}
		return directiveCompletions(position - len(m[2]))
	}
	token := astnav.GetTokenAtPosition(file, position)
	if token == nil || !ast.IsStringLiteral(token) || position <= nodeStart(file, token) || position >= token.End() {
		return nil
	}
	start, end := nodeStart(file, token)+1, token.End()-1
	if call := token.Parent; call != nil && ast.IsCallExpression(call) && len(call.Arguments()) > 0 && call.Arguments()[0] == token {
		if module, name := effectFunctionOf(c, call.Expression()); module == "Schema" && name == "brand" {
			if declared := declaredName(call); declared != "" {
				return []ls.TextCompletion{{Label: declared, Detail: "The name this brand's declaration has", Start: start, End: end}}
			}
		}
	}
	if !isDurationInput(c, c.GetContextualType(token, checker.ContextFlagsNone)) {
		return nil
	}
	typed := text[start:position]
	amount := strings.TrimRightFunc(typed, func(r rune) bool { return r < '0' || r > '9' })
	amount = strings.TrimSpace(strings.SplitN(amount+" ", " ", 2)[0])
	if _, err := strconv.ParseFloat(amount, 64); err != nil {
		amount = "1"
	}
	var completions []ls.TextCompletion
	for _, unit := range durationUnits {
		if amount == "1" {
			unit = strings.TrimSuffix(unit, "s")
		}
		completions = append(completions, ls.TextCompletion{Label: amount + " " + unit, Detail: "Duration.Input", Start: start, End: end})
	}
	return completions
}

// directiveCompletions lists every adjustable code with each category, for
// the word that starts at start.
func directiveCompletions(start int) []ls.TextCompletion {
	completions := []ls.TextCompletion{{Label: "*:off", Detail: "Every adjustable EK code", Start: start}}
	for _, code := range core.VibeLangAdjustableCodes {
		n, _ := strconv.Atoi(strings.TrimPrefix(code, diagnosticSource))
		m := registry[int32(n)]
		if m == nil {
			continue
		}
		for _, category := range []string{"off", "warning", "error"} {
			completions = append(completions, ls.TextCompletion{Label: code + ":" + category, Detail: m.Text, Start: start})
		}
	}
	return completions
}

// isDurationInput reports whether t, a contextual type, is effect's
// Duration.Input or a union that holds it.
func isDurationInput(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	if alias := t.Alias(); alias != nil && alias.Symbol() != nil && alias.Symbol().Name() == "Input" {
		return slices.ContainsFunc(alias.Symbol().Declarations(), func(d *ast.Node) bool {
			return isEffectModuleFile(c, ast.GetSourceFileOfNode(d), "Duration")
		})
	}
	return t.IsUnion() && slices.ContainsFunc(t.Types(), func(member *checker.Type) bool { return isDurationInput(c, member) })
}

// declaredName returns the name of the variable or schema declaration whose
// initializer holds node, or "".
func declaredName(node *ast.Node) string {
	for n := node.Parent; n != nil && !isFunctionBoundary(n); n = n.Parent {
		if ast.IsVariableDeclaration(n) || ast.IsPropertyDeclaration(n) {
			if name := n.Name(); name != nil && ast.IsIdentifier(name) {
				return name.Text()
			}
			return ""
		}
	}
	return ""
}
