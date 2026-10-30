package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

const retainedErrorMigrationLabel = "retained error class matching"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, retainedErrorMigrationFixes)
}

// Detail 92 requires module guards for nested Effect errors. Keep legacy bare
// tests on the original constructor, and make legacy extraction an explicit
// call-only matcher. Detail 100 rejects ordinary-class extractor patterns, so
// merely aliasing the constructor cannot be a preserving migration.
func retainedErrorMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	key := "retained-error-class:" + file.Text()
	if refused[key] {
		return result
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()

	type group struct {
		statement  *ast.Node
		aliases    map[string]string
		extractors map[string]string
		prefix     string
		edits      []sourceEdit
	}
	groups := map[*ast.Node]*group{}
	var order []*group
	occupied := file.Text()
	matcherKey := freshSchemaFlagName(occupied, "$legacyMatcherKey")
	occupied += " " + matcherKey
	needsKey := false
	seen := map[int]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		extract := isPatternCall(node, "$extract")
		if !isPatternCall(node, "$is") && !extract {
			return node.ForEachChild(visit)
		}
		matcher := node.Arguments()[0]
		if !ast.IsPropertyAccessExpression(matcher) {
			return node.ForEachChild(visit)
		}
		module := effectModuleNamed(c, matcher.Expression())
		if !strings.Contains(module, "/") || fixedErrorGuards[module][matcher.Name().Text()] == "" {
			return node.ForEachChild(visit)
		}
		start, end := nodeStart(file, matcher), matcher.End()
		if start < 0 || end > len(file.Text()) || start >= end || seen[start] {
			return false
		}
		seen[start] = true
		statement := matcher
		for statement.Parent != nil && statement.Parent.Kind != ast.KindSourceFile && statement.Parent.Kind != ast.KindModuleBlock {
			statement = statement.Parent
		}
		if statement.Parent == nil {
			return false
		}
		g := groups[statement]
		if g == nil {
			g = &group{statement: statement, aliases: map[string]string{}, extractors: map[string]string{}}
			groups[statement] = g
			order = append(order, g)
		}
		text := file.Text()[start:end]
		alias := g.aliases[text]
		if alias == "" {
			alias = freshSchemaFlagName(occupied, "$legacyError")
			occupied += " " + alias
			g.aliases[text] = alias
			g.prefix += "const " + alias + " = " + text + ";\n"
		}
		replacement := alias
		if extract {
			replacement = g.extractors[text]
			if replacement == "" {
				replacement = freshSchemaFlagName(occupied, "$legacyExtract")
				occupied += " " + replacement
				g.extractors[text] = replacement
				needsKey = true
				// Read the matcher's property at each test, keep its original receiver and
				// hint, and let the normal call-only extraction path validate its result.
				// The fallback is explicit, so retirement of runtime class extraction
				// cannot change the upgraded program. No constructor is mutated.
				// Accept the full runtime hint so extraction selects its typed overload.
				// Keep the SDK instance type in inferred public return declarations.
				g.prefix += "const " + replacement + " = (subject: unknown, hint: { matchType: \"boolean\" | \"extractor\" }): readonly [" + text + "] | false => {\n" +
					"const custom = (" + alias + " as unknown as { readonly [key: symbol]: unknown })[" + matcherKey + "];\n" +
					"if (typeof custom === \"function\") return custom.call(" + alias + ", subject, hint);\n" +
					"return subject instanceof " + alias + " ? [subject] : false;\n};\n"
			}
		}
		g.edits = append(g.edits, sourceEdit{start, end, replacement})
		return false
	}
	file.AsNode().ForEachChild(visit)
	var edits []sourceEdit
	for _, g := range order {
		edits = append(edits, sourceEdit{g.statement.Pos(), g.statement.Pos(), "\n" + g.prefix})
		edits = append(edits, g.edits...)
	}
	if len(edits) == 0 {
		return result
	}
	if needsKey {
		pos := 0
		text := file.Text()
		if strings.HasPrefix(text, "\ufeff") {
			pos = 3
		}
		if strings.HasPrefix(text[pos:], "#!") {
			if i := strings.IndexByte(text[pos:], '\n'); i >= 0 {
				pos += i + 1
			}
		}
		for _, node := range file.Statements.Nodes {
			if !ast.IsPrologueDirective(node) {
				break
			}
			pos = node.End()
		}
		statement := "import { customMatcher as " + matcherKey + " } from \"vibelang-runtime\";\n"
		if pos > 0 && text[pos-1] != '\n' && text[pos-1] != '\r' {
			statement = "\n" + statement
		}
		edits = append(edits, sourceEdit{pos, pos, statement})
	}
	// The shared import and its uses are one atomic proposal.
	result.fixes = append(result.fixes, fileFix{label: retainedErrorMigrationLabel, key: key, edits: edits})
	return result
}
