package vibelangestree

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf16"
)

// The Node tests in packages/compiler/test/eslint hold the conversion to
// typescript-estree's and lint whole files; these pin the tree's contract
// without Node.

func parse(t *testing.T, fileName, text string) map[string]any {
	t.Helper()
	tree, failure := Parse(fileName, text)
	if failure != nil {
		t.Fatalf("Parse(%q): %v", text, failure)
	}
	var program map[string]any
	if err := json.Unmarshal([]byte(tree), &program); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, tree)
	}
	return program
}

func rangeOf(node map[string]any) (int, int) {
	r := node["range"].([]any)
	return int(r[0].(float64)), int(r[1].(float64))
}

// nodes returns every node of tree in document order.
func nodes(tree any) []map[string]any {
	var out []map[string]any
	var walk func(value any)
	walk = func(value any) {
		switch v := value.(type) {
		case map[string]any:
			if _, ok := v["type"].(string); ok {
				out = append(out, v)
			}
			for key, child := range v {
				if key != "tokens" && key != "comments" {
					walk(child)
				}
			}
		case []any:
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(tree)
	return out
}

func utf16Slice(text string, start, end int) string {
	units := utf16.Encode([]rune(text))
	return string(utf16.Decode(units[start:end]))
}

var forms = map[string]string{
	"contracts":      "function read(id: string): string!Gone!Users { return Users.find(id) }\ntype Program = number!!\n",
	"declarations":   "error Gone { id: string }\nerror Timeout\nservice Users { find(id: string): string!Gone }\ncontrol Ask { answer(): boolean!! }\nschema Ticket { id: string; mutable count: number }\nschema Code = \"a\" | \"b\"\nschema Point = { x: number }\nlayer Live: Users { find(id) { return id } }\n",
	"error classes":  "export error AppError implements Coded {\n  _tag: string\n  /** The code. */\n  code: string\n  static readonly family = \"app\"\n  constructor(code: string) { super({ code }) }\n  get label(): string { return this.code }\n}\nerror NotFound extends AppError { mutable path: string; describe(): string { return this.path } }\nerror Timeout extends AppError\nabstract error Http { status: number; abstract describe(): string }\nschema error FsError { _tag: string; method: string; mutable path?: string }\nschema error Missing extends FsError { attempts: number }\n",
	"blocks":         "function f() { return withSpan(\"f\") { const value = do { 1 }; return value } }\n",
	"provide":        "function f() { provide Live, Clock = clock { return Users.find(\"1\") } }\n",
	"catch":          "function f() { const a = read() catch \"x\"; return read() catch (e) => match (e) { when Gone: 1; default: 2; } }\n",
	"pipes":          "function f(n: number) { return n |> % + 1 |> String(%) }\n",
	"patterns":       "function f(o: unknown) { if (o is Exit.Failure(let cause)) return cause; return 0 }\n",
	"primitives":     "function f() { uninterruptible { restore { return read() } } }\nfunction g() { try { return read() } finally (exit) { log(exit) } }\n",
	"fibers":         "function f(ids: string[]) { const t = fork read(); const all = await.all [read()]; for concurrent(2) (const id of ids) log(id); return join t }\n",
	"handle":         "function f() { try { return ask() } handle Ask.answer() { resume(true) } handle Ask.other(n) { resume(n) } }\n",
	"match":          "function f(x: number) { match (x) { when 1: log(\"one\"); default: log(\"other\"); } }\n",
	"hatches":        "function f(text: string) { return try((text) => JSON.parse(text), text) ?? throw new Gone({ id: text }) }\n",
	"service shapes": "service Prefix: string\nexport service Search: SearchApi { static readonly layer = live }\n",
	"data":           dataFile,
	"modules":        moduleFile,
}

// dataFile declares data types (D307) and matches their variants.
const dataFile = "export data Delivery {\n  Waiting\n  /** On its way. */\n  Sent { tracking: string; note?: string }\n}\n" +
	"data Box<A> { Full { value: A }; Empty }\n" +
	"function f(d: Delivery) {\n  return match (d) {\n    when Delivery.Waiting: Box.Empty();\n    when Delivery.Sent { let tracking }: Box.Full({ value: tracking });\n  }\n}\n"

// moduleFile declares a module (D283) whose TypeScript body holds the forms
// the token scan rescans, and reaches it through every identifier specifier.
const moduleFile = "import { suffix } from \"./suffix.ts\"\n" +
	"error Unclean { reason: string }\n" +
	"/** Text helpers. */\n" +
	"module text {\n" +
	"  import { Effect } from \"effect\"\n" +
	"  // A comment in the body.\n" +
	"  export function clean(value: string): string {\n" +
	"    return value.trim() + /a\\/b/g.source + `${suffix}!` + String(1 >> 2)\n" +
	"  }\n" +
	"  export const program = Effect.succeed(clean(\"x\"))\n" +
	"}\n" +
	"import { clean } from text\n" +
	"import text\n" +
	"export { clean as tidy } from text\n" +
	"export * from text\n" +
	"export function main(): string!Unclean { return clean(\" a \") }\n"

// find returns the nodes of tree whose type is typ.
func find(tree any, typ string) []map[string]any {
	var out []map[string]any
	for _, node := range nodes(tree) {
		if node["type"] == typ {
			out = append(out, node)
		}
	}
	return out
}

func sourceOf(text string, node map[string]any) string {
	start, end := rangeOf(node)
	return text[start:end]
}

func TestAModuleDeclarationHoldsItsTypeScriptBody(t *testing.T) {
	program := parse(t, "/main.vibe", moduleFile)
	modules := find(program, "VibeModuleDeclaration")
	if len(modules) != 1 {
		t.Fatalf("%d module declarations, want 1", len(modules))
	}
	module := modules[0]
	if got := sourceOf(moduleFile, module); !strings.HasPrefix(got, "module text {") || !strings.HasSuffix(got, "}") {
		t.Errorf("the declaration is %q", got)
	}
	id := module["id"].(map[string]any)
	if id["type"] != "Identifier" || id["name"] != "text" || sourceOf(moduleFile, id) != "text" {
		t.Errorf("the declaration's id is %v", id)
	}
	body := module["body"].(map[string]any)
	if body["type"] != "TSModuleBlock" {
		t.Fatalf("the body is a %v", body["type"])
	}
	if got := sourceOf(moduleFile, body); !strings.HasPrefix(got, "{\n  import") || !strings.HasSuffix(got, "))\n}") {
		t.Errorf("the body is %q", got)
	}
	var types []string
	for _, statement := range body["body"].([]any) {
		types = append(types, statement.(map[string]any)["type"].(string))
	}
	if want := "ImportDeclaration ExportNamedDeclaration ExportNamedDeclaration"; strings.Join(types, " ") != want {
		t.Errorf("the body holds %v, want %s", types, want)
	}
	// The body's own string specifier stays a string; its names sit at their offsets.
	imports := body["body"].([]any)[0].(map[string]any)
	if source := imports["source"].(map[string]any); source["type"] != "Literal" || source["value"] != "effect" {
		t.Errorf("the body's import is from %v", source)
	}
	for _, node := range find(body, "Identifier") {
		if got := sourceOf(moduleFile, node); !strings.HasPrefix(got, node["name"].(string)) {
			t.Errorf("identifier %s is at %q", node["name"], got)
		}
	}
	// No VibeLang form is read in the body: its errors are TypeScript's.
	if len(find(body, "VibeEffectType")) != 0 || len(find(body, "VibePipeExpression")) != 0 {
		t.Error("the body has a VibeLang node")
	}
}

func TestAnIdentifierModuleSpecifierIsTheIdentifier(t *testing.T) {
	tree, failure := Parse("/main.vibe", moduleFile)
	if failure != nil {
		t.Fatal(failure)
	}
	if strings.Contains(tree, ".text.js") {
		t.Error("the tree holds the module's file name")
	}
	program := parse(t, "/main.vibe", moduleFile)
	count := 0
	for _, statement := range program["body"].([]any) {
		statement := statement.(map[string]any)
		source, ok := statement["source"].(map[string]any)
		if !ok || source["type"] == "Literal" {
			continue
		}
		count++
		if source["type"] != "Identifier" || source["name"] != "text" || source["value"] != "text" || sourceOf(moduleFile, source) != "text" {
			t.Errorf("%s has source %v", statement["type"], source)
		}
	}
	if count != 4 {
		t.Errorf("%d identifier specifiers, want 4", count)
	}
}

// TestAModuleDeclarationWithoutANameHasNoID checks module { }, which the
// checker refuses (EK4408): ESLint still lints its body, and its id is null,
// as an anonymous declaration's is.
func TestAModuleDeclarationWithoutANameHasNoID(t *testing.T) {
	text := "module {\n  export const one = 1\n}\n"
	modules := find(parse(t, "/main.vibe", text), "VibeModuleDeclaration")
	if len(modules) != 1 || modules[0]["id"] != nil {
		t.Fatalf("got %v, want one module declaration without an id", modules)
	}
	if got := sourceOf(text, modules[0]["body"].(map[string]any)); got != "{\n  export const one = 1\n}" {
		t.Errorf("the body is %q", got)
	}
}

// TestAnUnclosedModuleDeclarationReportsTheMissingBrace checks a module whose
// closing brace is missing: its body runs to its last token, so the error is
// the missing brace, not one inside a body cut short (or a panic on module {,
// whose body is empty).
func TestAnUnclosedModuleDeclarationReportsTheMissingBrace(t *testing.T) {
	for _, text := range []string{"module {", "module text {\n  export const one = 1\n", "function f() {\n  module inner {\n    export const two = 2"} {
		_, failure := Parse("/main.vibe", text)
		if failure == nil || !strings.Contains(failure.Message, "'}' expected") {
			t.Errorf("Parse(%q) fails with %v, want '}' expected", text, failure)
		}
	}
}

func TestEveryModuleDeclarationConvertsItsBody(t *testing.T) {
	// Only a top-level declaration, the first of its name, has a source file
	// of its own; the checker reports the others (EK4408), and ESLint still
	// lints their bodies.
	text := "module text {\n  export const one = 1\n}\nmodule text {\n  export const two = 2\n}\n" +
		"function nested() {\n  module inner {\n    export const three = 3\n  }\n  return 3\n}\nmodule empty {}\n"
	program := parse(t, "/main.vibe", text)
	modules := find(program, "VibeModuleDeclaration")
	if len(modules) != 4 {
		t.Fatalf("%d module declarations, want 4", len(modules))
	}
	for i, want := range []string{"one", "two", "three", ""} {
		body := modules[i]["body"].(map[string]any)
		var names []string
		for _, node := range find(body, "Identifier") {
			names = append(names, node["name"].(string))
		}
		if strings.Join(names, " ") != want {
			t.Errorf("module %d declares %v, want %q", i, names, want)
		}
	}
	if got := sourceOf(text, modules[3]["body"].(map[string]any)); got != "{}" {
		t.Errorf("the empty body is %q", got)
	}
}

func TestASyntaxErrorInAModuleBodyHasItsLineAndColumn(t *testing.T) {
	for name, text := range map[string]string{
		"vibelang": "const a = 1\nmodule text {\n  export const b: string!Bad = \"b\"\n}\n",
		"nested":   "function f() {\n  module inner {\n    export const b: string!Bad = \"b\"\n  }\n}\n",
	} {
		_, failure := Parse("/main.vibe", text)
		if failure == nil {
			t.Errorf("%s: no error", name)
			continue
		}
		// TypeScript reads string! as JSDoc's non-null type and stops at Bad.
		if line, column := 3, strings.Index(strings.Split(text, "\n")[2], "Bad")+1; failure.Line != line || failure.Column != column || failure.Message != "',' expected." {
			t.Errorf("%s: error at %d:%d, want %d:%d: %s", name, failure.Line, failure.Column, line, column, failure.Message)
		}
	}
}

func TestTokensAndCommentsAreTheSourceText(t *testing.T) {
	for name, text := range forms {
		t.Run(name, func(t *testing.T) {
			text := "// leading\n" + text + "/** trailing */\n"
			program := parse(t, "/x.vibe", text)
			var pieces []map[string]any
			for _, key := range []string{"tokens", "comments"} {
				for _, piece := range program[key].([]any) {
					pieces = append(pieces, piece.(map[string]any))
				}
			}
			covered := make([]bool, len(text))
			for _, piece := range pieces {
				start, end := rangeOf(piece)
				value := piece["value"].(string)
				source := text[start:end]
				switch piece["type"] {
				case "Line":
					value = "//" + value
				case "Block":
					value = "/*" + value + "*/"
				case "PrivateIdentifier":
					value = "#" + value
				}
				if source != value {
					t.Errorf("%s %q at %d is %q in the source", piece["type"], value, start, source)
				}
				for i := start; i < end; i++ {
					if covered[i] {
						t.Errorf("offset %d is in two tokens", i)
					}
					covered[i] = true
				}
			}
			for i, ch := range []byte(text) {
				if !covered[i] && !strings.ContainsRune(" \t\r\n", rune(ch)) {
					t.Errorf("%q at %d is in no token", ch, i)
				}
			}
			for _, node := range nodes(program) {
				if start, end := rangeOf(node); start < 0 || start > end || end > len(text) {
					t.Errorf("%s has range [%d, %d]", node["type"], start, end)
				}
			}
		})
	}
}

func TestVibeLangFormsHaveTheirOwnNodeTypes(t *testing.T) {
	want := map[string][]string{
		"contracts":    {"VibeEffectType"},
		"declarations": {"ClassDeclaration", "VariableDeclaration", "TSTypeLiteral", "PropertyDefinition"},
		"provide":      {"VibeProvideStatement", "VibeServiceProvider"},
		"catch":        {"VibeCatchExpression"},
		"pipes":        {"VibePipeExpression", "TopicReference"},
		"primitives":   {"VibeMaskStatement"},
		"modules":      {"VibeModuleDeclaration", "TSModuleBlock"},
		"data":         {"ClassDeclaration", "PropertyDefinition", "TSTypeLiteral", "TSTypeParameterDeclaration"},
	}
	for name, types := range want {
		seen := map[string]bool{}
		for _, node := range nodes(parse(t, "/x.vibe", forms[name])) {
			seen[node["type"].(string)] = true
		}
		for _, typ := range types {
			if !seen[typ] {
				t.Errorf("%s: no %s", name, typ)
			}
		}
	}
}

// TestSchemaAliasIsAConstantOfItsWrittenType pins D280's tree: const Name:
// Type, without the schema the parser wrote or the synthesized type alias.
func TestSchemaAliasIsAConstantOfItsWrittenType(t *testing.T) {
	text := "export schema Code = \"a\" | \"b\";\nschema Names = ReadonlyArray<string>\n"
	program := parse(t, "/x.vibe", text)
	body := program["body"].([]any)
	if len(body) != 2 {
		t.Fatalf("got %d statements, want 2", len(body))
	}
	exported := body[0].(map[string]any)
	if exported["type"] != "ExportNamedDeclaration" {
		t.Fatalf("got %s, want ExportNamedDeclaration", exported["type"])
	}
	for i, statement := range []map[string]any{exported["declaration"].(map[string]any), body[1].(map[string]any)} {
		if statement["type"] != "VariableDeclaration" || statement["kind"] != "const" {
			t.Fatalf("statement %d is %s %v, want a const", i, statement["type"], statement["kind"])
		}
		declarator := statement["declarations"].([]any)[0].(map[string]any)
		if declarator["init"] != nil {
			t.Errorf("statement %d has an initializer", i)
		}
		annotation := declarator["id"].(map[string]any)["typeAnnotation"].(map[string]any)["typeAnnotation"].(map[string]any)
		want := []string{"TSUnionType", "TSTypeReference"}[i]
		if annotation["type"] != want {
			t.Errorf("statement %d is typed %s, want %s", i, annotation["type"], want)
		}
		start, end := rangeOf(annotation)
		if got := text[start:end]; got != []string{"\"a\" | \"b\"", "ReadonlyArray<string>"}[i] {
			t.Errorf("statement %d's type is at %q", i, got)
		}
	}
	for _, node := range nodes(program) {
		if node["type"] == "TSTypeAliasDeclaration" || node["type"] == "CallExpression" {
			t.Errorf("a %s the parser wrote", node["type"])
		}
	}
}

// A schema reads the value each field's type reference names, so the
// projection writes that reference as typeof Name, a value reference to
// scope analysis (foldkit-12); a reference with type arguments and a plain
// error's field stay type references.
func TestSchemaFieldReferencesReadTheirValues(t *testing.T) {
	text := "const Names = Schema.Tuple([Schema.String, Schema.String])\n" +
		"export schema Locale { names: Names; list: ReadonlyArray<Names>; nested: { inner: Lib.Codes }; kind: \"a\" | Names }\n" +
		"schema Alias = Names\n" +
		"schema error Bad { code: Names }\n" +
		"error Plain { code: Names }\n"
	program := parse(t, "/x.vibe", text)
	queries := map[string]int{}
	references := map[string]int{}
	for _, node := range nodes(program) {
		switch node["type"] {
		case "TSTypeQuery":
			start, end := rangeOf(node["exprName"].(map[string]any))
			queries[text[start:end]]++
		case "TSTypeReference":
			start, end := rangeOf(node["typeName"].(map[string]any))
			references[text[start:end]]++
		}
	}
	if queries["Names"] != 5 || queries["Lib.Codes"] != 1 || len(queries) != 2 {
		t.Errorf("value references %v, want Names 5 times (four schema fields and the alias) and Lib.Codes once", queries)
	}
	if references["ReadonlyArray"] != 1 || references["Names"] != 1 || len(references) != 2 {
		t.Errorf("type references %v, want ReadonlyArray and the plain error's Names", references)
	}
}

func TestSynthesizedNamesAreMarkedOrLeftOut(t *testing.T) {
	for name, text := range forms {
		for _, node := range nodes(parse(t, "/x.vibe", text)) {
			if node["type"] == "Identifier" && strings.HasPrefix(node["name"].(string), "$") && node["synthesized"] != true {
				t.Errorf("%s: %s is synthesized but not marked", name, node["name"])
			}
			if node["type"] == "CatchClause" && node["param"] != nil {
				if param := node["param"].(map[string]any); strings.HasPrefix(param["name"].(string), "$") {
					t.Errorf("%s: a catch clause binds %s", name, param["name"])
				}
			}
			if node["type"] == "LabeledStatement" {
				t.Errorf("%s: a synthesized label", name)
			}
			if node["type"] == "IfStatement" {
				if test := node["test"].(map[string]any); test["synthesized"] == true || test["type"] == "Literal" && test["value"] == true {
					t.Errorf("%s: an if statement tests a synthesized %v", name, test["name"])
				}
			}
		}
	}
}

func TestRangesCountUTF16CodeUnits(t *testing.T) {
	text := "const s = \"é😀\"; const after = 1\n"
	program := parse(t, "/x.vibe", text)
	for _, node := range nodes(program) {
		if node["type"] == "Identifier" && node["name"] == "after" {
			start, end := rangeOf(node)
			if got := utf16Slice(text, start, end); got != "after" {
				t.Errorf("after is at %q", got)
			}
			return
		}
	}
	t.Fatal("no identifier after")
}

func TestTokenTypesFollowTypescriptEstree(t *testing.T) {
	text := "const v = o.default + this.x >> 1 / 2; const r = /a\\/b/g; const s = `a${1}b`; const p = v |> %\n"
	tokens := map[string]string{}
	for _, token := range parse(t, "/x.vibe", text)["tokens"].([]any) {
		token := token.(map[string]any)
		tokens[token["value"].(string)] = token["type"].(string)
	}
	want := map[string]string{
		"default": "Identifier", "this": "Keyword", ">>": "Punctuator", "/a\\/b/g": "RegularExpression",
		"`a${": "Template", "}b`": "Template", "|>": "Punctuator", "%": "Punctuator", "const": "Keyword",
	}
	for value, typ := range want {
		if tokens[value] != typ {
			t.Errorf("token %q is %q, want %q", value, tokens[value], typ)
		}
	}
}

func TestASyntaxErrorHasItsLineAndColumn(t *testing.T) {
	_, failure := Parse("/x.vibe", "const a = 1\nconst é = (\n")
	if failure == nil {
		t.Fatal("no error")
	}
	if failure.Line != 3 || failure.Column != 1 {
		t.Errorf("error at %d:%d, want 3:1: %s", failure.Line, failure.Column, failure.Message)
	}
}

func TestLoneSurrogatesSurviveAsEscapes(t *testing.T) {
	tree, failure := Parse("/x.ts", `const s = "\ud800a"`)
	if failure != nil {
		t.Fatal(failure)
	}
	if !strings.Contains(tree, `"value":"\ud800a"`) {
		t.Errorf("the literal's value lost its surrogate: %s", tree)
	}
}

// TestDataDeclarationIsAClassOfItsVariants pins D307's tree: class Name<T>
// with a property per variant, typed by its fields, and without the
// constant, the interface, or the type alias the parser wrote.
func TestDataDeclarationIsAClassOfItsVariants(t *testing.T) {
	text := dataFile
	program := parse(t, "/x.vibe", text)
	body := program["body"].([]any)
	if len(body) != 3 {
		t.Fatalf("got %d statements, want 3", len(body))
	}
	exported := body[0].(map[string]any)
	if exported["type"] != "ExportNamedDeclaration" || exported["exportKind"] != "value" {
		t.Fatalf("got %s %v, want an ExportNamedDeclaration of a value", exported["type"], exported["exportKind"])
	}
	for i, class := range []map[string]any{exported["declaration"].(map[string]any), body[1].(map[string]any)} {
		if class["type"] != "ClassDeclaration" {
			t.Fatalf("declaration %d is %s, want ClassDeclaration", i, class["type"])
		}
		var variants []string
		for _, member := range class["body"].(map[string]any)["body"].([]any) {
			m := member.(map[string]any)
			start, end := rangeOf(m)
			variants = append(variants, m["type"].(string)+" "+text[start:end])
		}
		want := [][]string{
			{"PropertyDefinition Waiting", "PropertyDefinition Sent { tracking: string; note?: string }"},
			{"PropertyDefinition Full { value: A }", "PropertyDefinition Empty"},
		}[i]
		if strings.Join(variants, "|") != strings.Join(want, "|") {
			t.Errorf("declaration %d's variants are %q, want %q", i, variants, want)
		}
	}
	if params := body[1].(map[string]any)["typeParameters"]; params == nil {
		t.Errorf("Box has no type parameters")
	}
	for _, node := range nodes(program) {
		if node["type"] == "TSTypeAliasDeclaration" || node["type"] == "TSInterfaceDeclaration" {
			t.Errorf("a %s the parser wrote", node["type"])
		}
		if node["type"] == "Identifier" && (node["name"] == "taggedEnum" || node["name"] == "BoxDefinition") {
			t.Errorf("%s, which the parser wrote", node["name"])
		}
	}
}

func TestErrorClassesReadAsTheirSource(t *testing.T) {
	classes := map[string]map[string]any{}
	for _, node := range nodes(parse(t, "/x.vibe", forms["error classes"])) {
		if node["type"] == "ClassDeclaration" {
			classes[node["id"].(map[string]any)["name"].(string)] = node
		}
	}
	text := forms["error classes"]
	members := func(name string) []string {
		var out []string
		for _, member := range classes[name]["body"].(map[string]any)["body"].([]any) {
			m := member.(map[string]any)
			start, end := rangeOf(m)
			desc := m["type"].(string) + " " + text[start:end]
			if m["readonly"] == true {
				desc += " (readonly)"
			}
			out = append(out, desc)
		}
		return out
	}
	want := map[string][]string{
		"AppError": {
			"PropertyDefinition _tag: string (readonly)",
			"PropertyDefinition code: string (readonly)",
			"PropertyDefinition static readonly family = \"app\" (readonly)",
			"MethodDefinition constructor(code: string) { super({ code }) }",
			"MethodDefinition get label(): string { return this.code }",
		},
		"NotFound": {
			"PropertyDefinition path: string;",
			"MethodDefinition describe(): string { return this.path }",
		},
		"Timeout": nil,
		"Http": {
			"PropertyDefinition status: number; (readonly)",
			"TSAbstractMethodDefinition abstract describe(): string",
		},
		"FsError": {
			"PropertyDefinition _tag: string; (readonly)",
			"PropertyDefinition method: string; (readonly)",
			"PropertyDefinition path?: string",
		},
		"Missing": {"PropertyDefinition attempts: number (readonly)"},
	}
	for name, members_ := range want {
		if classes[name] == nil {
			t.Fatalf("no class %s", name)
		}
		if got := strings.Join(members(name), "\n"); got != strings.Join(members_, "\n") {
			t.Errorf("%s:\n%s\nwant:\n%s", name, got, strings.Join(members_, "\n"))
		}
	}
	for name, base := range map[string]any{"AppError": nil, "NotFound": "AppError", "Timeout": "AppError", "Missing": "FsError", "FsError": nil} {
		superClass, _ := classes[name]["superClass"].(map[string]any)
		switch {
		case base == nil && superClass != nil:
			t.Errorf("%s extends %v, want no superClass", name, superClass["name"])
		case base != nil && (superClass == nil || superClass["name"] != base):
			t.Errorf("%s: superClass %v, want %v", name, superClass, base)
		}
	}
	if implements := classes["AppError"]["implements"].([]any); len(implements) != 1 {
		t.Errorf("AppError implements %d, want Coded", len(implements))
	}
	if classes["Http"]["abstract"] != true {
		t.Errorf("Http is abstract")
	}
	if start, end := rangeOf(classes["Timeout"]); text[start:end] != "error Timeout extends AppError" {
		t.Errorf("Timeout spans %q", text[start:end])
	}
}

// service Name: Type (D281) is a class with no superclass of its own and the
// written shape as its superclass's type argument, so a rule and scope
// analysis read the shape where TypeScript has it.
func TestServiceOfAShapeKeepsItsShape(t *testing.T) {
	text := forms["service shapes"]
	shapes := map[string]string{}
	for _, node := range nodes(parse(t, "/x.vibe", text)) {
		if node["type"] == "Identifier" && node["name"] == "$service" {
			t.Errorf("the synthesized $service is in the tree")
		}
		if node["type"] != "ClassDeclaration" {
			continue
		}
		name := node["id"].(map[string]any)["name"].(string)
		if node["superClass"] != nil {
			t.Errorf("%s: a superclass %v", name, node["superClass"])
		}
		arguments, ok := node["superTypeArguments"].(map[string]any)
		if !ok {
			t.Errorf("%s: no superTypeArguments", name)
			continue
		}
		params := arguments["params"].([]any)
		if len(params) != 1 {
			t.Fatalf("%s: %d type arguments", name, len(params))
		}
		start, end := rangeOf(params[0].(map[string]any))
		shapes[name] = params[0].(map[string]any)["type"].(string) + " " + text[start:end]
	}
	if shapes["Prefix"] != "TSStringKeyword string" || shapes["Search"] != "TSTypeReference SearchApi" {
		t.Errorf("shapes: %v", shapes)
	}
}
