package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

// VIP-41's oracle is the pinned proposal, not TypeScript's implementation.
// Examples are from the upstream explainer; remaining rows exercise each
// UnaryExpression operand and the ExpressionStatement lookahead restriction.
func TestTC39ThrowExpressions(t *testing.T) {
	// rule-evidence: docs/design/src/900-appendices.md#14a6b6eeb644e7f2 — Chapter 900: throw unary operand and statement positions
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#77427b5bb65b125f
	// VIP-41: match direct throw full operand.
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#bafedb6cac1bddad
	// VIP-41: throw lookahead diagnostic identity.
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#7fcd54eef37d109b
	// VIP-41: throw expression newline.
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#4812c5e637af9179
	// VIP-41: throw as satisfies native grammar.
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#539a111ce09b3bd1
	// VIP-41: throw keyword operators.
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#47550a62224d5a6f
	// VIP-41: throw comma boundary.
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#a7fc984083a118ad
	// VIP-41: parenthesized throw before operator.
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#175cd2f67900ea1b
	// VIP-41: parenthesized throw operand.
	good := []string{
		`function save(filename = throw new TypeError("Argument required")) {}`,
		`lint(ast, { with: () => throw new Error("avoid using with statements") });`,
		`const encoder = encoding === "utf8" ? new UTF8Encoder() : throw new Error("Unsupported encoding");`,
		`class Product { set id(value) { this._id = value || throw new Error("Invalid value"); } }`,
		`const x = a ? throw b : c;`, `(throw (a, b));`, `(throw (a ? b : c));`,
		`const x = !throw e;`, `const x = typeof throw e;`, `const x = void throw e;`,
		`const x = throw throw e;`, `const x = throw -e;`, `const x = throw !e;`,
		`async function f() { return await throw e; }`,
		`async function f() { return throw await e; }`,
		`const x = throw delete obj.value;`, `const x = throw ++e;`,
		`const x = throw function () {};`,
		`const x = throw class {};`,
		`const x = throw /e/;`,
		`const x = throw { value: e };`,
		`const x = throw [e];`,
		`const x = throw (() => e);`,
		`function* f() { return throw (yield e); }`,
		`const x = +throw e;`,
		`const x = -throw e;`,
		`const x = ~throw e;`,
		`f(a, throw e);`,
		`const x = [a, throw e];`,
		`const x = { value: throw e };`,
		`const x = a ** throw e;`,
		`const x = <T>throw e;`,
		`const x = throw e.value;`, `const x = throw e();`, `const x = throw e++;`,
		`const x = (throw e) + 1;`, `const x = throw (e + 1);`,
		`const x = throw e in table;`, `const x = throw e instanceof E;`,
		`const x = throw e as E;`, `const x = throw e satisfies E;`,
		"const x = throw\ne;", "const x = throw e\n+f();",
		"const x = throw e\n/f/.test(s);", "const x = throw e\n<E>f;",
		`const x = match (a) { when 1: throw a + b; default: throw a, b; };`,
		`throw a ? b : c;`, `throw a, b;`, `throw a && b;`, `throw a || b;`,
	}
	for _, source := range good {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if ds := file.Diagnostics(); len(ds) > 0 {
				t.Fatalf("proposal accepts %q: %v", source, ds[0].String())
			}
		})
	}
	ops := strings.Fields(", < > <= >= == != === !== + - * / % ** << >> >>> & | ^ && || ?? = += -= *= /= %= **= <<= >>= >>>= &= |= ^= &&= ||= ??= ?")
	for _, op := range ops {
		tail := " b"
		if op == "?" {
			tail = " b : c"
		}
		for _, place := range []string{"const x = throw e%s;", "const x = a ?? throw e%s;", "f(throw e%s);"} {
			source := strings.Replace(place, "%s", " "+op+tail, 1)
			t.Run(source, func(t *testing.T) {
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
				found := false
				for _, d := range file.Diagnostics() {
					if d.Code() == 1010 {
						found = true
					}
				}
				if !found {
					t.Fatalf("proposal forbids %q: wanted EK1010, got %v", source, file.Diagnostics())
				}
			})
		}
	}
	for _, source := range []string{
		"f(throw e\n+f());", "const x = [throw e, b];",
		"const x = { value: throw e, next: b };",
		"const x = throw e, y = b;",
		"const x = throw e => e;",
		"function* f() { return throw yield e; }",
		"const x = new throw e;",
		"(throw a ? b : c);", "(throw a, b);", "(throw a && b);", "(throw a || b);",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) == 0 {
				t.Fatalf("proposal rejects %q", source)
			}
		})
	}
}

// The added unary dispatch remains confined to VibeLang files.
func TestTC39ThrowExpressionsNativeBoundary(t *testing.T) {
	source := "const x = !throw e;"
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/native.ts", PathKey: "/native.ts"}, source)
	if len(file.Diagnostics()) == 0 {
		t.Fatal("a TypeScript file accepted a proposal-only throw expression")
	}
	for _, d := range file.Diagnostics() {
		if d.Source() == "EK" {
			t.Fatalf("native syntax received a VibeLang code: %s", d.String())
		}
	}
}

// Once ASI succeeds, an invalid next statement keeps its own native diagnostic.
func TestTC39ThrowExpressionsASINativeError(t *testing.T) {
	source := "const x = throw e\n/[/;"
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	if len(file.Diagnostics()) == 0 {
		t.Fatal("the following unterminated regular expression must fail")
	}
	for _, d := range file.Diagnostics() {
		if d.Code() == 1010 {
			t.Fatalf("ASI succeeded; the following native error became EK1010: %s", d.String())
		}
	}
}

func TestTC39ThrowExpressionsASIStatements(t *testing.T) {
	source := "const x = a || throw e\n+f();"
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	if len(file.Diagnostics()) != 0 || len(file.Statements.Nodes) != 2 {
		t.Fatalf("ASI must leave two statements: diagnostics=%v statements=%d", file.Diagnostics(), len(file.Statements.Nodes))
	}
}

func TestTC39ThrowClassASI(t *testing.T) {
	for _, source := range []string{
		"class C { value = throw e\n*method() {} }",
		"class C { value = () => throw e\n*method() {} }",
		"class C { static value = throw e\n*method() {} }",
		"class C { value = throw e\n*#method() {} }",
		"class C { value = throw e\n*[key]() {} }",
		"class C { value = throw e\n/* trivia */ *method() {} }",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("proposal ASI accepts %q: %v", source, ds)
			}
			members := file.Statements.Nodes[0].AsClassDeclaration().Members.Nodes
			if len(members) != 2 || members[1].Kind != ast.KindMethodDeclaration {
				t.Fatalf("ASI must keep field and generator method separate: got %d members", len(members))
			}
		})
	}
	for _, source := range []string{
		"const x = throw e\n*f();",
		"class C { method() { const x = throw e\n*f(); } }",
		"class C { value = f(throw e\n*f()); }",
		"class C { value = throw e *method() {} }",
	} {
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		found := false
		for _, diagnostic := range file.Diagnostics() {
			found = found || diagnostic.Code() == 1010
		}
		if !found {
			t.Fatalf("proposal lookahead rejects %q: %v", source, file.Diagnostics())
		}
	}
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "class C { value = throw e\n*() {} }")
	if len(file.Diagnostics()) == 0 {
		t.Fatal("malformed generator method needs its native diagnostic")
	}
	for _, diagnostic := range file.Diagnostics() {
		if diagnostic.Code() == 1010 {
			t.Fatal("a method error after ASI is not a throw lookahead error")
		}
	}
}

// Every invalid punctuator reports an error; native TS1010 stays separate.
func TestEK1010PunctuatorSeverity(t *testing.T) {
	for _, tc := range []struct {
		source   string
		category diagnostics.Category
	}{
		{"const xs = [throw e, 1];", diagnostics.CategoryError},
		{"const obj = { value: cond ? x : throw E({ id: 1 }), };", diagnostics.CategoryError},
		{"f(cond ? x : throw E({ id: 1 }), 1);", diagnostics.CategoryError},
		{"const x = throw e + 1;", diagnostics.CategoryError},
		{"const x = a ?? throw e ? 1 : 2;", diagnostics.CategoryError},
		{"f(throw e\n+f());", diagnostics.CategoryError},
	} {
		t.Run(tc.source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, tc.source)
			count := 0
			for _, d := range file.Diagnostics() {
				if d.Source() == "EK" && d.Code() == parser.VibeLangThrowLookaheadCode {
					count++
					if d.Category() != tc.category {
						t.Errorf("EK1010 category = %v, want %v", d.Category(), tc.category)
					}
				}
			}
			if count != 1 {
				t.Fatalf("wanted one EK1010, got %d: %v", count, file.Diagnostics())
			}
		})
	}
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "const x = throw e; /* unfinished")
	for _, d := range file.Diagnostics() {
		if d.Code() == 1010 && d.Source() == "" && d.Category() == diagnostics.CategoryError {
			return
		}
	}
	t.Fatal("unfinished comment must remain native error TS1010")
}

// A throw with no operand, as an editor sees it mid-edit, is TypeScript's
// TS1109 "Expression expected", not EK1010, and must not crash the parser.
// FuzzGrammarAdmission found the crash: trivia between throw and a forbidden
// punctuator put the operand text's start past its end. The list leaves out
// tokens that start an operand: + - / < and %, a pipe's topic.
func TestTC39ThrowMissingOperand(t *testing.T) {
	ops := strings.Fields(", > <= >= == != === !== * ** << >> >>> & | ^ && || ?? = += -= *= %= **= <<= >>= >>>= &= |= ^= &&= ||= ??= ?")
	for _, op := range ops {
		for _, gap := range []string{" ", "  ", " /* c */ ", "\n", "\n  ", " // c\n"} {
			for _, place := range []string{"const x = throw%s%s b;", "f(throw%s%s b);", "class C { v = throw%s%s b }"} {
				source := strings.Replace(strings.Replace(place, "%s", gap, 1), "%s", op, 1)
				t.Run(source, func(t *testing.T) {
					file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
					expected := false
					for _, d := range file.Diagnostics() {
						if d.Code() == 1010 && d.Source() == "EK" {
							t.Fatalf("a missing operand is not a throw lookahead error: %s", d.String())
						}
						if d.Code() == 1109 {
							expected = true
						}
					}
					if !expected {
						t.Fatalf("want TS1109 Expression expected, got %v", file.Diagnostics())
					}
				})
			}
		}
	}
}
