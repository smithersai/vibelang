package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

// VIP-41's oracle is the pinned proposal, not TypeScript's implementation.
// Examples are from the upstream explainer; remaining rows exercise each
// UnaryExpression operand and the ExpressionStatement lookahead restriction.
func TestTC39ThrowExpressions(t *testing.T) {
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
