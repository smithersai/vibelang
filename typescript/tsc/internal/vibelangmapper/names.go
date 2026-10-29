package vibelangmapper

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Names (rule 1 of the projection: lexical bindings and hygienic helper
// names). A projected file imports two kinds of names from the prelude:
//
//   - prelude names the source uses (D4, D48, D146, D151): Effect, Layer,
//     Console, retry, TaggedError, and the rest. A file sees each one that no
//     top-level declaration or import of its own declares, as the fork does;
//     an inner declaration shadows it lexically, in the virtual TypeScript
//     too.
//   - helpers the projection writes ($gen, $run, $service, ...), under an
//     alias no identifier of the file spells, so a helper never collides
//     with a user's name and no user declaration shadows one.
//
// Synthesized text that names a prelude module, such as Layer in a layer
// declaration or Effect in a contract, uses the prelude name itself unless
// some declaration of the file, at any depth, declares that name; then it
// uses a fresh alias, so the synthesized reference cannot resolve to the
// user's declaration.

// preludeNames are the names the prelude module exports for source to use:
// effect's root modules and functions (D146), the unprefixed Effect
// functions (D151), and the runtime's prelude names (D4, D48).
var preludeNames = func() map[string]bool {
	names := map[string]bool{}
	for _, list := range []string{
		// effect's root modules (effect@4.1.0 dist/index.d.ts).
		`Arbitrary Array BigDecimal BigInt Boolean Brand Bytes ByteSize Cache Cause Channel ChannelSchema Chunk Clock Combiner
		Config ConfigProvider Console Context Cron Data DateTime Deferred Differ Duration Effect Effectable Equal
		Equivalence ErrorReporter ExecutionPlan Exit Fiber FiberHandle FiberMap FiberSet FileSystem Filter Formatter
		Function Glob Graph Hash HashMap HashRing HashSet HKT Inspectable Iterable JsonPatch JsonPointer JsonSchema Latch Layer
		LayerMap LayerRef Logger LogLevel ManagedRuntime Match Metric MutableHashMap MutableHashSet MutableList MutableRef
		Newtype NonEmptyIterable Number Optic Option Order Ordering PartitionedSemaphore Path Pipeable PlatformError Pool
		Predicate PrimaryKey PubSub Pull Queue Random RcMap RcRef Record Redactable Redacted Reducer Ref References RegExp
		Request RequestResolver Resource Result Runtime Schedule Scheduler Schema SchemaAST SchemaGetter SchemaIssue
		SchemaParser SchemaRepresentation SchemaTransformation Scope ScopedCache ScopedRef Semaphore SemVer SemVerRange Sink StandardSchema
		Stdio Stream String Struct SubscriptionRef Symbol SynchronizedRef Take Terminal TextDiff Tracer Trie Tuple TxChunk
		TxDeferred TxHashMap TxHashSet TxPriorityQueue TxPubSub TxQueue TxReentrantLock TxRef TxSemaphore
		TxSubscriptionRef Types UndefinedOr Unify Utils Version absurd cast flow hole identity`,
		// D151.
		`all die exit forEach log logDebug logError logInfo logWarning race repeat retry sleep timeout withSpan`,
		// The runtime's prelude names; Experimental is D313's namespace.
		`TaggedError Control pipe wire fork handle resume resumeWith abandon sync callback Resume runPromise runFork
		runSync runCallback detach forkIn interrupt yieldNow uninterruptible restore interruptible customMatcher
		Experimental`,
	} {
		for _, name := range strings.Fields(list) {
			names[name] = true
		}
	}
	return names
}()

// builtinGlobals are ECMAScript and shared web-standard global values (D264). Each keeps its meaning
// in a .vibe file although effect's root exports a module of the same
// name (the fork's isBuiltinGlobal).
var builtinGlobals = map[string]bool{
	"Array": true, "BigInt": true, "Boolean": true, "Function": true, "Number": true, "RegExp": true, "String": true, "Symbol": true,
	"Request": true, "Response": true, "Headers": true, "URL": true, "URLSearchParams": true,
	"TextEncoder": true, "TextDecoder": true, "AbortController": true, "AbortSignal": true,
	"Blob": true, "FormData": true, "structuredClone": true, "fetch": true,
}

// typeOnlyPrelude are prelude exports with no value, imported with `type`
// so a project with verbatimModuleSyntax accepts the import.
var typeOnlyPrelude = map[string]bool{"Resume": true, "$Infer": true, "$TagMatch": true, "$PreludeLoaded": true}

// names holds one file's bindings and the prelude imports its projection needs.
type names struct {
	// words are the identifier-like words of the text, comments and strings
	// included: a helper alias is never one of them.
	words map[string]bool
	// declared are the names some declaration of the file declares, at any
	// depth; declarations counts the declarations of each.
	declared     map[string]bool
	declarations map[string]int
	// topLevel are the names a top-level declaration or import declares.
	topLevel map[string]bool
	// importedFrom maps each name a top-level import declares to its module specifier.
	importedFrom map[string]string
	// imports maps each imported prelude export to its local name.
	imports map[string]string
}

// newNames reads file's bindings and the prelude names its source uses.
func newNames(file *ast.SourceFile, text string) *names {
	n := &names{words: wordsOf(text), declared: map[string]bool{}, declarations: map[string]int{}, topLevel: map[string]bool{}, importedFrom: map[string]string{}, imports: map[string]string{}}
	for _, statement := range file.Statements.Nodes {
		forEachTopLevelName(statement, func(name string) {
			n.topLevel[name] = true
			if statement.Kind == ast.KindImportDeclaration {
				if specifier := statement.AsImportDeclaration().ModuleSpecifier; ast.IsStringLiteral(specifier) {
					n.importedFrom[name] = specifier.Text()
				}
			}
		})
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindIdentifier && node.Flags&ast.NodeFlagsReparsed == 0 {
			name := node.Text()
			switch {
			case isMemberName(node):
			case ast.IsDeclarationName(node) && node.Parent.Kind != ast.KindShorthandPropertyAssignment:
				n.declared[name] = true
				n.declarations[name]++
			case preludeNames[name] && !builtinGlobals[name] && !n.topLevel[name]:
				n.imports[name] = name
			}
		}
		node.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return n
}

// isMemberName reports whether id names a member, not a binding: a property
// of an access or a qualified name, or a member of an object, a class, an
// interface, or an enum.
func isMemberName(id *ast.Node) bool {
	parent := id.Parent
	switch parent.Kind {
	case ast.KindPropertyAccessExpression, ast.KindQualifiedName:
		return parent.Name() == id
	case ast.KindPropertyAssignment, ast.KindMethodDeclaration, ast.KindPropertyDeclaration, ast.KindPropertySignature,
		ast.KindMethodSignature, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindEnumMember:
		return parent.Name() == id
	}
	return false
}

// wordsOf returns every maximal run of identifier characters in text.
func wordsOf(text string) map[string]bool {
	words := map[string]bool{}
	start := -1
	for i := 0; i <= len(text); i++ {
		identifier := i < len(text) && (text[i] == '_' || text[i] == '$' || text[i] >= '0' && text[i] <= '9' ||
			text[i] >= 'a' && text[i] <= 'z' || text[i] >= 'A' && text[i] <= 'Z' || text[i] >= 0x80)
		switch {
		case identifier && start < 0:
			start = i
		case !identifier && start >= 0:
			words[text[start:i]] = true
			start = -1
		}
	}
	return words
}

// fresh returns name, or name with the first numeric suffix, that is no word
// of the text and no local name already chosen.
func (n *names) fresh(name string) string {
	taken := func(candidate string) bool {
		if n.words[candidate] {
			return true
		}
		for export, local := range n.imports {
			if local == candidate && export != name {
				return true
			}
		}
		return false
	}
	if !taken(name) {
		return name
	}
	for i := 1; ; i++ {
		if candidate := name + "_" + strconv.Itoa(i); !taken(candidate) {
			return candidate
		}
	}
}

// helper returns the local name of a projection helper, a prelude export
// that starts with $, and records its import.
func (n *names) helper(name string) string {
	if local, ok := n.imports[name]; ok {
		return local
	}
	local := n.fresh(name)
	n.imports[name] = local
	return local
}

// prelude returns the name synthesized text uses for the prelude export
// name: the name itself when no declaration of the file declares it, else a
// fresh alias.
func (n *names) prelude(name string) string {
	if !n.declared[name] && !n.topLevel[name] {
		n.imports[name] = name
		return name
	}
	key := "\x00" + name // the aliased import, apart from a free use of name
	if local, ok := n.imports[key]; ok {
		return local
	}
	local := n.fresh(name)
	n.imports[key] = local
	return local
}

// preludeTypes are the prelude names that are both one of effect's modules
// and a type (D4, D48): Effect<A, E, R> and Scope.
var preludeTypes = map[string]bool{"Effect": true, "Scope": true}

// shadowsPreludeType reports whether a type reference to name, one of
// preludeTypes, means the prelude's type although the file binds name: its
// only declaration imports effect's module of that name, a namespace with
// no type, so the fork resolves the type to the prelude's.
func (n *names) shadowsPreludeType(name string) bool {
	from, ok := n.importedFrom[name]
	return preludeTypes[name] && ok && (from == "effect" || strings.HasPrefix(from, "effect/")) && n.declarations[name] == 1
}

// importLine returns the projected file's first line: the prelude import and
// the sentinel that fails at line 1 when the prelude's own imports do not
// resolve (prelude.d.ts, $PreludeLoaded). Names are sorted, so the line is
// deterministic.
func (n *names) importLine() string {
	loaded := n.helper("$PreludeLoaded")
	var specifiers []string
	for export, local := range n.imports {
		export = strings.TrimPrefix(export, "\x00")
		specifier := export
		if local != export {
			specifier += " as " + local
		}
		if typeOnlyPrelude[export] {
			specifier = "type " + specifier
		}
		specifiers = append(specifiers, specifier)
	}
	slices.SortFunc(specifiers, func(a, b string) int {
		return strings.Compare(strings.TrimPrefix(a, "type "), strings.TrimPrefix(b, "type "))
	})
	return "import { " + strings.Join(specifiers, ", ") + ` } from "` + PreludeModule + `"; true satisfies ` + loaded + ";\n"
}

// forEachTopLevelName calls fn with each name that statement, a statement at
// a module's top level, declares or imports.
func forEachTopLevelName(statement *ast.Node, fn func(name string)) {
	named := func(node *ast.Node) {
		if node != nil && node.Kind == ast.KindIdentifier {
			fn(node.Text())
		}
	}
	switch statement.Kind {
	case ast.KindImportDeclaration:
		clause := statement.AsImportDeclaration().ImportClause
		if clause == nil {
			return
		}
		named(clause.Name())
		switch bindings := clause.AsImportClause().NamedBindings; {
		case bindings == nil:
		case bindings.Kind == ast.KindNamespaceImport:
			named(bindings.Name())
		case bindings.Kind == ast.KindNamedImports:
			for _, element := range bindings.AsNamedImports().Elements.Nodes {
				named(element.Name())
			}
		}
	case ast.KindImportEqualsDeclaration:
		named(statement.Name())
	case ast.KindVariableStatement:
		for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			forEachBindingName(declaration.Name(), fn)
		}
	case ast.KindFunctionDeclaration, ast.KindClassDeclaration, ast.KindInterfaceDeclaration,
		ast.KindTypeAliasDeclaration, ast.KindEnumDeclaration, ast.KindModuleDeclaration:
		named(statement.Name())
	}
}

// forEachBindingName calls fn with each identifier a binding name declares.
func forEachBindingName(name *ast.Node, fn func(name string)) {
	switch {
	case name == nil:
	case name.Kind == ast.KindIdentifier:
		fn(name.Text())
	case ast.IsBindingPattern(name):
		for _, element := range name.Elements() {
			if element.Kind == ast.KindBindingElement {
				forEachBindingName(element.Name(), fn)
			}
		}
	}
}
