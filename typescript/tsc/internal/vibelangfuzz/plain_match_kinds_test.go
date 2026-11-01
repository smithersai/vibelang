package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const plainMatchKindsTarget = "FuzzPlainMatchKinds"

// Chapter 1 and VIP-1; foldkit-72, foldkit-65 and foldkit-3.
const plainMatchKindQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."
const plainMatchUnrunQuote = "neither keyword: plain JavaScript; returns the Effect unrun"

func TestPlainMatchKindsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), plainMatchKindQuote) {
		t.Fatalf("Chapter 1 no longer says %q", plainMatchKindQuote)
	}
	if !strings.Contains(SpecText("../vips/0001-effect-and-async-functions.md"), plainMatchUnrunQuote) {
		t.Fatalf("VIP-1 no longer says %q", plainMatchUnrunQuote)
	}
}

type plainMatchShape struct {
	name    string
	prelude string
	params  string
	returns string
	vibe    string // the match expression a plain function returns
	native  string // the TypeScript expression with the same value
}

func plainMatchShapes() []plainMatchShape {
	tree := "type Tree = { readonly _tag: \"Leaf\" } | { readonly _tag: \"Node\"; readonly left: Tree; readonly right: Tree };\n"
	return []plainMatchShape{
		{"non-recursive", "", "n: number", "string", "match (n) { when 0: \"zero\"; default: \"other\"; }", "n === 0 ? \"zero\" : \"other\""},
		{"recursive-string", "", "n: number", "string", "match (n) { when 0: \"done\"; default: probe(n - 1); }", "n === 0 ? \"done\" : probe(n - 1)"},
		{"recursive-tree", tree, "t: Tree", "number", "match (t) { when { _tag: \"Leaf\" }: 0; when { _tag: \"Node\", left: let l, right: let r }: 1 + Math.max(probe(l), probe(r)); }", "t._tag === \"Leaf\" ? 0 : 1 + Math.max(probe(t.left), probe(t.right))"},
		{"mutual", "export const other = (n: number): boolean => n === 0 ? false : probe(n - 1);\n", "n: number", "boolean", "match (n) { when 0: true; default: other(n - 1); }", "n === 0 ? true : other(n - 1)"},
		{"callback", "", "xs: readonly number[]", "string[]", "xs.map((x): string => match (x) { when 0: \"zero\"; default: \"many\"; })", "xs.map((x): string => x === 0 ? \"zero\" : \"many\")"},
		{"program-arms-succeed", "import { Effect, Option } from \"effect\";\n", "program: Effect.Effect<number>, o: Option.Option<number>", "Effect.Effect<number>", "match (o) { when Option.Some(let v): Effect.succeed(v); when Option.None: program; }", "Option.isSome(o) ? Effect.succeed(o.value) : program"},
		{"program-arms-effect-block", "import { Effect, Option } from \"effect\";\n", "program: Effect.Effect<number>, o: Option.Option<number>", "Effect.Effect<number>", "match (o) { when Option.Some(let v): effect { return v }; when Option.None: program; }", "Option.isSome(o) ? Effect.succeed(o.value) : program"},
	}
}

func plainMatchHomes() []string { return []string{"concise-arrow", "block-arrow", "function"} }

func plainMatchProgram(shape plainMatchShape, home string, native bool) string {
	expression := shape.vibe
	if native {
		expression = shape.native
	}
	var declaration string
	switch home {
	case "concise-arrow":
		declaration = "export const probe = (" + shape.params + "): " + shape.returns + " => " + expression + ";\n"
	case "block-arrow":
		declaration = "export const probe = (" + shape.params + "): " + shape.returns + " => { return " + expression + " };\n"
	case "function":
		declaration = "export function probe(" + shape.params + "): " + shape.returns + " { return " + expression + " }\n"
	default:
		panic("unknown plain home")
	}
	return shape.prelude + declaration
}

// A function with neither keyword is plain whatever its body contains: a
// native match that recurses, runs in a callback or selects program values
// is an ordinary expression, and the function neither runs an Effect nor
// becomes one. The oracle expects no diagnostics at all; the TypeScript
// control with the same value proves each shape is otherwise valid.
func FuzzPlainMatchKinds(f *testing.F) {
	startShortBudget(f)
	shapes := plainMatchShapes()
	homes := plainMatchHomes()
	for _, shape := range shapes {
		for i := range homes {
			f.Add(shape.name, uint8(i))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, home uint8) {
		TestPlainMatchKindsQuoted(t)
		index := slices.IndexFunc(shapes, func(s plainMatchShape) bool { return s.name == name })
		if index < 0 {
			if name == "" {
				return
			}
			index = int(name[0]) % len(shapes)
		}
		shape := shapes[index]
		homeName := homes[int(home)%len(homes)]
		key := fmt.Sprintf("%s:%s", shape.name, homeName)
		for _, native := range []bool{true, false} {
			source := plainMatchProgram(shape, homeName, native)
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "check plain match kind", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if !HasError(result.Diagnostics) {
				continue
			}
			if native {
				t.Fatalf("invalid native plain-function control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			Gap(t, plainMatchKindsTarget, key, "Chapter 1 kind by keyword and VIP-1 unrun return: a plain %s returning a native match must compile, got %v\n%s", homeName, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		ExpectPending(t, plainMatchKindsTarget, key)
		ExpectPending(t, plainMatchKindsTarget, specCorpusKey(t))
	})
}
