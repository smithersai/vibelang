package vibelang

import (
	"fmt"
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

// VibeLang diagnostics are TypeScript diagnostics whose Source is "EK",
// so tsc prints them as `error EK0103: …` and the language server publishes
// them with source "EK" and the code as a number. They are reported while the
// checker checks a file, so `vibelang`, `vibelang --noEmit`, the language server, and
// `vibelang --api` all see them, and @ts-ignore and @ts-expect-error do not apply
// to them.
//
// Report a diagnostic from a file check (see fileChecks) with report, add the
// lines under it with note, and hide TypeScript's own diagnostics that it
// explains with cover.

// diagnosticSource is the prefix of every EK code.
const diagnosticSource = "EK"

// A Message is the text of one VibeLang diagnostic. In Text, {0}, {1}, …
// stand for the arguments that report substitutes.
type Message struct {
	Code     int32
	Category diagnostics.Category // the default; compilerOptions.vibelang may change it
	Text     string
	Off      bool // off unless compilerOptions.vibelang or a comment turns it on, in Category
}

// String returns the code as the spec writes it, for example "EK0103".
func (m *Message) String() string {
	return fmt.Sprintf("%s%04d", diagnosticSource, m.Code)
}

// With returns a message with m's code and category and a different text,
// for a situation that the registry's text does not fit.
func (m *Message) With(text string) *Message {
	return &Message{Code: m.Code, Category: m.Category, Text: text, Off: m.Off}
}

func message(code int32, category diagnostics.Category, text string) *Message {
	return &Message{Code: code, Category: category, Text: text}
}

const (
	errorCategory   = diagnostics.CategoryError
	warningCategory = diagnostics.CategoryWarning
)

// The registry includes Appendix B's VIP identifiers and legacy diagnostics
// pending retirement by their owning VIP implementations. appendix_codes.go
// reserves rules whose behavior is not implemented yet; registration never
// enables a check. See the user diagnostic-code map for renumbered identifiers.
var (
	// EK0108: an Effect modifier in a forbidden native async-modifier position (VIP-1).
	EK0108 = message(108, errorCategory, "The effect modifier cannot appear on an abstract or ambient declaration or a type member. Remove effect, or write its implementation as a non-abstract function or method.")

	// EK1001: a module's top level runs a program. {0} is the call, such as "loadConfig()".
	EK1001 = message(1001, errorCategory, "{0} runs a program, but a module's top level is not inside one.")
	// EK1002: a generator-based API such as Effect.gen, where function* declares a producer. {0} is the API.
	EK1002 = message(1002, errorCategory, "{0} expects a JavaScript generator, but in VibeLang function* declares a producer.")
	// EK1003: for await or await using outside an async function. {0} is the keyword.
	EK1003 = message(1003, errorCategory, "{0} is not part of VibeLang: a call already waits.")
	// EK1005: a runner inside code that a fiber runs. {0} is the runner, {1} the function.
	EK1005 = message(1005, errorCategory, "{0} starts a new root fiber, but {1} already runs on one.")
	// EK1006: a pipe whose body never uses its topic.
	EK1006 = message(1006, errorCategory, "This pipe's body does not use its topic, %, so the value before |> would go nowhere.")
	// EK1007: % outside every pipe's body.
	EK1007 = message(1007, errorCategory, "% is the topic of a pipe and stands only in a pipe's body, after |>.")
	// EK1008: a pipe that passes its left side by name and also uses it as a value. {0} is the left side.
	EK1008 = message(1008, errorCategory, "% stands for {0}, which this pipe passes by name to a program elsewhere, so it cannot also be a value here.")

	// EK1010: an unparenthesized throw expression before an operator. {0} is its unary operand.
	EK1010 = message(1010, errorCategory, "throw takes only {0} here, so the rest of the expression would not be thrown; write throw (…) to throw the whole expression.")
	// EK1011: a function compiles to an Effect in a program without effect's Effect type. {0} is the function.
	EK1011 = message(1011, errorCategory, "{0} compiles to an Effect, but this program cannot find effect's Effect type.")
	// EK1012: a call that runs and never succeeds is stored. {0} is the call, {1} what stores it. A warning a project may adjust (D241).
	EK1012 = message(1012, warningCategory, "{0} runs here and never succeeds, so {1} never holds a value.")
	// EK1022: a next-line block could be mistaken for the previous statement's block param (D376).
	EK1022 = message(1022, errorCategory, parser.VibeLangNextLineBlockMessage)
	// EK1023: a legacy decision would silently change meaning (D382). Not adjustable.
	EK1023 = message(1023, errorCategory, "pipe now passes its first argument as the value it is, but through VibeLang 0.0.10 this pipe passed it as a program.")
	// EK9201: an expected failure escapes the written contract. {0} is the failure, {1} the function, {2} what the contract allows.
	EK9201 = message(9201, errorCategory, "{0} can escape {1}, but {2}.")
	// EK9202: a requirement escapes the written contract. {0} is the function, {1} the requirement, {2} the contract's R.
	EK9202 = message(9202, errorCategory, "{0} needs {1}, but its contract says R = {2}.")
	// EK9203: a plain return annotation on a function whose body runs an Effect (D67) or can fail (D282). {0} is the function, {1} the annotation.
	// plain_failures.go names the call or the throw when it can.
	EK9203 = message(9203, errorCategory, "{0} can't run Effects: its return annotation, {1}, makes it a plain function, which runs no Effects.")
	// EK9204: an Effect try block with E = never; defects pass through.
	EK9204 = message(9204, warningCategory, "This try block runs Effects but has no expected errors; defects pass through this catch.")
	// EK2005: a resumeWith program that needs a service or fails outside the operation's contract. {0} is what it needs.
	EK2005 = message(2005, errorCategory, "resumeWith runs this code at the perform site, inside the handled program, where the clause's providers are not in scope. It needs {0}.")
	// EK2006: a return, break, or continue that leaves a finally block of effect code. {0} is the statement's keyword.
	EK2006 = message(2006, errorCategory, "{0} leaves a finally block, which would discard a failure in flight.")
	// EK9205: a declaration without a body whose return type is not an Effect type. {0} is the declaration.
	EK9205 = message(9205, errorCategory, "{0} has no body to infer from, so its contract must be written as an Effect type.")
	// EK9207: a member of a service or control declaration with a body or an initializer. {0} is the member, {1} the word.
	EK9207 = message(9207, errorCategory, "{0} has an implementation, but a {1} declares only contracts.")
	// EK2104: a setup statement of a layer declaration that follows one of its members.
	EK2104 = message(2104, errorCategory, "This statement follows the layer's members, but a layer's setup statements come first.")
	// EK2105: a typed catch clause whose type has a member without a literal _tag. {0} is the clause's type, {1} the member.
	EK2105 = message(2105, errorCategory, "catch (…: {0}) matches failures by _tag, but {1} has no literal _tag.")
	// EK2106: a catch clause after one that catches every failure (an untyped clause or a Cause clause).
	EK2106 = message(2106, errorCategory, "This catch clause can never run: an earlier catch clause catches every failure.")
	// EK2107: a handle clause whose control is not a control declaration. {0} is the control.
	EK2107 = message(2107, errorCategory, "{0} is not a control: a handle clause answers an operation that a control declares.")
	// EK2108: a control's operation without a clause in a handle statement. {0} lists the operations, {1} is the control.
	EK2108 = message(2108, errorCategory, "{0} has no clause: a handle statement answers every operation of {1}.")
	// EK2109: a schema declaration's field whose type has no schema form. {0} is the type.
	// EK2112: a catch clause that tests a failure's type, retired (D216). A warning. {0} is the clause's variable.
	EK2112 = message(2112, warningCategory, "A catch clause no longer tests a failure's type; write catch ({0}) and test {0} with match or is.")
	// EK2113: a catch clause typed Cause, retired (D217). A warning.
	EK2113 = message(2113, warningCategory, "A catch clause no longer catches a whole Cause; match on exit(…) with Exit.Success and Exit.Failure arms.")
	// EK2111: a restore block that no uninterruptible block encloses (D180).
	EK2111 = message(2111, errorCategory, "This restore block is not inside an uninterruptible block, so it has no interruptibility to restore.")
	EK2109 = message(2109, errorCategory, "{0} has no schema form: a schema declaration's field is a primitive (string, number, boolean, bigint, symbol, undefined or null), a literal, a union, an array, a tuple, a Record, an object type, or another schema's name.")
	// EK2117: an error whose tag does not fit (D278, D304): a subclass's tag and its base's tag type,
	// or a concrete error's name and its _tag field; also an error that extends what is not an error
	// of its kind. {0} is the error, {1} its base, {2} the base's tag type, {3} the subclass's tag.
	EK2117 = message(2117, errorCategory, "{0} cannot have its own tag: {1}'s tag is {2}, which does not include {3}.")
	// EK2118: a subclass that declares fields and no constructor, whose base's constructor does not
	// take one object of fields (D278). {0} is the subclass, {1} its base.
	EK2118 = message(2118, errorCategory, "{0} declares fields and no constructor, but {1}'s constructor does not take its fields as one object.")
	// EK9206: a recursive function whose A depends on its own result. {0} is the function.
	EK9206 = message(9206, errorCategory, "{0} calls itself, and its success type depends on that call, so its contract must be written.")

	EK2115 = message(2115, errorCategory, "{0} returns a program, so its body runs when {0} is called and cannot run {1}.")
	EK2116 = message(2116, errorCategory, "{0} returns a program on one path, so every path must return one; {1} does not.")
	// EK3001: two services share a key. {0} is the key.
	EK3001 = message(3001, errorCategory, "Two services share the key {0}; each service needs a unique key: change static readonly key or rename the declaration.")
	// EK3002: a class extends a service.
	EK3002 = message(3002, errorCategory, "A class cannot extend a service: it would inherit the key and silently become the same service; implement its Shape instead.")
	// EK3003: new on a service. {0} is the service.
	EK3003 = message(3003, errorCategory, "{0} is a service key, so new {0}() cannot create an implementation; use {0}(), an object literal, or a class that implements {0}.Shape.")
	// EK3004: instanceof on a service. {0} is the service.
	EK3004 = message(3004, errorCategory, "instanceof {0} is always false: implementations are plain objects; check their members instead.")
	// EK3005: a generic service class.
	EK3005 = message(3005, errorCategory, "A service cannot have type parameters: every T would share one key; use an interface for the generic shape.")
	// EK9208: a static member with the same name as a service member. {0} is the name.
	EK9208 = message(9208, errorCategory, "The static member {0} has the same name as a service member.")
	// EK3101: a provider looks a service up per call where the contract allows no requirements. {0} is the member, {1} the service, {2} the contract.
	EK3101 = message(3101, errorCategory, "{0} looks up {1} each time it is called, but {2} allows no call-time requirements.")
	// EK3201: no provider for a required service. {0} is the service.
	EK3201 = message(3201, errorCategory, "Nothing provides {0}, which this program needs.")
	// EK3202: two providers for one service. {0} is the service, {1} the providers.
	EK3202 = message(3202, errorCategory, "Two providers for {0}: {1}. Pass one.")
	// EK3203: providers form a cycle. {0} is the cycle.
	EK3203 = message(3203, errorCategory, "These providers form a cycle: {0}.")
	// EK3204: a wire argument whose type does not name its outputs. {0} is the argument.
	EK3204 = message(3204, errorCategory, "{0} does not name its outputs in its type, so wire cannot place it.")
	// EK3205: an entry module's main needs a service that nothing provides when the host starts the module (D135, D122). {0} is the service.
	EK3205 = message(3205, warningCategory, "main needs {0}, which nothing provides when the host starts this module.")
	// EK3206: a file names a second, different platform with a platform import (D312). {0} is the platform it names first, {1} the second.
	EK3206 = message(3206, errorCategory, "This file already names the {0} platform, so it cannot also name {1}.")

	// EK3207: a provider cannot promise a layer, Context, or non-empty list (D362).
	EK3207 = message(3207, errorCategory, "This provider is not a layer, a non-empty list of layers, or a Context. Provide a layer, a non-empty tuple of layers, a Context, or Key = value.")

	// EK4201: a control operation inside a combinator that runs it on another fiber. {0} is the operation, {1} the combinator, {2} the operation's control.
	EK4201 = message(4201, errorCategory, "{0} is a control operation, and {1} runs it on other fibers, where the {2} handler on this fiber cannot be reached.")
	// EK4202: a TypeScript function whose R holds a control operation. {0} is the function, {1} the control.
	EK4202 = message(4202, errorCategory, "{0} is a TypeScript function whose requirements include the control operation {1}.")
	// EK4301: a callback that can pause or fail where a plain function is expected. {0} is the callback, {1} the callee.
	EK4301 = message(4301, errorCategory, "{0} can't be passed to {1}: it runs Effects, and {1} calls it synchronously, as a plain function.")
	// EK4401: a plain TypeScript call with no boundary or trusted contract. {0} is the function.
	EK4401 = message(4401, errorCategory, "{0} is a plain TypeScript function, and nothing says what its exceptions mean.")
	// EK4402: a Node.js or browser API, used or imported as a value. {0} is the API.
	EK4402 = message(4402, errorCategory, "{0} is platform code, which VibeLang code does not use directly.")
	// EK4403: a clock or randomness read. {0} is the read, such as "Date.now()".
	EK4403 = message(4403, errorCategory, "{0} reads the clock or randomness, which a test cannot control.")
	// EK4501: method syntax without a call. {0} is the method, {1} the module.
	EK4501 = message(4501, errorCategory, "{0} is a method of {1}'s values only in a call: x.{0}(…) calls {1}.{0}(x, …).")
	// EK4405: a hatch's TypeScript reads a binding of the .vibe file. {0} is the binding, {1} the hatch.
	EK4405 = message(4405, errorCategory, "{0} is declared outside the hatch, and a hatch's TypeScript is self-contained: pass {0} to {1} as an input.")
	// EK4406: a declaration tag cannot reach the per-file emit (D249).
	EK4406 = message(4406, legacyTrustCategory, "{0}: @vibelang trusted and @throws tags will not survive the emit switch; {1}.")
	// EK4407: a module specifier written as an identifier names no module declaration of the file (D283). {0} is the name.
	EK4407 = message(4407, errorCategory, "This file declares no module named {0}: write module {0} { … } at its top level, or import a file with a string specifier.")
	// EK4408: a module declaration written where none can stand, or a body that is not an ES module (D283).
	EK4408 = message(4408, errorCategory, "A module declaration stands at the top level of a .vibe file and holds an ES module.")
	// EK4409: what an Effect function or a program returns is a call of a value of type any. {0} is the call, {1} the function. A warning, adjustable.
	EK4409 = message(4409, warningCategory, "{0} calls a value of type any, so {1} succeeds with whatever it returns and runs no program it returns.")
)

// registry lists every message above by code.
var registry = map[int32]*Message{}

func init() {
	for _, m := range []*Message{
		EK0108,
		EK1001, EK1002, EK1003, EK1005, EK1006, EK1007, EK1008, EK1010, EK1011, EK1012, EK1022, EK1023,
		EK9201, EK9202, EK9203, EK9204, EK2005, EK2006, EK9205, EK9206, EK9207, EK2104, EK2105, EK2106, EK2107, EK2108, EK2109, EK2112, EK2113, EK2115, EK2116, EK2117, EK2118,
		EK3001, EK3002, EK3003, EK3004, EK3005, EK9208, EK3101, EK3201, EK3202, EK3203, EK3204, EK3205, EK3206, EK3207,
		EK4201, EK4202, EK4301, EK4401, EK4402, EK4403, EK4405, EK4406, EK4407, EK4408, EK4409, EK4501,
	} {
		registry[m.Code] = m
	}
}

// adjustableCodes are the codes whose category compilerOptions.vibelang.diagnostics
// and @vibelang-diagnostics comments may change (D34, D241), the list that
// tsoptions validates.
var adjustableCodes = func() []int32 {
	var codes []int32
	for _, code := range core.VibeLangAdjustableCodes {
		n, _ := strconv.Atoi(strings.TrimPrefix(code, diagnosticSource))
		codes = append(codes, int32(n))
	}
	return codes
}()

// legacyTrustCategory is the D249 emit-switch point: change this to
// errorCategory when (B) emit becomes the default. Projects can opt in now
// with EK4406:error, independently of the legacy emitter.
const legacyTrustCategory = warningCategory

// legacyFormChoiceCategory is the release-before-switch category for EK9100.
// Editor-only until the switch, it becomes an error when (B) emit is default.
const legacyFormChoiceCategory = warningCategory

// category returns the category options give code, and false when they turn
// it off.
func category(options *core.CompilerOptions, m *Message) (diagnostics.Category, bool) {
	if value, _ := releaseSeverity(options, m); value != "" {
		if category, on, ok := categoryNamed(value, m); ok {
			return category, on
		}
	}
	if options != nil && options.VibeLang != nil && slices.Contains(adjustableCodes, m.Code) {
		if category, on, ok := categoryNamed(options.VibeLang.Diagnostics[m.String()], m); ok {
			return category, on
		}
	}
	if m.Off {
		return 0, false
	}
	return m.Category, true
}

// categoryNamed returns the category that name, a value of
// compilerOptions.vibelang.diagnostics or of an @vibelang-diagnostics comment,
// gives m, and false when name is not one.
func categoryNamed(name string, m *Message) (category diagnostics.Category, on bool, ok bool) {
	switch name {
	case "error":
		return errorCategory, true, true
	case "warning":
		return warningCategory, true, true
	case "suggestion":
		return diagnostics.CategorySuggestion, true, true
	case "off":
		return 0, false, true
	}
	return 0, false, false
}

// newDiagnostic makes a diagnostic with message m at node, or returns nil when
// options turn m's code off. The span is TypeScript's error span for node,
// such as a declaration's name.
func newDiagnostic(options *core.CompilerOptions, node *ast.Node, m *Message, args ...any) *ast.Diagnostic {
	file := ast.GetSourceFileOfNode(node)
	return newDiagnosticAt(options, file, scanner.GetErrorRangeForNode(file, node), m, args...)
}

// newDiagnosticAt makes a diagnostic with message m at loc in file, or returns
// nil outside VibeLang source files or when options turn m's code off.
func newDiagnosticAt(options *core.CompilerOptions, file *ast.SourceFile, loc core.TextRange, m *Message, args ...any) *ast.Diagnostic {
	// D266: TypeScript owns diagnostics in ordinary source files. Keep this
	// gate at the shared attachment point so no EK rule can reject them,
	// including rules enabled by project options or inline directives.
	if !isVibeLangFile(file) {
		return nil
	}
	category, on := category(options, m)
	if slices.Contains(adjustableCodes, m.Code) {
		category, on = directiveCategory(file, loc.Pos(), m, category, on)
	}
	if !on {
		return nil
	}
	code := m.Code
	if _, name := releaseSeverity(options, m); name != "" {
		n, _ := strconv.Atoi(strings.TrimPrefix(name, "EK"))
		code = int32(n)
	}
	return ast.NewExternalDiagnostic(file, loc, diagnosticSource, category, code, format(m.Text, args))
}

// report adds a diagnostic with message m at node to the diagnostics of c,
// which must be checking node's file, and returns it. It returns nil when the
// project that owns the file turns m's code off (D297).
func report(c *checker.Checker, node *ast.Node, m *Message, args ...any) *ast.Diagnostic {
	if d := newDiagnostic(optionsFor(c, ast.GetSourceFileOfNode(node)), node, m, args...); d != nil {
		return c.AddDiagnostic(d)
	}
	return nil
}

// reportAt is report for a span that is not one node's error span, such as a
// keyword inside a node.
func reportAt(c *checker.Checker, file *ast.SourceFile, loc core.TextRange, m *Message, args ...any) *ast.Diagnostic {
	if d := newDiagnosticAt(optionsFor(c, file), file, loc, m, args...); d != nil {
		return c.AddDiagnostic(d)
	}
	return nil
}

// note adds a line under d, such as a fix, and returns d. A nil d, which
// report returns for a code that is off, is ignored.
func note(d *ast.Diagnostic, text string, args ...any) *ast.Diagnostic {
	if d != nil {
		d.AddMessageChain(ast.NewExternalDiagnostic(nil, core.TextRange{}, diagnosticSource, diagnostics.CategoryMessage, 0, format(text, args)))
	}
	return d
}

// format replaces {0}, {1}, … in text with args.
func format(text string, args []any) string {
	for i, arg := range args {
		text = strings.ReplaceAll(text, "{"+strconv.Itoa(i)+"}", fmt.Sprint(arg))
	}
	return text
}

// fileChecks run once for each .vibe file that a checker checks, after
// TypeScript's own checks of that file. Each lane's checks register here from
// an init function in their own file.
var fileChecks []func(c *checker.Checker, file *ast.SourceFile)

func checkSourceFile(c *checker.Checker, file *ast.SourceFile) {
	if isCheckedTypeScriptFile(file) {
		for _, check := range typeScriptFileChecks {
			check(c, file)
		}
		return
	}
	if !isVibeLangFile(file) {
		return
	}
	for _, check := range fileChecks {
		check(c, file)
	}
}

// diagnosticsState is what one checker remembers about diagnostics.
type diagnosticsState struct {
	covered   map[*ast.SourceFile][]core.TextRange
	arguments map[*ast.SourceFile][]int          // the starts of arguments whose type error an EK diagnostic explains
	codes     map[*ast.SourceFile][]coveredCodes // TypeScript codes that an EK diagnostic explains, each in one node
}

// coveredCodes are TypeScript diagnostic codes hidden inside one range.
type coveredCodes struct {
	loc   core.TextRange
	codes []int32
}

type diagnosticsStateKey struct{}

func diagnosticsStateOf(c *checker.Checker) *diagnosticsState {
	return c.ExtensionState(diagnosticsStateKey{}, func() any {
		return &diagnosticsState{covered: map[*ast.SourceFile][]core.TextRange{}, arguments: map[*ast.SourceFile][]int{}, codes: map[*ast.SourceFile][]coveredCodes{}}
	}).(*diagnosticsState)
}

// cover hides TypeScript's own diagnostics inside node, because an EK
// diagnostic reported for node explains them. For example, EK1003 at an
// await covers TypeScript's complaint that the function is not async.
func cover(c *checker.Checker, node *ast.Node) {
	file := ast.GetSourceFileOfNode(node)
	state := diagnosticsStateOf(c)
	state.covered[file] = append(state.covered[file], core.NewTextRange(scanner.SkipTrivia(file.Text(), node.Pos()), node.End()))
}

// coverCodes hides TypeScript's diagnostics with one of codes inside node,
// because an EK diagnostic reported for node explains them. Unlike cover, it
// keeps TypeScript's other errors inside node, such as an argument's.
func coverCodes(c *checker.Checker, node *ast.Node, codes ...int32) {
	file := ast.GetSourceFileOfNode(node)
	state := diagnosticsStateOf(c)
	state.codes[file] = append(state.codes[file], coveredCodes{core.NewTextRange(scanner.SkipTrivia(file.Text(), node.Pos()), node.End()), codes})
}

// coverArgument hides TypeScript's error that argument's type does not fit
// its parameter (TS2345, or TS2769 for an overloaded callee), or that a type
// argument does not fit its type parameter's constraint (TS2344), because an
// EK diagnostic reported for argument explains it. Unlike cover, it keeps the
// errors inside argument, such as those in a test's body.
func coverArgument(c *checker.Checker, argument *ast.Node) {
	file := ast.GetSourceFileOfNode(argument)
	state := diagnosticsStateOf(c)
	state.arguments[file] = append(state.arguments[file], scanner.SkipTrivia(file.Text(), argument.Pos()))
}

// filterCoveredDiagnostics drops TypeScript diagnostics inside covered nodes,
// and the type errors of covered arguments.
// filterPlatformImports drops TypeScript's TS2882 at a platform import
// (D312): the specifier names the entry's platform, not a module, and the
// lowering removes the import.
func filterPlatformImports(c *checker.Checker, file *ast.SourceFile, diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) || namedPlatform(file) == nil {
		return diagnostics
	}
	isPlatformImport := func(d *ast.Diagnostic) bool {
		if d.Source() != "" || d.Code() != 2882 {
			return false
		}
		return slices.ContainsFunc(file.Statements.Nodes, func(statement *ast.Node) bool {
			return platformImport(statement) != nil && statement.AsImportDeclaration().ModuleSpecifier.Pos() <= d.Pos() && d.End() <= statement.End()
		})
	}
	if !slices.ContainsFunc(diagnostics, isPlatformImport) {
		return diagnostics
	}
	return slices.DeleteFunc(slices.Clone(diagnostics), isPlatformImport)
}

func filterCoveredDiagnostics(c *checker.Checker, file *ast.SourceFile, diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return diagnostics
	}
	state := diagnosticsStateOf(c)
	covered, arguments, codes := state.covered[file], state.arguments[file], state.codes[file]
	if len(covered) == 0 && len(arguments) == 0 && len(codes) == 0 {
		return diagnostics
	}
	isCovered := func(d *ast.Diagnostic) bool {
		if d.Source() != "" {
			return false
		}
		if (d.Code() == 2345 || d.Code() == 2769 || d.Code() == 2344) && slices.Contains(arguments, d.Pos()) {
			return true
		}
		if slices.ContainsFunc(codes, func(r coveredCodes) bool {
			return slices.Contains(r.codes, d.Code()) && r.loc.Pos() <= d.Pos() && d.End() <= r.loc.End()
		}) {
			return true
		}
		return slices.ContainsFunc(covered, func(r core.TextRange) bool {
			return r.Pos() <= d.Pos() && d.End() <= r.End()
		})
	}
	if !slices.ContainsFunc(diagnostics, isCovered) {
		return diagnostics
	}
	return slices.DeleteFunc(slices.Clone(diagnostics), isCovered)
}

func releaseSeverity(options *core.CompilerOptions, m *Message) (string, string) {
	if options == nil || options.VibeLang == nil {
		return "", ""
	}
	// Release keys retain the VIP's leading zero, independently of the
	// legacy diagnostic display formatter. Width is a minimum for EK38100+.
	canonical := fmt.Sprintf("EK%04d", m.Code)
	if core.VibeSeverityCode(canonical) {
		if value, ok := options.VibeLang.Severities[canonical]; ok {
			return value, canonical
		}
	}
	for _, code := range core.VibeLintPorts[m.String()] {
		if value, ok := options.VibeLang.Severities[code]; ok {
			return value, code
		}
	}
	return "", ""
}
