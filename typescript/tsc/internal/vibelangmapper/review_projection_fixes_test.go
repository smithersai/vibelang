package vibelangmapper

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// #459: a field name's position is the end of the token before it, so the
// type of the field before, Immutable, ends in "mutable". That is no
// modifier: both fields stay declare readonly and Immutable stays whole.
func TestErrorFieldAfterTypeEndingInModifier(t *testing.T) {
	for _, source := range []string{
		"type Immutable = { readonly a: number }\nerror Worse {\n  state: Immutable\n  next: string\n  describe() { return \"x\" }\n}\n",
		"type Immutable = { readonly a: number }\nschema error Bad {\n  state: Immutable\n  next: string\n}\n",
		"type Unreadonly = { a: number }\nerror Worse {\n  state: Unreadonly\n  next: string\n  describe() { return \"x\" }\n}\n",
	} {
		text := Project(source, testContext).Text
		if strings.Contains(text, "Imdeclare") || strings.Contains(text, "Undeclare") {
			t.Errorf("the type before the field was overwritten:\n%s", text)
		}
		if !strings.Contains(text, "declare readonly next: string") {
			t.Errorf("the next field is not declare readonly:\n%s", text)
		}
		if strings.Contains(source, "describe") && !strings.Contains(text, "readonly next: string; }>") {
			t.Errorf("the base's type argument lost readonly:\n%s", text)
		}
		assertParses(t, text)
	}
	// A written modifier still counts.
	text := Project("error Counter {\n  mutable count: number\n  readonly name: string\n  describe() { return \"x\" }\n}\n", testContext).Text
	for _, want := range []string{"declare count: number", "declare readonly name: string", "count: number; readonly name: string; }>"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q:\n%s", want, text)
		}
	}
}

// #459: the braces of a base's type argument are not the subclass's body.
func TestErrorSubclassWithBracedTypeArgument(t *testing.T) {
	source := "error Base<T> { value: T }\nerror Missing extends Base<{ id: string }> { path: string }\n"
	text := Project(source, testContext).Text
	assertParses(t, text)
	if !strings.Contains(text, "Base<{ id: string }>") {
		t.Errorf("the base's type argument changed:\n%s", text)
	}
	if !regexp.MustCompile(`>\s*\{\s*declare readonly _tag: "Missing";`).MatchString(text) {
		t.Errorf("the generated members are not in the class body:\n%s", text)
	}
}

// #459: a comment between : and a retired infer annotation does not make the
// whole file pass through unprojected.
func TestInferReturnAnnotationAfterComment(t *testing.T) {
	for _, source := range []string{
		"error NotFound { id: string }\nfunction f(n: number): /* inferred */ infer _ { return n }\n",
		"error NotFound { id: string }\nfunction f(n: number): // inferred\n  infer _ { return n }\n",
	} {
		result := Project(source, testContext)
		if !strings.Contains(result.Text, "class NotFound") {
			t.Errorf("the file passed through unprojected: %+v\n%s", result.Diagnostics, result.Text)
		}
		if strings.Contains(result.Text, "infer _") {
			t.Errorf("the annotation stayed:\n%s", result.Text)
		}
		assertParses(t, result.Text)
	}
}

// #459: a data-method call still being typed keeps its last argument whole.
func TestUnfinishedDataMethodCallKeepsLastArgument(t *testing.T) {
	source := "import { opaque } from \"./o.js\"\neffect function f(alpha: number) {\n  return opaque.getOrElse(alpha\n}\n"
	text := Project(source, testContext).Text
	if !strings.Contains(text, "alpha") || strings.Contains(text, "alph)") {
		t.Fatalf("the argument lost its last character:\n%s", text)
	}
}

// #460: Effect has no own member uninterruptible, so the call is D152's
// module function, as the native compiler lowers it.
func TestEffectUninterruptibleIsAModuleCall(t *testing.T) {
	source := "export effect function main() {\n  const e: Effect.Effect<number> = Effect.succeed(1)\n  const a = try e.uninterruptible()\n  const b = try e.map((n) => n + 1)\n  return a + b\n}\n"
	for name, render := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
		text := render(source, testContext).Text
		if strings.Contains(text, "e.uninterruptible()") {
			t.Errorf("%s keeps the member call:\n%s", name, text)
		}
		if !regexp.MustCompile(`uninterruptible\(e\)`).MatchString(text) {
			t.Errorf("%s does not call the module function:\n%s", name, text)
		}
	}
}

// #460: the hand-kept data-method tables agree with each other: every
// curried or guard key is a method, and no method is an unexported
// declaration name (catch_) that the generated candidates leave out.
func TestDataMethodTablesAgree(t *testing.T) {
	for key := range dataLastMethods {
		module, name, _ := strings.Cut(key, "#")
		if !dataMethods[module][name] {
			t.Errorf("dataLastMethods has %s, which dataMethods lacks", key)
		}
	}
	for module, methods := range dataMethods {
		for name := range methods {
			if strings.HasPrefix(name, "_") || strings.HasSuffix(name, "_") {
				t.Errorf("dataMethods has the unexported name %s#%s", module, name)
			}
		}
	}
	for _, name := range []string{"uninterruptible", "map", "flatMap"} {
		if dataOwnMembers["effect/Effect"][name] {
			t.Errorf("an Effect value has no own member %s", name)
		}
	}
}

// #460: instance methods are never called by their interface's name, so the
// generated built-in contracts hold none.
func TestBuiltinContractsHaveNoInstanceMethods(t *testing.T) {
	for _, key := range []string{"Headers.append", "Headers.set", "TextDecoder.decode", "Number.toFixed", "String.repeat", "Uint8Array.setFromBase64", "Uint8Array.setFromHex"} {
		if _, ok := builtinContracts[key]; ok {
			t.Errorf("builtinContracts has the instance method %s", key)
		}
	}
	for _, key := range []string{"JSON.parse", "Intl.NumberFormat.supportedLocalesOf", "Intl.DisplayNames.supportedLocalesOf", "Intl.getCanonicalLocales", "decodeURI"} {
		if _, ok := builtinContracts[key]; !ok {
			t.Errorf("builtinContracts lacks the static %s", key)
		}
	}
	text := Project("export effect function main(h: Headers) {\n  const b = Headers.set(h, \"a\", \"b\")\n  return b\n}\n", testContext).Text
	if strings.Contains(text, "typeof Headers.set") {
		t.Errorf("Headers.set is wrapped as a static call:\n%s", text)
	}
}

// #462: Emit of a .vibex file transpiles TSX and names app.js.
func TestEmitVibex(t *testing.T) {
	js, sourceMap, diagnostics := Emit("export const a = <div/>\n", FileContext{FileName: "/p/app.vibex", ModuleKey: "p/app"})
	for _, d := range diagnostics {
		t.Errorf("diagnostic: %+v", d)
	}
	if !strings.Contains(js, "<div") {
		t.Errorf("the JSX was not preserved:\n%s", js)
	}
	var raw struct {
		File string `json:"file"`
	}
	if err := json.Unmarshal([]byte(sourceMap), &raw); err != nil {
		t.Fatalf("source map: %v\n%s", err, sourceMap)
	}
	if raw.File != "app.js" {
		t.Errorf("source map file = %q, want app.js", raw.File)
	}
	if _, sourceMap, _ := Emit("export const a = 1\n", testContext); !strings.Contains(sourceMap, `"file":"main.js"`) {
		t.Errorf("a .vibe file's source map: %s", sourceMap)
	}
}

// #513: try at the end of a line after return keeps its operand in the
// return statement.
func TestReturnTryOperandOnNextLine(t *testing.T) {
	source := "effect function load() { return 41 }\nexport effect function main() {\n  const n = try\n    load()\n  return try\n    Effect.succeed(n + 1)\n}\n"
	for name, render := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
		result := render(source, testContext)
		if !regexp.MustCompile(`return\s+\(yield\* (\$run\()?\$try\(Effect\.succeed\(n \+ 1\)\)`).MatchString(result.Text) {
			t.Errorf("%s splits the return statement:\n%s", name, result.Text)
		}
		assertParses(t, result.Text)
		assertValidMap(t, result, source)
	}
}

// #513: effect before a method with a computed name after a field without a
// semicolon keeps the method a member.
func TestEffectComputedMethodAfterField(t *testing.T) {
	source := "const key = \"run\"\nclass Job {\n  count = 1\n  effect [key]() { return this.count }\n}\nexport effect function main() { return try new Job()[key]() }\n"
	result := Project(source, testContext)
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/virtual.ts")}, result.Text, core.ScriptKindTS)
	for _, d := range file.Diagnostics() {
		t.Errorf("syntax error at %d: %s\n%s", d.Pos(), d.String(), result.Text)
	}
	found := false
	for _, statement := range file.Statements.Nodes {
		if statement.Kind != ast.KindClassDeclaration {
			continue
		}
		for _, member := range statement.Members() {
			if member.Kind == ast.KindMethodDeclaration && ast.IsComputedPropertyName(member.Name()) {
				found = true
			}
		}
	}
	if !found {
		t.Errorf("Job has no method named [key]:\n%s", result.Text)
	}
}

// #514: the executable rendering imports Experimental, a runtime prelude
// name, from the runtime, not from effect.
func TestExecutableImportsExperimentalFromRuntime(t *testing.T) {
	text := Executable("export function kind(path: string) { return Experimental.FileSystem.FileSystem.stat(path) }\n", testContext).Text
	if !regexp.MustCompile(`import \{[^}]*\bExperimental\b[^}]*\} from "vibelang-runtime/internal"`).MatchString(text) {
		t.Errorf("Experimental is not imported from the runtime:\n%s", text)
	}
	if regexp.MustCompile(`import \{[^}]*\bExperimental\b[^}]*\} from "effect"`).MatchString(text) {
		t.Errorf("Experimental is imported from effect:\n%s", text)
	}
}

// #514: every export of effect/Effect is a global of a .vibe file (VIP-6),
// so the executable rendering imports the ones a file uses.
func TestExecutableImportsEffectGlobals(t *testing.T) {
	source := "export effect function main() {\n  const one = try succeed(1)\n  const two = try scoped(acquireRelease(succeed(2), () => succeed(undefined)))\n  return one + two\n}\n"
	text := Executable(source, testContext).Text
	imports := regexp.MustCompile(`import \{([^}]*)\} from "effect/Effect"`).FindStringSubmatch(text)
	if imports == nil {
		t.Fatalf("nothing is imported from effect/Effect:\n%s", text)
	}
	for _, name := range []string{"succeed", "scoped", "acquireRelease"} {
		if !regexp.MustCompile(`\b` + name + `\b`).MatchString(imports[1]) {
			t.Errorf("%s is not imported from effect/Effect:\n%s", name, text)
		}
	}
	// A file's own declaration shadows the global.
	text = Executable("const succeed = (n: number) => n\nexport const one = succeed(1)\n", testContext).Text
	if strings.Contains(text, `from "effect/Effect"`) {
		t.Errorf("a declared name is imported:\n%s", text)
	}
}
