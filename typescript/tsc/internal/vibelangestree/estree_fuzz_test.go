package vibelangestree

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf16"
	"unicode/utf8"
)

// FuzzESTreeInvariants fuzzes vibelangestree.Parse across .vibe, .vibex, .ts,
// and .tsx inputs and enforces universal structural invariants:
//
//   - Parse never panics on arbitrary or malformed UTF-8 input.
//   - On failure, no partial JSON tree is returned and error coordinates stay in bounds.
//   - On success, the JSON decodes to a Program whose every node range lies within
//     [0, utf16Len(text)].
//   - Every non-synthesized AST child range is contained within its parent's range (#610).
//   - Tokens and comments are non-overlapping, match exact UTF-16 source slices,
//     and cover every non-whitespace character in the input.
func FuzzESTreeInvariants(f *testing.F) {
	for _, text := range forms {
		f.Add(uint8(0), text)
		f.Add(uint8(1), text)
	}
	extraSeeds := []string{
		"const r = x is 1\nconst s = next() is 0 or 1\n",
		"export schema File { source: Held; items: ReadonlyArray<Held>; opt?: Held }\n",
		"export schema Alias = Held[]\nexport schema error FileErr { source: Held }\n",
		"export effect function run(xs: string[]) { for concurrent(2) (const x of xs) { try work(x) } }\n",
		"export effect function run(xs: string[]) { for concurrent (const x of xs) { try work(x) } }\n",
		"export effect function run() { const { 1n: x } = obj; return x }\n",
		"export function f(x: unknown) { return match (x) { when { 1n: let v }: v; when 0 or 1: 1; default: 0; } }\n",
		"export effect function f() { return try.all [a(), b()] }\n",
		"export effect function f() { const g = fork.scoped work(); return join g }\n",
		"export effect function f() { provide Store = impl { uninterruptible { restore { return try work() } } } }\n",
		"export effect function* gen() { yield 1; try sleep(\"1 second\"); yield 2 }\n",
		"export function pipe(n: number) { return n |> % + 1 |> String(%) }\n",
		"export const el = <Box value={1} />;\n",
		"export type Effect = { x: number }\nexport const y: Effect = { x: 1 }\n",
		"class Sub extends Base { effect m() { return try (super.m)() } }\n",
		"// leading é😀\r\nexport schema U { a: string }\r\n/** trailing */\r\n",
		"export function broken(",
		"match (x) { when : }",
		"{match(0){when !0}}",
		"0()is 0 or ",
		"0&0()is 0 or ",
		"cons,A000()is 0 or ",
		"error A extends 0{0 0()}",
		"const A=0()is 0 or ",
		"#!/usr/bin/env node\nexport const x = 1\n",
		"error {",
	}
	for _, seed := range extraSeeds {
		f.Add(uint8(0), seed)
		f.Add(uint8(1), seed)
	}
	f.Add(uint8(2), "export const x: number = 1\n")
	f.Add(uint8(3), "export const el = <div />\n")

	f.Fuzz(func(t *testing.T, ext uint8, text string) {
		if !utf8.ValidString(text) || len(text) > 16<<10 {
			return
		}
		fileName := [...]string{"/fuzz.vibe", "/fuzz.vibex", "/fuzz.ts", "/fuzz.tsx"}[ext%4]
		tree, failure := Parse(fileName, text)
		u16 := utf16.Encode([]rune(text))
		u16Len := len(u16)
		if failure != nil {
			if tree != "" {
				t.Fatalf("%s: Parse returned both tree and failure (%v)", fileName, failure)
			}
			if failure.Message == "" {
				t.Fatalf("%s: failure has empty message", fileName)
			}
			if failure.Line < 1 || failure.Column < 1 {
				t.Fatalf("%s: failure has non-positive line:col %d:%d", fileName, failure.Line, failure.Column)
			}
			if failure.Index < 0 || failure.Index > u16Len {
				t.Fatalf("%s: failure index %d out of [0, %d]", fileName, failure.Index, u16Len)
			}
			return
		}

		var program map[string]any
		if err := json.Unmarshal([]byte(tree), &program); err != nil {
			t.Fatalf("%s: invalid JSON: %v\nsource:\n%s", fileName, err, text)
		}
		if program["type"] != "Program" {
			t.Fatalf("%s: root type = %v, want Program", fileName, program["type"])
		}

		checkESTreeRangesAndContainment(t, fileName, text, u16Len, program)
		checkESTreeTokensCoverSource(t, fileName, text, u16, program)
	})
}

func checkESTreeRangesAndContainment(t *testing.T, fileName, text string, u16Len int, program map[string]any) {
	t.Helper()
	var walk func(value any, parent map[string]any)
	walk = func(value any, parent map[string]any) {
		switch v := value.(type) {
		case map[string]any:
			typ, isNode := v["type"].(string)
			nextParent := parent
			if isNode {
				r, ok := v["range"].([]any)
				if !ok || len(r) != 2 {
					t.Fatalf("%s: %s missing [start,end] range\nsource:\n%s", fileName, typ, text)
				}
				start, end := int(r[0].(float64)), int(r[1].(float64))
				if start < 0 || start > end || end > u16Len {
					t.Fatalf("%s: %s has out-of-bounds range [%d, %d] (utf16Len=%d)\nsource:\n%s", fileName, typ, start, end, u16Len, text)
				}
				if parent != nil && v["synthesized"] != true && parent["synthesized"] != true {
					// Upstream typescript-estree gives TSJSDocNullableType /
					// TSJSDocNonNullableType a child TSTypeAnnotation starting at
					// child.Pos()-1 (convert.go:1528), matching stock typescript-estree.
					pType, _ := parent["type"].(string)
					if typ == "TSTypeAnnotation" && (pType == "TSJSDocNullableType" || pType == "TSJSDocNonNullableType") {
						goto next
					}
					pStart, pEnd := rangeOf(parent)
					if start < pStart || end > pEnd {
						t.Fatalf("%s: child %s [%d, %d] escapes parent %s [%d, %d]\nsource:\n%s",
							fileName, typ, start, end, parent["type"], pStart, pEnd, text)
					}
				}
			next:
				nextParent = v
			}
			for key, child := range v {
				if key == "tokens" || key == "comments" {
					continue
				}
				walk(child, nextParent)
			}
		case []any:
			for _, child := range v {
				walk(child, parent)
			}
		}
	}
	walk(program, nil)
}

func checkESTreeTokensCoverSource(t *testing.T, fileName, text string, u16 []uint16, program map[string]any) {
	t.Helper()
	covered := make([]bool, len(u16))
	for _, key := range []string{"tokens", "comments"} {
		list, ok := program[key].([]any)
		if !ok {
			t.Fatalf("%s: missing %s list", fileName, key)
		}
		for _, item := range list {
			piece := item.(map[string]any)
			start, end := rangeOf(piece)
			if start < 0 || start > end || end > len(u16) {
				t.Fatalf("%s: %s piece %v has out-of-bounds range [%d, %d]\nsource:\n%s", fileName, key, piece["type"], start, end, text)
			}
			value := piece["value"].(string)
			source := string(utf16.Decode(u16[start:end]))
			switch piece["type"] {
			case "Line":
				value = "//" + value
			case "Block":
				value = "/*" + value + "*/"
			case "PrivateIdentifier":
				value = "#" + value
			}
			if source != value {
				t.Fatalf("%s: %s %q at [%d,%d] is %q in source\nsource:\n%s", fileName, piece["type"], value, start, end, source, text)
			}
			for i := start; i < end; i++ {
				if covered[i] {
					t.Fatalf("%s: UTF-16 offset %d covered by two tokens/comments\nsource:\n%s", fileName, i, text)
				}
				covered[i] = true
			}
		}
	}
	// A leading #! shebang line is intentionally skipped as trivia, matching typescript-estree.
	shebangStart := 0
	if len(u16) > 0 && u16[0] == 0xfeff {
		shebangStart = 1
	}
	if shebangStart+1 < len(u16) && u16[shebangStart] == '#' && u16[shebangStart+1] == '!' {
		for j := shebangStart; j < len(u16); j++ {
			if u16[j] == '\n' || u16[j] == '\r' || u16[j] == 0x2028 || u16[j] == 0x2029 {
				break
			}
			covered[j] = true
		}
	}
	for i, cu := range u16 {
		if covered[i] {
			continue
		}
		// Skip whitespace, BOM, and UTF-16 surrogates inside whitespace/covered tokens.
		r := rune(cu)
		if strings.ContainsRune(" \t\r\n\v\f\u00a0\ufeff\u2028\u2029", r) {
			continue
		}
		// Ignore non-ASCII space separators (Zs) outside tokens.
		if cu >= 0x1680 {
			continue
		}
		t.Fatalf("%s: char %q (U+%04X) at UTF-16 offset %d is in no token or comment\nsource:\n%s", fileName, r, cu, i, text)
	}
}
