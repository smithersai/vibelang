package compiler

import (
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkNativeFormatter(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	formatter := backend.(SourceFormatter)
	for _, vector := range []struct{ name, source, want string }{
		{"ordinary spacing", "export function f(x:number):number{\nreturn x+1\n}\n", "export function f(x: number): number {\n  return x + 1\n}\n"},
		{"conditional declaration", "if(const x=41;x>0){\nconsole.log(x)\n}\n", "if (const x = 41; x > 0) {\n  console.log(x)\n}\n"},
		{"ASI return", "function f() {\n  return\n  1\n}\n", "function f() {\n  return\n  1\n}\n"},
		{"ASI prefix", "function f(x: number) {\n  x\n  ++x\n}\n", "function f(x: number) {\n  x\n  ++x\n}\n"},
		{"CRLF", "function f(){\r\nreturn 42\r\n}\r\n", "function f() {\r\n  return 42\r\n}\r\n"},
		{"empty", "", ""},
		{"whitespace only", " \t\n \t\n", ""},
		{"trim", "const x = 1 \t\n\n\n", "const x = 1\n"},
		{"shebang", "#!/usr/bin/env node\nconst x=1\n", "#!/usr/bin/env node\nconst x = 1\n"},
		{"Unicode mask widths", "if(const x='é猫🐱';x!==''){\nconsole.log(x)\n}\n", "if (const x = 'é猫🐱'; x !== '') {\n  console.log(x)\n}\n"},
		{"mask comment", "if(const x=1;/* keep */x>0){\nx\n}\n", "if (const x = 1;/* keep */x > 0) {\n  x\n}\n"},
		// Current upstream preserves the gap before a multiline template rather
		// than inserting one. The literal bytes, not 5.9's spacing preference,
		// are the language-preservation obligation. Both layouts are fixed points.
		{"literal whitespace", "const a='a  b'\nconst b=`line\n   tail`\nconst c=/a  b/g\n", "const a = 'a  b'\nconst b =`line\n   tail`\nconst c = /a  b/g\n"},
	} {
		t.Run(vector.name, func(t *testing.T) {
			result, err := formatter.Format(ctx, FormatRequest{Text: vector.source, FileName: "relative label: " + vector.name})
			if err != nil || !result.OK || result.Code != vector.want || result.Changed != (vector.source != vector.want) {
				t.Fatalf("got=%+v err=%v\nwant=%q", result, err, vector.want)
			}
			again, err := formatter.Format(ctx, FormatRequest{Text: result.Code})
			if err != nil || !again.OK || again.Changed || again.Code != result.Code {
				t.Fatalf("not idempotent: %+v, %v", again, err)
			}
		})
	}
	for _, source := range []string{
		"const = ;", "const value = (", "function f(){return value orelse 0}",
		"if (const x = () => { if (const y = 1; y) {} }; x) {}",
	} {
		t.Run("refuse "+source, func(t *testing.T) {
			result, err := formatter.Format(ctx, FormatRequest{Text: source})
			if err != nil || result.OK || result.Changed || result.Code != source || len(result.Diagnostics) == 0 {
				t.Fatalf("result=%+v err=%v", result, err)
			}
		})
	}
	for _, newLine := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		t.Run("authored diagnostic "+newLine, func(t *testing.T) {
			prefix := "// 🐱" + newLine + "const "
			result, err := formatter.Format(ctx, FormatRequest{Text: prefix + "= ;"})
			if err != nil || result.OK || len(result.Diagnostics) != 1 {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			item := result.Diagnostics[0]
			if item.Line != 2 || item.Column != 7 || item.Start != len(utf16.Encode([]rune(prefix))) {
				t.Fatalf("wrong authored position: %+v", item)
			}
		})
	}
	for _, indent := range []int{-1, 0, 9} {
		t.Run("invalid indent", func(t *testing.T) {
			_, err := formatter.Format(ctx, FormatRequest{Text: "const x=1", IndentSize: &indent})
			if err == nil || !strings.Contains(err.Error(), "indentSize") {
				t.Fatal(err)
			}
		})
	}
	t.Run("native option ownership", func(t *testing.T) {
		indent := 4
		result, err := formatter.Format(ctx, FormatRequest{Text: "function f(){\nreturn 1\n}", IndentSize: &indent, NewLine: "\r\n"})
		if err != nil || !result.OK || !strings.Contains(result.Code, "    return 1") || !strings.HasSuffix(result.Code, "\r\n") {
			t.Fatalf("result=%+v err=%v", result, err)
		}
		if _, err := formatter.Format(ctx, FormatRequest{NewLine: "\r"}); err == nil {
			t.Fatal("accepted invalid newline option")
		}
	})
	for name, source := range map[string]string{
		"source units":           strings.Repeat(" ", 4*1024*1024+1),
		"conditional mask count": strings.Repeat("if(const x=1;x) {}\n", 1025),
	} {
		t.Run("budget "+name, func(t *testing.T) {
			result, err := formatter.Format(ctx, FormatRequest{Text: source})
			if err != nil || result.OK || result.Changed || result.Code != source || len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "VIBE1900" {
				t.Fatalf("lost budget refusal: ok=%v err=%v diagnostics=%+v", result.OK, err, result.Diagnostics)
			}
		})
	}
	t.Run("formatting preserves native checked lowering", func(t *testing.T) {
		const source = "export function main():number{\nif(const value=41;value>0){return value+1}\nreturn 0\n}"
		formatted, err := formatter.Format(ctx, FormatRequest{Text: source})
		if err != nil || !formatted.OK {
			t.Fatalf("%+v %v", formatted, err)
		}
		compile := func(text string) string {
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: text}},
				Lowering: LoweringInternal, Options: Options{"target": "ES2022", "module": "ESNext"}})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			return artifactTextsByPath(t, result.Artifacts)["main.js"]
		}
		before, after := compile(source), compile(formatted.Code)
		if before == "" || before != after {
			t.Fatalf("native emit changed:\n%s\n---\n%s", before, after)
		}
	})
}

func TestPinnedForkNativeTokenLookup(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	formatter := backend.(SourceFormatter)
	for _, vector := range []struct {
		name, source string
		offset       int
		want         string
	}{
		{"identifier", "const value = 42", 8, "value"},
		{"caret at end", "value   ", 5, "value"},
		{"gap", "value   ", 6, ""},
		{"next token starts", "value()", 5, "("},
		{"before document", "value", -1, ""},
		{"after document", "value", 8, ""},
		{"comment", "// value\n42", 4, ""},
		{"shebang", "#!/usr/bin/env node\nvalue", 10, ""},
		{"Unicode UTF16", "// 🐱\nvalue", 8, "value"},
		{"literal astral interior", "'🐱'", 2, "'🐱'"},
		{"regular expression", "const x = /a  b/g", 13, "/a  b/g"},
		{"template substitution", "`a ${value} b`", 7, "value"},
		{"template tail", "`a ${value} b`", 12, "} b`"},
	} {
		t.Run(vector.name, func(t *testing.T) {
			result, err := formatter.TokenAt(ctx, TokenRequest{Text: vector.source, Offset: vector.offset})
			if err != nil {
				t.Fatal(err)
			}
			if vector.want == "" {
				if result.Token != nil {
					t.Fatalf("invented token: %+v", result.Token)
				}
			} else if result.Token == nil || result.Token.Text != vector.want || result.Token.Start > vector.offset || result.Token.End < vector.offset || result.Token.Kind == "" {
				t.Fatalf("wrong token: %+v; want %q", result.Token, vector.want)
			}
		})
	}
}
