package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Data declarations (D307). The parser writes
//
//	data Delivery { Waiting; Sent { tracking: string } }
//
// as Effect's own Data.TaggedEnum type and Data.taggedEnum constructors
// (parser/vibelang_data.go), so construction, $is, $match, equality and
// hashing are Effect's. What VibeLang adds is checked here:
//
//   - the declaration's rules: at least one variant (EK2122), no variant
//     twice (EK2123), no name Data.taggedEnum reserves (EK2124), only fields in
//     a variant (EK2125), at most four unconstrained type parameters (EK2126),
//     and no comma between variants or fields (EK1013);
//   - Name.Variant naming no variant, in a call, a pattern or anywhere else
//     (EK2127, in place of TypeScript's TS2339);
//   - patterns. A variant pattern, when Delivery.Sent or when Delivery.Sent
//     { let tracking }, is a call of $is whose matcher is the variant's
//     constructor. The checker narrows it by the variant's tag, as
//     when { _tag: "Sent" } narrows (narrowDataVariant), and the lowering
//     writes it as the data type's own guard, Delivery.$is("Sent")(d)
//     (data_lower.go). A field list after anything but a variant, and an
//     extractor's argument list after a variant, are EK4706; a variant that
//     the subject's type has no case of is EK4707.
//
// What makes Name a data type is its value's type, not its declaration:
// Effect's constructors object, with the $is and $match that
// Data.TaggedEnum.Constructor declares, so a data type a .ts file declares
// with Data.taggedEnum matches the same way.

var (
	// EK2122: a data declaration with no variants. {0} is its name.
	EK2122 = message(2122, errorCategory, "data {0} has no variants: a data type lists at least one.")
	// EK2123: a data declaration that declares a variant twice. {0} is its name, {1} the variant.
	EK2123 = message(2123, errorCategory, "data {0} declares the variant {1} twice.")
	// EK2124: a name that Data.taggedEnum reserves: a variant named $is or $match. {0} is the name.
	EK2124 = message(2124, errorCategory, "{0} cannot name a variant: Data.taggedEnum gives every data type its own {0}.")
	// EK2125: a member of a variant that is not a field. {0} is the member.
	EK2125 = message(2125, errorCategory, "{0} is not a field: a variant holds only fields, each written name: Type or name?: Type.")
	// EK2801: a data declaration with more than four type parameters. {0} is its name, {1} the count.
	EK2801 = message(2801, errorCategory, "data {0} has {1} type parameters, and Data.TaggedEnum.WithGenerics passes at most four.")
	EK2126 = message(2126, errorCategory, "{0} cannot have a constraint: Data.TaggedEnum.WithGenerics passes a data type's type parameters unconstrained.")
	// EK2127: Name.Variant names no variant of the data type Name. {0} is the data type, {1} the name, {2} its variants.
	EK2127 = message(2127, errorCategory, "{0} has no variant {1}. Its variants are {2}.")
	// EK4706: a field list after a matcher that is not a data variant. {0} is the matcher.
	EK4706 = message(4706, errorCategory, "{0} is not a variant of a data type, so no field list can follow it; write {0} and { … }.")
	// EK4707: a variant pattern whose subject's type has no case of that variant. {0} is the type, {1} the variant.
	EK4707 = message(4707, errorCategory, "{0} has no case {1}, so this pattern never matches.")

	ek2124Tag        = EK2124.With("_tag cannot name a field: a variant's constructor sets _tag to the variant's name.")
	ek2125Mutable    = EK2125.With("{0} cannot be mutable: Data.TaggedEnum makes every field of a variant readonly.")
	ek2125Untyped    = EK2125.With("{0} has no type: write {0}: Type.")
	ek2126Constraint = EK2126.With("{0} cannot have a constraint: Data.TaggedEnum.WithGenerics passes a data type's type parameters unconstrained.")
	ek4706Extractor  = EK4706.With("{0} is a data variant, and a variant's pattern lists its fields in braces: {0} { let field }.")
	ek1013Variants   = EK1013.With("The variants of {0} are separated by ; or a new line, not by a comma.")
)

func init() {
	for _, m := range []*Message{EK2122, EK2123, EK2124, EK2125, EK2126, EK2801, EK2127, EK4706, EK4707} {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkData)
	checker.RegisterFlowNarrowingHook(narrowDataVariant)
}

// dataReserved are the members of Data.taggedEnum's constructors object
// that are not variants.
var dataReserved = []string{"$is", "$match"}

// isDataConstructors reports whether t is the constructors object of a data
// type: Data.TaggedEnum.Constructor, or, for a generic definition, the object
// type Data.taggedEnum returns, or the intersection with
// Data.TaggedEnum.GenericMatchers that a data declaration writes for it;
// either way, one whose $is Effect's Data module declares.
func isDataConstructors(c *checker.Checker, t *checker.Type) bool {
	if t == nil || t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 || c.GetPropertyOfType(t, "$match") == nil {
		return false
	}
	is := c.GetPropertyOfType(t, "$is")
	if is == nil {
		return false
	}
	for _, declaration := range is.Declarations() {
		if isEffectModuleFile(ast.GetSourceFileOfNode(declaration), "Data") {
			return true
		}
	}
	return false
}

// dataVariants returns the names of the variants of t, a data type's
// constructors object, in the order its type lists them.
func dataVariants(c *checker.Checker, t *checker.Type) []string {
	var names []string
	for _, property := range c.GetPropertiesOfType(t) {
		if name := property.Name(); !slices.Contains(dataReserved, name) {
			names = append(names, name)
		}
	}
	return names
}

// dataVariantOf reports whether matcher, an expression, is a variant of a
// data type, Name.Variant, and returns the variant's tag and the type of its
// values: its constructor's result, with the constructor's type parameters
// erased.
func dataVariantOf(c *checker.Checker, matcher *ast.Node) (tag string, value *checker.Type, ok bool) {
	if matcher == nil || !ast.IsPropertyAccessExpression(matcher) || !ast.IsIdentifier(matcher.Name()) {
		return "", nil, false
	}
	tag = matcher.Name().Text()
	if slices.Contains(dataReserved, tag) {
		return "", nil, false
	}
	constructors := c.TypeOfPatternMatcher(matcher.Expression())
	if !isDataConstructors(c, constructors) {
		return "", nil, false
	}
	property := c.GetPropertyOfType(constructors, tag)
	if property == nil {
		return "", nil, false
	}
	signatures := c.GetSignaturesOfType(c.GetTypeOfSymbol(property), checker.SignatureKindCall)
	if len(signatures) == 0 {
		return "", nil, false
	}
	return tag, c.GetReturnTypeOfSignature(c.GetErasedSignature(signatures[0])), true
}

// isPatternCall reports whether node is a call of helper, $is or $extract,
// that the parser wrote for a pattern: a matcher and a subject.
func isPatternCall(node *ast.Node, helper string) bool {
	return node != nil && ast.IsCallExpression(node) && isSynthesizedName(node.Expression(), helper) && len(node.Arguments()) == 2
}

// dataVariantTest returns the tag that node tests when it is a pattern's
// $is call whose matcher is a data variant, or "".
func dataVariantTest(c *checker.Checker, node *ast.Node) string {
	if !isPatternCall(node, "$is") {
		return ""
	}
	tag, _, _ := dataVariantOf(c, node.Arguments()[0])
	return tag
}

// narrowDataVariant narrows the subject of a variant pattern's $is call by
// the variant's tag, as when { _tag: "Sent" } narrows it: a union keeps the
// members whose tag may be the variant's, or, when the test fails, drops
// those whose tag is. A value of no tagged type, such as unknown, narrows to
// the variant's values, as the data type's own $is("Sent") does.
func narrowDataVariant(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, _ func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	if !isPatternCall(test, "$is") || !c.IsMatchingReference(reference, test.Arguments()[1]) {
		return nil
	}
	tag, value, ok := dataVariantOf(c, test.Arguments()[0])
	if !ok {
		return nil
	}
	return narrowByTag(c, test.Arguments()[0], t, tag, value, assumeTrue)
}

// tagMatch says whether a type's _tag can be a variant's tag.
type tagMatch int

const (
	tagNever  tagMatch = iota // no _tag, or one that excludes the tag
	tagMaybe                  // a _tag that includes the tag among others
	tagAlways                 // the tag itself
)

// tagMatchOf reports whether t, a member of a subject's type, has tag as
// its _tag.
func tagMatchOf(c *checker.Checker, t *checker.Type, tag string) tagMatch {
	if t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		return tagMaybe
	}
	property := c.GetPropertyOfType(c.GetApparentType(t), "_tag")
	if property == nil {
		return tagNever
	}
	propertyType := c.GetTypeOfSymbol(property)
	if propertyType.Flags()&checker.TypeFlagsStringLiteral != 0 {
		if propertyType.AsLiteralType().Value() == tag {
			return tagAlways
		}
		return tagNever
	}
	if c.IsTypeAssignableTo(c.GetStringLiteralType(tag), propertyType) {
		return tagMaybe
	}
	return tagNever
}

type tagNarrowing struct {
	t, value   *checker.Type
	tag        string
	assumeTrue bool
}

type tagNarrowingsKey struct{}

// Bound the union members examined by uncached data-pattern narrowings in
// one function or module body. Cached hits cost no union work. This also
// bounds the intermediate union slices retained by the checker: wide tests
// can retain many unions before reaching TypeScript's flow-depth limit.
const maxTagNarrowingWork = 3 << 20

type tagNarrowings struct {
	types map[tagNarrowing]*checker.Type
	work  map[*ast.Node]int
}

func tagNarrowingsFor(c *checker.Checker) *tagNarrowings {
	return c.ExtensionState(tagNarrowingsKey{}, func() any {
		return &tagNarrowings{types: map[tagNarrowing]*checker.Type{}, work: map[*ast.Node]int{}}
	}).(*tagNarrowings)
}

// narrowByTag narrows t by a test of tag, whose values have the type value.
// Flow analysis narrows each reference to a subject anew through every arm
// before it, and union types are interned, so a match of n arms asks the same
// n narrowings of each of its references. Remembering them keeps the match
// quadratic in its arms rather than cubic.
func narrowByTag(c *checker.Checker, matcher *ast.Node, t *checker.Type, tag string, value *checker.Type, assumeTrue bool) *checker.Type {
	narrowings := tagNarrowingsFor(c)
	key := tagNarrowing{t, value, tag, assumeTrue}
	if narrowed, ok := narrowings.types[key]; ok {
		return narrowed
	}

	// Arrow functions with expression bodies are scopes too.
	scope := ast.FindAncestor(matcher, func(n *ast.Node) bool {
		return ast.IsFunctionLike(n) || ast.IsModuleBlock(n) || ast.IsSourceFile(n)
	})
	work := 1
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		work = len(t.Types())
	}
	used := narrowings.work[scope]
	if used > maxTagNarrowingWork {
		return c.GetErrorType()
	}
	if work > maxTagNarrowingWork-used {
		narrowings.work[scope] = maxTagNarrowingWork + 1
		note(c.AddDiagnostic(ast.NewDiagnostic(ast.GetSourceFileOfNode(matcher), matcher.Loc, diagnostics.The_containing_function_or_module_body_is_too_large_for_control_flow_analysis)), "Data patterns in this body exceed the limit of {0} union members examined by uncached narrowings.", maxTagNarrowingWork)
		return c.GetErrorType()
	}
	narrowings.work[scope] = used + work
	narrowed := narrowTypeByTag(c, t, tag, value, assumeTrue)
	narrowings.types[key] = narrowed
	return narrowed
}

func narrowTypeByTag(c *checker.Checker, t *checker.Type, tag string, value *checker.Type, assumeTrue bool) *checker.Type {
	if t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		if assumeTrue {
			return value
		}
		return t
	}
	if assumeTrue {
		if t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsNonPrimitive) != 0 && c.GetPropertyOfType(c.GetApparentType(t), "_tag") == nil {
			// An object type with no _tag, such as object or {}: the variant's values.
			return c.NarrowTypeTo(t, value, true)
		}
		return c.FilterType(t, func(member *checker.Type) bool { return tagMatchOf(c, member, tag) != tagNever })
	}
	return c.FilterType(t, func(member *checker.Type) bool { return tagMatchOf(c, member, tag) != tagAlways })
}

// checkData checks the data declarations of file and the uses of data types
// in it.
func checkData(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case parser.IsDataDeclaration(node):
			checkDataDeclaration(c, file, node)
		case ast.IsPropertyAccessExpression(node):
			checkDataVariantName(c, node)
		case isPatternCall(node, "$is"):
			checkVariantPattern(c, file, node)
		case isPatternCall(node, "$extract"):
			if _, _, ok := dataVariantOf(c, node.Arguments()[0]); ok {
				matcher := node.Arguments()[0]
				report(c, matcher, ek4706Extractor, scanner.GetTextOfNode(matcher))
				cover(c, matcher)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkDataDeclaration reports what alias, a data declaration's type alias,
// cannot hold.
func checkDataDeclaration(c *checker.Checker, file *ast.SourceFile, alias *ast.Node) {
	name := alias.Name().Text()
	variants := parser.DataVariants(alias)
	if len(variants) == 0 {
		report(c, alias.Name(), EK2122, name)
	}
	seen := map[string]*ast.Node{}
	for _, variant := range variants {
		variantName := variant.Name().Text()
		if first := seen[variantName]; first != nil {
			note(report(c, variant.Name(), EK2123, name, variantName), "Rename one of them, or remove this one.")
			cover(c, variant.Name())
			cover(c, first.Name())
		} else {
			seen[variantName] = variant
		}
		if slices.Contains(dataReserved, variantName) {
			report(c, variant.Name(), EK2124, variantName)
		}
		reportDataComma(c, file, variant, ek1013Variants, "a data declaration")
		fields := variant.Type()
		if fields == nil || fields.Kind != ast.KindTypeLiteral {
			continue
		}
		for _, field := range fields.Members() {
			reportDataComma(c, file, field, EK1013, "a data variant")
			switch {
			case field.Kind != ast.KindPropertySignature:
				report(c, field, EK2125, memberText(file, field))
				cover(c, field)
			case field.Type() == nil:
				report(c, field.Name(), ek2125Untyped, scanner.GetTextOfNode(field.Name()))
				cover(c, field)
			case !hasModifier(field, ast.KindReadonlyKeyword):
				report(c, field.Name(), ek2125Mutable, scanner.GetTextOfNode(field.Name()))
				continue
			case ast.IsIdentifier(field.Name()) && field.Name().Text() == "_tag":
				report(c, field.Name(), ek2124Tag)
			default:
				continue
			}
			// Data.TaggedEnum refuses a variant that may have a _tag field
			// (TS2344 at its type argument): one named so, an index signature,
			// or one of no type. EK2124 or EK2125 explains it.
			coverArgument(c, alias.Type().TypeArguments()[0])
		}
	}
	parameters := alias.TypeParameters()
	for i, parameter := range parameters {
		if i == 4 {
			report(c, parameter, EK2801, name, strconv.Itoa(len(parameters)))
		}
		if constraint := parameter.AsTypeParameterDeclaration().Constraint; constraint != nil {
			report(c, constraint, ek2126Constraint, parameter.Name().Text())
		}
	}
	if definition := dataDefinitionOf(alias); definition != nil {
		// What TypeScript says about the interface, which the parser wrote,
		// EK2126 says about the declaration.
		if len(parameters) > 4 || slices.ContainsFunc(parameters, func(p *ast.Node) bool { return p.AsTypeParameterDeclaration().Constraint != nil }) {
			cover(c, definition)
		}
	}
}

// dataDefinitionOf returns the interface that the parser wrote for the type
// parameters of alias, a generic data declaration's type alias, or nil.
func dataDefinitionOf(alias *ast.Node) *ast.Node {
	if len(alias.TypeParameters()) == 0 || alias.Parent == nil {
		return nil
	}
	var statements []*ast.Node
	switch {
	case ast.IsSourceFile(alias.Parent):
		statements = alias.Parent.AsSourceFile().Statements.Nodes
	case alias.Parent.Kind == ast.KindBlock || alias.Parent.Kind == ast.KindModuleBlock:
		statements = alias.Parent.Statements()
	}
	i := slices.Index(statements, alias)
	for j := i - 1; j >= 0 && j >= i-2; j-- {
		if s := statements[j]; s.Kind == ast.KindInterfaceDeclaration && s.Flags&ast.NodeFlagsReparsed != 0 {
			return s
		}
	}
	return nil
}

// reportDataComma reports m, EK1013, at the comma that ends node, a variant
// or a field, which the parser reads as a separator, as a type literal's
// member's.
func reportDataComma(c *checker.Checker, file *ast.SourceFile, node *ast.Node, m *Message, kind string) {
	end := node.End()
	if end == 0 || end > len(file.Text()) || file.Text()[end-1] != ',' {
		return
	}
	note(reportAt(c, file, core.NewTextRange(end-1, end), m, kind), "Write ; or start a new line, as between the fields of an error.")
}

// memberText returns the first line of member's source text, to name it.
func memberText(file *ast.SourceFile, member *ast.Node) string {
	text := strings.TrimSpace(scanner.GetSourceTextOfNodeFromSourceFile(file, member, false))
	if i := strings.IndexByte(text, '\n'); i >= 0 {
		text = text[:i]
	}
	return strings.TrimRight(text, ";, ")
}

// hasModifier reports whether node has a modifier of kind.
func hasModifier(node *ast.Node, kind ast.Kind) bool {
	modifiers := node.Modifiers()
	return modifiers != nil && slices.ContainsFunc(modifiers.Nodes, func(m *ast.Node) bool { return m.Kind == kind })
}

// dataDeclarationOf returns the type alias of the data declaration that
// expression, a name or a dotted name, refers to, or nil.
func dataDeclarationOf(c *checker.Checker, expression *ast.Node) *ast.Node {
	symbol := c.GetSymbolAtLocation(expression)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return nil
	}
	for _, declaration := range symbol.Declarations() {
		if parser.IsDataDeclaration(declaration) {
			return declaration
		}
	}
	return nil
}

// dataVariantNamed returns the variant of alias, a data declaration's type
// alias, named name, or nil.
func dataVariantNamed(alias *ast.Node, name string) *ast.Node {
	for _, variant := range parser.DataVariants(alias) {
		if variant.Name().Text() == name {
			return variant
		}
	}
	return nil
}

// declaredVariantNames returns the variants of the data type expression
// names, in the order its declaration lists them, or, for a data type a .ts
// file declares, its type's order.
func declaredVariantNames(c *checker.Checker, expression *ast.Node, constructors *checker.Type) []string {
	alias := dataDeclarationOf(c, expression)
	if alias == nil {
		return dataVariants(c, constructors)
	}
	var names []string
	for _, variant := range parser.DataVariants(alias) {
		names = append(names, variant.Name().Text())
	}
	return names
}

// checkDataVariantName reports access, Name.Variant, when Name is a data
// type that has no such variant (EK2127), in place of TypeScript's TS2339.
func checkDataVariantName(c *checker.Checker, access *ast.Node) {
	name := access.Name()
	if !ast.IsIdentifier(name) || c.GetSymbolAtLocation(name) != nil {
		return
	}
	constructors := c.GetTypeAtLocation(access.Expression())
	if !isDataConstructors(c, constructors) || c.GetPropertyOfType(constructors, name.Text()) != nil {
		return
	}
	report(c, name, EK2127, scanner.GetTextOfNode(access.Expression()), name.Text(), joinNames(declaredVariantNames(c, access.Expression(), constructors)))
	cover(c, name)
}

// joinNames lists names as a sentence does: "A", "A and B", "A, B, and C".
func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return "none"
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	}
	return strings.Join(names[:len(names)-1], ", ") + ", and " + names[len(names)-1]
}

// checkVariantPattern checks call, a pattern's $is call: a field list after
// a matcher that is not a data variant is EK4706, and a variant that the
// subject's declared type has no case of is EK4707.
func checkVariantPattern(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	matcher, subject := call.Arguments()[0], call.Arguments()[1]
	tag, _, ok := dataVariantOf(c, matcher)
	if !ok {
		// A pattern's matcher is source text; a field list follows it only in
		// a variant pattern, Name.Variant { … }, since anything else there is
		// a syntax error.
		if after := scanner.SkipTrivia(file.Text(), matcher.End()); after < len(file.Text()) && file.Text()[after] == '{' && !isMissingVariant(c, matcher) {
			report(c, matcher, EK4706, scanner.GetTextOfNode(matcher))
		}
		return
	}
	symbol := c.GetSymbolAtLocation(declaredSubject(c, subject))
	if symbol == nil {
		return
	}
	declared := c.GetTypeOfSymbol(symbol)
	if declared == nil || !isFiniteMatchType(c, declared) {
		return
	}
	members := []*checker.Type{declared}
	if declared.Flags()&checker.TypeFlagsUnion != 0 {
		members = declared.Types()
	}
	for _, member := range members {
		if tagMatchOf(c, member, tag) != tagNever {
			return
		}
	}
	names := dataNamesFor(c, symbol, matcher)
	report(c, matcher, EK4707, names.typeText(c, declared), scanner.GetTextOfNode(matcher))
}

// isMissingVariant reports whether matcher is Name.Variant where Name is a
// data type without that variant, which EK2127 reports.
func isMissingVariant(c *checker.Checker, matcher *ast.Node) bool {
	return ast.IsPropertyAccessExpression(matcher) && isDataConstructors(c, c.GetTypeAtLocation(matcher.Expression()))
}

// dataNames names the data types a subject's type is made of, for
// diagnostics: TypeScript prints a variant's values as their object type, {
// readonly _tag: "Sent"; readonly tracking: string }, which hides the
// declaration they come from.
type dataNames struct {
	declared string            // the subject's declared type as its annotation writes it, or ""
	owners   map[string]string // a variant's tag to its data type's name, when one data type has it
	sizes    map[string]int    // a data type's name to its number of variants
	order    map[string]int    // a variant's tag to its place in its declaration
}

// dataNamesFor finds the data types of symbol, a match's subject: those its
// declaration's type annotation names, or, without one, those in scope at
// location.
func dataNamesFor(c *checker.Checker, symbol *ast.Symbol, location *ast.Node) dataNames {
	names := dataNames{owners: map[string]string{}, sizes: map[string]int{}, order: map[string]int{}}
	counts := map[string]int{}
	add := func(alias *ast.Node) {
		names.sizes[alias.Name().Text()] = len(parser.DataVariants(alias))
		for i, variant := range parser.DataVariants(alias) {
			tag := variant.Name().Text()
			names.order[tag] = i
			counts[tag]++
			names.owners[tag] = alias.Name().Text()
		}
	}
	var annotation *ast.Node
	if declaration := symbol.ValueDeclaration(); declaration != nil && (ast.IsParameterDeclaration(declaration) || ast.IsVariableDeclaration(declaration) || ast.IsPropertyDeclaration(declaration)) {
		annotation = declaration.Type()
	}
	if annotation != nil {
		var visit func(node *ast.Node) bool
		visit = func(node *ast.Node) bool {
			if node.Kind == ast.KindTypeReference {
				if target := c.GetSymbolAtLocation(node.AsTypeReferenceNode().TypeName); target != nil {
					if target.Flags()&ast.SymbolFlagsAlias != 0 {
						target = c.GetAliasedSymbol(target)
					}
					for _, declaration := range target.Declarations() {
						if parser.IsDataDeclaration(declaration) {
							add(declaration)
							names.declared = scanner.GetTextOfNode(annotation)
						}
					}
				}
			}
			return node.ForEachChild(visit)
		}
		visit(annotation)
	} else {
		for _, target := range c.GetSymbolsInScope(location, ast.SymbolFlagsTypeAlias) {
			if target.Flags()&ast.SymbolFlagsAlias != 0 {
				target = c.GetAliasedSymbol(target)
			}
			for _, declaration := range target.Declarations() {
				if parser.IsDataDeclaration(declaration) {
					add(declaration)
				}
			}
		}
	}
	for tag, count := range counts {
		if count > 1 {
			delete(names.owners, tag)
		}
	}
	return names
}

// variantName names t, a member of a subject's type, as a data variant:
// Delivery.Sent, and its data type, Delivery. It returns "" and "" for any
// other type.
func (n dataNames) variantName(c *checker.Checker, t *checker.Type) (variant string, owner string) {
	if t.Flags()&checker.TypeFlagsObject == 0 {
		return "", ""
	}
	property := c.GetPropertyOfType(t, "_tag")
	if property == nil {
		return "", ""
	}
	tagType := c.GetTypeOfSymbol(property)
	if tagType.Flags()&checker.TypeFlagsStringLiteral == 0 {
		return "", ""
	}
	tag, err := strconv.Unquote(c.TypeToString(tagType))
	if owner = n.owners[tag]; err != nil || owner == "" {
		return "", ""
	}
	return owner + "." + tag, owner
}

// members returns the members of t, a union, or t.
func members(t *checker.Type) []*checker.Type {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		return t.Types()
	}
	return []*checker.Type{t}
}

// typeText names t, a subject's declared type: as its annotation writes it,
// as the data type whose every variant it holds, or as the union of its
// members.
func (n dataNames) typeText(c *checker.Checker, t *checker.Type) string {
	if n.declared != "" {
		return n.declared
	}
	all := members(t)
	_, first := n.variantName(c, all[0])
	for _, member := range all {
		if _, owner := n.variantName(c, member); owner == "" || owner != first {
			return n.unionText(c, t)
		}
	}
	if n.sizes[first] == len(all) {
		return first
	}
	return n.unionText(c, t)
}

// unionText names t member by member: Delivery.Sent for a data variant, in
// the order its declaration lists the variants, and what TypeScript prints
// for any other member, after them.
func (n dataNames) unionText(c *checker.Checker, t *checker.Type) string {
	return strings.Join(n.unionTexts(c, t), " | ")
}

// unionTexts preserves declaration order for diagnostics that bound a list.
func (n dataNames) unionTexts(c *checker.Checker, t *checker.Type) []string {
	var variants, others []string
	for _, member := range members(t) {
		if variant, _ := n.variantName(c, member); variant != "" {
			variants = append(variants, variant)
		} else {
			others = append(others, c.TypeToString(member))
		}
	}
	slices.SortStableFunc(variants, func(a, b string) int {
		return n.order[a[strings.LastIndexByte(a, '.')+1:]] - n.order[b[strings.LastIndexByte(b, '.')+1:]]
	})
	return append(variants, others...)
}

// hasVariants reports whether some member of t is a variant these names know.
func (n dataNames) hasVariants(c *checker.Checker, t *checker.Type) bool {
	return slices.ContainsFunc(members(t), func(member *checker.Type) bool {
		variant, _ := n.variantName(c, member)
		return variant != ""
	})
}
