package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Coverage credit for class arms (D407, D427, D428). A class arm, `when
// NotFound:`, tests `instanceof` (D213), which the parser writes as
// $is(NotFound, $match1). TypeScript narrows the subject by the test as by
// an instanceof, removing NotFound where the arm fails, which counts the arm
// toward exhaustiveness (D346). That is sound only when the test is
// guaranteed to accept every value of the class's type, so a class arm
// removes its class only when the class is closed and its package resolves
// to one installed copy:
//
//   - A closed class is an error class: an error declaration, or any class,
//     in a .vibe, .ts, or declaration file, whose instance type extends the
//     pinned effect's YieldableError, as Data.TaggedError, Data.Error, Schema
//     error classes, and effect's own error classes do, where neither the
//     class nor a class it extends declares its own static
//     [Symbol.hasInstance] or [customMatcher] (D501). TypeScript's types are
//     structural, so a value of a same-shaped class of another declaration
//     can reach the match; it fails every arm's instanceof (D405) and reaches
//     the match's end as a defect, never another arm.
//   - TypeScript gives two installed copies of one package version one type,
//     while the run time loads two classes, so where module resolution
//     merged a second copy of the class's package, the arm removes nothing
//     (D427).
//
// Any other class arm, such as one over Error or a class that is not an
// error class, or a class with its own membership test, removes nothing, as a guarded arm
// does (D428), and a match that needs it to cover its subject is EK4701,
// whose notes say why the arm did not count. The primitive classes test
// typeof, which accepts every value of their type, so their arms count.

func init() { checker.RegisterFlowNarrowingHook(narrowOpenClassArm) }

// narrowOpenClassArm is the checker's flow narrowing hook for a class arm of
// a match: where the arm fails, it leaves reference, the subject or a part of
// it the arm tests, as it was when the arm does not count toward coverage.
func narrowOpenClassArm(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, narrowAlias func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	if assumeTrue {
		return nil
	}
	matcher, subject := classArmTest(test)
	if matcher == nil || !c.IsMatchingReference(reference, subject) {
		return nil
	}
	if classArmCreditOf(c, matcher).counts {
		return nil
	}
	return t
}

// classArmTest returns the matcher and the subject of test when it is the
// test $is(matcher, subject) that the parser writes for an arm of a match,
// whose subject reads the match's capture, $match1 or a property of it.
func classArmTest(test *ast.Node) (matcher, subject *ast.Node) {
	if test == nil || !ast.IsCallExpression(test) || !isSynthesizedName(test.Expression(), "$is") || len(test.Arguments()) != 2 {
		return nil, nil
	}
	subject = test.Arguments()[1]
	root := subject
	for ast.IsAccessExpression(root) {
		root = root.Expression()
	}
	if !ast.IsIdentifier(root) || root.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(root.Text(), "$match") {
		return nil, nil
	}
	return test.Arguments()[0], subject
}

// classArmCredit says whether a class arm removes its class from the
// subject, and why not when it does not.
type classArmCredit struct {
	counts bool
	why    string // a note for EK4701 when the arm does not count
}

// classArmCreditOf returns the credit of an arm whose matcher is matcher. A
// matcher that is not a class, such as a value or a predicate, keeps
// TypeScript's narrowing.
func classArmCreditOf(c *checker.Checker, matcher *ast.Node) classArmCredit {
	constructor := c.TypeOfPatternMatcher(matcher)
	if constructor == nil || len(c.GetConstructSignatures(constructor)) == 0 {
		return classArmCredit{counts: true}
	}
	symbol := c.GetSymbolAtLocation(matcher)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || symbol.ValueDeclaration() == nil {
		return classArmCredit{why: "{0} is not a closed class, so a value of its type need not pass its instanceof test, and its arm removes nothing."}
	}
	// Flow analysis asks at every reference to the subject after the arm.
	state := closedClassStateOf(c)
	if credit, ok := state.credits[symbol]; ok {
		return credit
	}
	credit := classCreditOf(c, symbol, constructor)
	state.credits[symbol] = credit
	return credit
}

// closedClassState is what one checker remembers about class arms.
type closedClassState struct {
	credits       map[*ast.Symbol]classArmCredit // classes, and the credit an arm over each gets
	customMatcher *string                        // the property name of the runtime's customMatcher, once found
}

type closedClassStateKey struct{}

func closedClassStateOf(c *checker.Checker) *closedClassState {
	return c.ExtensionState(closedClassStateKey{}, func() any {
		return &closedClassState{credits: map[*ast.Symbol]classArmCredit{}}
	}).(*closedClassState)
}

// classCreditOf returns the credit of an arm over the class that symbol
// declares, whose static side is constructor.
func classCreditOf(c *checker.Checker, symbol *ast.Symbol, constructor *checker.Type) classArmCredit {
	if isPrimitiveClass(c, symbol) {
		return classArmCredit{counts: true} // its test is typeof (D213)
	}
	if why := openClassReason(c, symbol); why != "" {
		return classArmCredit{why: why}
	}
	if declaresOwnMatcher(c, constructor) {
		return classArmCredit{why: "{0} or a class it extends declares its own [Symbol.hasInstance] or [customMatcher], which may reject a value of its type, so its arm removes nothing."}
	}
	if copy := secondCopyOf(c, symbol); copy != "" {
		return classArmCredit{why: "{0}'s package is installed twice, and module resolution merged the copy at " + copy + " with it: TypeScript gives both copies one type, but the run time loads two classes, so its arm removes nothing."}
	}
	return classArmCredit{counts: true}
}

// isPrimitiveClass reports whether symbol is one of JavaScript's primitive
// classes, whose pattern tests typeof.
func isPrimitiveClass(c *checker.Checker, symbol *ast.Symbol) bool {
	switch symbol.Name() {
	case "String", "Number", "Boolean", "BigInt", "Symbol":
		return isGlobal(c, symbol)
	}
	return false
}

// openClassReason returns why the class that symbol declares is not closed,
// as a note for EK4701, or "" when it may be: an error declaration, or a
// class whose instance type extends effect's YieldableError, wherever it is
// declared (D407, D501).
func openClassReason(c *checker.Checker, symbol *ast.Symbol) string {
	const open = " so a value of its type need not pass its instanceof test, and its arm removes nothing."
	declaration := symbol.ValueDeclaration()
	file := ast.GetSourceFileOfNode(declaration)
	if file != nil && isVibeLangFile(file) {
		if form, _ := errorFormOf(declaration); form != errorFormNone {
			return ""
		}
	}
	if file == nil || c.Program().IsSourceFileDefaultLibrary(file.PathKey()) {
		// JavaScript's library, Error included.
		return "{0} is not an error class of effect," + open
	}
	if extendsYieldableError(c, c.GetDeclaredTypeOfSymbol(symbol), 0) {
		return ""
	}
	return "{0} does not extend effect's error base, YieldableError," + open
}

// extendsYieldableError reports whether t, the instance type of a class or
// interface of effect, extends effect's YieldableError, through its bases
// and the members of an intersection a base constructor returns.
func extendsYieldableError(c *checker.Checker, t *checker.Type, depth int) bool {
	if t == nil || depth > 8 {
		return false
	}
	yieldable := servicesFor(c).effectExport("Cause", "YieldableError")
	if yieldable == nil {
		return false
	}
	if t.Flags()&checker.TypeFlagsIntersection != 0 {
		for _, member := range t.Types() {
			if extendsYieldableError(c, member, depth+1) {
				return true
			}
		}
		return false
	}
	if t.Flags()&checker.TypeFlagsObject == 0 {
		return false
	}
	if symbol := t.Symbol(); symbol != nil && c.GetMergedSymbol(symbol) == c.GetMergedSymbol(yieldable) {
		return true
	}
	if t.ObjectFlags()&checker.ObjectFlagsReference != 0 && t.Target() != nil && t.Target() != t {
		return extendsYieldableError(c, t.Target(), depth+1)
	}
	for _, base := range c.GetBaseTypes(t) {
		if extendsYieldableError(c, base, depth+1) {
			return true
		}
	}
	return false
}

// declaresOwnMatcher reports whether constructor, a class's static side,
// declares a membership test of its own: a static [Symbol.hasInstance] or
// [customMatcher] that it or a class it extends declares.
func declaresOwnMatcher(c *checker.Checker, constructor *checker.Type) bool {
	names := []string{c.GetPropertyNameForKnownSymbolName("hasInstance")}
	if name := customMatcherPropertyName(c); name != "" {
		names = append(names, name)
	}
	for _, name := range names {
		property := c.GetPropertyOfType(constructor, name)
		if property == nil {
			continue
		}
		for _, declaration := range property.Declarations() {
			if declaration.Parent != nil && ast.IsClassLike(declaration.Parent) {
				return true
			}
		}
	}
	for _, property := range c.GetPropertiesOfType(constructor) {
		// A computed name the checker could not name, such as an import of
		// customMatcher under another name, still declares one.
		for _, declaration := range property.Declarations() {
			if name := declaration.Name(); name != nil && ast.IsComputedPropertyName(name) && declaration.Parent != nil && ast.IsClassLike(declaration.Parent) {
				switch text := entityText(name.Expression()); text {
				case "Symbol.hasInstance", "customMatcher", "Symbol.customMatcher":
					return true
				}
			}
		}
	}
	return false
}

// customMatcherPropertyName returns the property name of the runtime's
// customMatcher symbol, or "" when no file of the program resolves the
// runtime.
func customMatcherPropertyName(c *checker.Checker) string {
	cached := closedClassStateOf(c)
	if cached.customMatcher != nil {
		return *cached.customMatcher
	}
	name := findCustomMatcherPropertyName(c)
	cached.customMatcher = &name
	return name
}

func findCustomMatcherPropertyName(c *checker.Checker) string {
	state := preludeStateOf(c)
	for _, file := range c.Program().SourceFiles() {
		if !isVibeLangFile(file) {
			continue
		}
		module := runtimeModuleSymbol(c, state, file)
		if module == nil {
			continue
		}
		symbol := c.TryGetMemberInModuleExports("customMatcher", module)
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol == nil {
			return ""
		}
		name, _ := checker.PropertyNameOfType(c.GetTypeOfSymbol(symbol))
		return name
	}
	return ""
}

// secondCopyOf returns the path of a second installed copy of the package
// that declares symbol, which module resolution found and TypeScript merged
// with the first (D427), or "".
func secondCopyOf(c *checker.Checker, symbol *ast.Symbol) string {
	program, ok := c.Program().(interface {
		GetRedirectTargets(path tspath.PathKey) []tspath.RootedFilePath
	})
	if !ok {
		return ""
	}
	for _, declaration := range symbol.Declarations() {
		if file := ast.GetSourceFileOfNode(declaration); file != nil {
			if copies := program.GetRedirectTargets(file.PathKey()); len(copies) > 0 {
				return string(copies[0])
			}
		}
	}
	return ""
}

// uncountedArmNotes returns, for the $noMatch call that ends a match, a note
// for each class arm of the match that does not count toward its coverage,
// once per class, in arm order.
func uncountedArmNotes(c *checker.Checker, file *ast.SourceFile, call *ast.Node) []string {
	subject := call.Arguments()[0]
	if !ast.IsIdentifier(subject) {
		return nil
	}
	statement := call.Parent
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if statement == nil || statement.Parent == nil || !ast.IsBlock(statement.Parent) {
		return nil
	}
	var notes []string
	seen := map[string]bool{}
	for _, arm := range statement.Parent.AsBlock().Statements.Nodes {
		if arm == statement {
			break
		}
		var visit func(node *ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsFunctionLike(node) {
				return false
			}
			if matcher, tested := classArmTest(node); matcher != nil {
				root := tested
				for ast.IsAccessExpression(root) {
					root = root.Expression()
				}
				if root.Text() == subject.Text() {
					text := nodeText(file, matcher)
					if credit := classArmCreditOf(c, matcher); !credit.counts && !seen[text] {
						seen[text] = true
						notes = append(notes, strings.ReplaceAll(credit.why, "{0}", text))
					}
				}
			}
			return node.ForEachChild(visit)
		}
		visit(arm)
	}
	return notes
}
