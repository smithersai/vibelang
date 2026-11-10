package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A durable tag is "<package>#<Name>", or a written static readonly key, and
// it is stored: two declarations of one package with one tag would share
// their recorded runs (VIP-55, "The tag is derived from the package and the
// name"). EK5503 reports each.

// EK5503: two task or workflow declarations in one package with one tag. {0} is the tag.
var EK5503 = message(5503, errorCategory, "Another task or workflow in this package has the tag {0}, and a tag names its recorded runs. Rename one, or give it static readonly key.")

func init() {
	registry[EK5503.Code] = EK5503
	fileChecks = append(fileChecks, checkDurableKeys)
}

type durableKeysKey struct{}

// durableKeys maps each package and tag, joined by a NUL, to the
// declarations, the $task or $workflow calls, that derive it.
type durableKeys struct {
	byTag map[string][]*ast.Node
}

// durableTag returns the tag of call, a task or workflow declaration's call
// in file: a written static readonly key, or "<package>#<Name>" (the name
// alone in a package without one). scope is the package the tag is unique in.
func durableTag(c *checker.Checker, file *ast.SourceFile, call *ast.Node) (tag string, scope string) {
	arguments := call.Arguments()
	if len(arguments) < 2 || !ast.IsStringLiteral(arguments[0]) {
		return "", ""
	}
	scope = packageNameOf(c, file)
	tag = arguments[0].Text()
	if scope != "" {
		tag = scope + "#" + tag
	}
	if ast.IsObjectLiteralExpression(arguments[1]) {
		for _, option := range arguments[1].AsObjectLiteralExpression().Properties.Nodes {
			if ast.IsPropertyAssignment(option) && option.Name() != nil && option.Name().Text() == "key" {
				if value := ast.SkipParentheses(option.Initializer()); ast.IsStringLiteralLike(value) {
					tag = value.Text()
				} else {
					return "", "" // a computed key is the program's to keep unique
				}
			}
		}
	}
	return tag, scope
}

func durableKeysFor(c *checker.Checker) *durableKeys {
	return c.ExtensionState(durableKeysKey{}, func() any {
		keys := &durableKeys{byTag: map[string][]*ast.Node{}}
		for _, file := range c.Program().SourceFiles() {
			if !isVibeLangFile(file) || file.IsDeclarationFile {
				continue
			}
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if durableKind(node) != "" {
					if tag, scope := durableTag(c, file, node); tag != "" {
						keys.byTag[scope+"\x00"+tag] = append(keys.byTag[scope+"\x00"+tag], node)
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		}
		return keys
	}).(*durableKeys)
}

// checkDurableKeys reports EK5503 at each declaration of file whose tag
// another declaration of its package derives.
func checkDurableKeys(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if durableKind(node) != "" {
			tag, scope := durableTag(c, file, node)
			if others := durableKeysFor(c).byTag[scope+"\x00"+tag]; tag != "" && len(others) > 1 {
				d := report(c, node.Arguments()[0], EK5503, tag)
				for _, other := range others {
					if other != node {
						note(d, "{0} has the same tag.", position(other.Arguments()[0]))
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
