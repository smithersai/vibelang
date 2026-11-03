package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

var throwQuotes = []string{
	"Independent errors in native embedded expressions and types keep their native diagnostics.",
	"ASI can end a class field before the `*` of a following generator method.",
	`"throw" UnaryExpression[?Yield, ?Await] [lookahead ∉ ThrowExpressionInvalidPunctuator]`,
	"The expression production has no no-line-terminator restriction after `throw`.",
	"The operand and parent positions follow `UnaryExpression`;",
	"ECMAScript automatic semicolon insertion applies.",
	"ThrowExpressionInvalidPunctuator = ",
	`ArmBody = [lookahead ≠ "throw"] Expression | "throw" Expression`,
}

func throwChapter(t testing.TB) string {
	t.Helper()
	data, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, q := range throwQuotes {
		if !strings.Contains(text, q) {
			t.Fatalf("Appendix A no longer contains %q", q)
		}
	}
	return text
}
func TestThrowExpressionsQuoted(t *testing.T) { throwChapter(t) }

// A grammar oracle, read from Appendix A at runtime. Each quoted token in the
// production is forbidden; keyword operators absent from it remain allowed.
// No checker/runtime result is used to decide grammar validity.
func FuzzThrowExpressions(f *testing.F) {
	startShortBudget(f)
	chapter := throwChapter(f)
	prod := strings.SplitN(strings.SplitN(chapter, "ThrowExpressionInvalidPunctuator = ", 2)[1], "ExpressionStatement[", 2)[0]
	var ops []string
	for i, p := range strings.Split(prod, `"`) {
		if i%2 == 1 {
			ops = append(ops, p)
		}
	}
	operands := []struct{ key, text string }{
		{"name", "e"}, {"member", "e.value"}, {"call", "e()"}, {"new", "new E()"},
		{"delete", "delete e.value"}, {"prefix", "++e"}, {"plus", "+e"}, {"bitnot", "~e"},
		{"not", "!e"}, {"typeof", "typeof e"}, {"void", "void e"}, {"minus", "-e"},
		{"nested", "throw e"}, {"postfix", "e++"}, {"compound", "(a + b)"},
		{"comma-operand", "(a, b)"}, {"conditional-operand", "(a ? b : c)"},
	}
	places := []struct{ key, text string }{
		{"initializer", "const x = %s;"}, {"arrow", "const f = () => %s;"},
		{"default", "function f(x = %s) {}"}, {"coalesce", "const x = a ?? %s;"},
		{"conditional-first", "const x = a ? %s : b;"}, {"conditional-last", "const x = a ? b : %s;"},
		{"unary-parent", "const x = !%s;"}, {"return", "function f() { return %s; }"},
		{"parenthesized", "const x = (%s);"}, {"object", "const x = { value: %s };"},
		{"await-parent", "async function f() { return await %s; }"},
		{"array-last", "const x = [a, %s];"}, {"argument-last", "f(a, %s);"},
		{"delete-parent", "const x = delete %s;"}, {"typeof-parent", "const x = typeof %s;"},
		{"void-parent", "const x = void %s;"}, {"plus-parent", "const x = +%s;"},
		{"minus-parent", "const x = -%s;"}, {"bitnot-parent", "const x = ~%s;"},
		{"throw-parent", "const x = throw %s;"},
		{"class-field", "class C { value = %s; }"},
	}
	for _, o := range operands {
		for _, p := range places {
			f.Add("accept:"+o.key+":"+p.key, uint8(0))
			f.Add("accept:"+o.key+":"+p.key, uint8(1))
		}
	}
	for _, op := range ops {
		f.Add("reject:"+op, uint8(0))
		f.Add("reject:"+op, uint8(1))
		f.Add("match-direct:"+op, uint8(0))
		f.Add("match-direct:"+op, uint8(1))
	}
	for _, op := range []string{"in", "instanceof", "as", "satisfies"} {
		f.Add("keyword:"+op, uint8(0))
	}
	for _, op := range []string{"+", "-", "/"} {
		f.Add("asi:"+op, uint8(0))
		f.Add("asi:"+op, uint8(1))
	}
	f.Add("await:operand", uint8(0))
	for _, repo := range []string{"alchemy-streaming-source", "smithers-engine-subject", "t3code-crypto"} {
		f.Add("migration:"+repo, uint8(0))
		f.Add("migration:"+repo, uint8(1))
	}
	for _, key := range []string{"field", "arrow", "static", "private", "computed", "argument", "statement", "method-body"} {
		for mode := uint8(0); mode < 4; mode++ {
			f.Add("class-asi:"+key, mode)
		}
	}
	for _, key := range []string{"empty", "ordinary", "throw", "grouped", "asi", "class", "operator", "comma"} {
		f.Add("native-comment:"+key, uint8(0))
		f.Add("native-comment:"+key, uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		parts := strings.Split(key, ":")
		source := ""
		wantError := false
		wantStatements := 0
		wantMembers := 0
		switch parts[0] {
		case "native-comment":
			throwNativeDiagnosticIdentity(t, key, mode)
			return
		case "class-asi":
			variant := "field"
			if len(parts) > 1 {
				variant = parts[1]
			}
			expr := "throw " + operands[int(mode>>2)%len(operands)].text
			if variant == "argument" || variant == "statement" || variant == "method-body" {
				wantError = mode&1 == 0
				if !wantError {
					expr = "(" + expr + ")"
				}
				source = "const x = " + expr + "\n*f();"
				if variant == "argument" {
					source = "class C { value = f(" + expr + "\n*f()); }"
					wantMembers = 1
				}
				if variant == "method-body" {
					source = "class C { method() { " + source + " } }"
					wantMembers = 1
				}
			} else {
				field, method := "value = "+expr, "*method() {}"
				if variant == "arrow" {
					field = "value = () => " + expr
				}
				if variant == "static" {
					field = "static value = " + expr
				}
				if variant == "private" {
					method = "*#method() {}"
				}
				if variant == "computed" {
					method = "*[key]() {}"
				}
				gap := "\n"
				switch mode & 3 {
				case 1:
					gap = ";\n"
				case 2:
					gap = " "
					wantError = true
				case 3:
					gap = "\n/* trivia */ "
				}
				source = "class C { " + field + gap + method + " }"
				wantMembers = 2
			}

		case "match-direct":
			op := ops[int(mode)%len(ops)]
			if len(parts) > 1 {
				for _, candidate := range ops {
					if parts[1] == candidate {
						op = candidate
					}
				}
			}
			tail := " b"
			if op == "?" {
				tail = " b : c"
			}
			arm := "throw e " + op + tail
			if mode&1 != 0 {
				arm = "(" + arm + ")"
				wantError = true
			}
			source = "const x = match (n) { when 1: " + arm + "; default: 0; };"
		case "migration":
			expr := "throw new E()"
			wantError = mode&1 == 0
			if !wantError {
				expr = "(" + expr + ")"
			}
			switch {
			case len(parts) > 1 && parts[1] == "alchemy-streaming-source":
				source = "f(() => " + expr + ",);"
			case len(parts) > 1 && parts[1] == "t3code-crypto":
				source = "const impl = { randomBytes: n => n > 0 ? n : " + expr + ", digest: f };"
			default:
				source = "const impl = { run: () => " + expr + ", result: f };"
			}
		case "await":
			source = "async function f() { return throw await e; }"
		case "asi":
			op := "+"
			if len(parts) > 1 && (parts[1] == "-" || parts[1] == "/") {
				op = parts[1]
			}
			tail := op + "f();"
			if op == "/" {
				tail = "/f/.test(s);"
			}
			source = "const x = throw e\n" + tail
			wantStatements = 2
			if mode&1 != 0 {
				source = "f(throw e\n" + strings.TrimSuffix(tail, ";") + ");"
				wantError = true
				wantStatements = 0
			}
		case "reject":
			op := ops[int(mode)%len(ops)]
			if len(parts) > 1 {
				for _, candidate := range ops {
					if parts[1] == candidate {
						op = candidate
					}
				}
			}
			tail := " b"
			if op == "?" {
				tail = " b : c"
			}
			// Mutation covers trivia, nesting, and explicit operand-vs-throw grouping.
			gap := " "
			if mode&2 != 0 {
				gap = " /* trivia */ "
			}
			expr := "throw e" + gap + op + tail
			wantError = true
			if mode&1 != 0 {
				expr = "(throw e)" + gap + op + tail
				wantError = false
			}
			// An assignment target is never valid merely by parenthesizing a throw;
			// keep assignment operators on the rejection side of this grammar oracle.
			if strings.Contains(op, "=") && op != "<=" && op != ">=" && op != "==" && op != "!=" && op != "===" && op != "!==" && mode&1 != 0 {
				return
			}
			if op == "," && mode&1 != 0 {
				expr = "((throw e), b)"
			}
			source = "const x = " + expr + ";"
		case "keyword":
			op := "in"
			if len(parts) > 1 {
				for _, v := range []string{"in", "instanceof", "as", "satisfies"} {
					if v == parts[1] {
						op = v
					}
				}
			}
			source = "const x = throw e " + op + " B;"
		default:
			operand := operands[int(mode)%len(operands)]
			place := places[int(mode)%len(places)]
			if len(parts) > 1 {
				for _, v := range operands {
					if v.key == parts[1] {
						operand = v
					}
				}
			}
			if len(parts) > 2 {
				for _, v := range places {
					if v.key == parts[2] {
						place = v
					}
				}
			}
			gap := " "
			if mode&1 != 0 {
				gap = "\n"
			}
			source = fmt.Sprintf(place.text, "throw"+gap+operand.text)
		}
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		ds := file.Diagnostics()
		if wantError {
			found := false
			for _, d := range ds {
				if d.Source() == "EK" && d.Code() == 1010 {
					found = true
				}
			}
			if !found {
				Gap(t, "FuzzThrowExpressions", key, "proposal lookahead requires EK1010: %s; got %v", source, ds)
			}
		} else if len(ds) != 0 {
			Gap(t, "FuzzThrowExpressions", key, "proposal accepts: %s; got %v", source, ds)
		}
		if !wantError && wantMembers > 0 {
			members := file.Statements.Nodes[0].AsClassDeclaration().Members.Nodes
			if len(members) != wantMembers {
				Gap(t, "FuzzThrowExpressions", key, "ASI must keep %d class members: %s; got %d", wantMembers, source, len(members))
			}
		}
		if wantStatements > 0 && len(file.Statements.Nodes) != wantStatements {
			Gap(t, "FuzzThrowExpressions", key, "ASI must leave %d statements: %s; got %d", wantStatements, source, len(file.Statements.Nodes))
		}
	})
}

// Appendix B keeps native diagnostics native. Generate scanner TS1010 beside
// valid throw expressions and genuine EK1010 violations; their numeric codes
// coincide, but only the latter belongs in either mapper diagnostic channel.
func throwNativeDiagnosticIdentity(t *testing.T, key string, mode uint8) {
	prefixes := []struct {
		key, source string
		errors      int
	}{
		{"empty", "", 0}, {"ordinary", "const n = 1;", 0},
		{"throw", "const x = throw e;", 0},
		{"grouped", "const x = (throw e) + 1;", 0},
		{"asi", "const x = throw e\n+f();", 0},
		{"class", "class C { value = throw e; }", 0},
		{"operator", "const x = throw e + 1;", 1},
		{"comma", "const x = throw e, y = 0;", 1},
	}
	p := prefixes[int(mode>>1)%len(prefixes)]
	for _, candidate := range prefixes {
		if key == "native-comment:"+candidate.key {
			p = candidate
		}
	}
	gap := " "
	if mode&1 != 0 {
		gap = "\n/* closed */\n"
	}
	source := p.source + gap + "/* unfinished"
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	native := false
	for _, d := range file.Diagnostics() {
		if d.Code() == 1010 && d.Source() == "" {
			native = true
		}
	}
	if !native {
		t.Fatalf("unfinished comment must retain TS1010: %s: %v", source, file.Diagnostics())
	}
	ctx := vibelangmapper.FileContext{FileName: "/main.vibe", ModuleKey: "test/main"}
	for name, projected := range map[string]vibelangmapper.Projection{
		"checking":   vibelangmapper.Project(source, ctx),
		"executable": vibelangmapper.Executable(source, ctx),
	} {
		count := 0
		for _, d := range projected.Diagnostics {
			if d.Code == 1010 {
				count++
				if !strings.HasPrefix(d.Message, "A throw expression") {
					Gap(t, "FuzzThrowExpressions", key, "%s relabelled a native diagnostic: %s: %+v", name, source, d)
				}
			}
		}
		if count != p.errors {
			Gap(t, "FuzzThrowExpressions", key, "%s must retain %d genuine EK1010 errors, got %d: %s", name, p.errors, count, source)
		}
	}
}
