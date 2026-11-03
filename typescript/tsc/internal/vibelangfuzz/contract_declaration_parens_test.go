package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Alchemy's minimized (A!E!R) | X used to retain a redundant ParenthesizedType
// in declaration output. Chapter 1 requires the written contract's idiomatic
// Effect TypeScript declaration, including in surrounding TypeScript types.
const contractDeclarationQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

var contractDeclarationShapes = []string{
	"union", "intersection", "array", "tuple", "conditional", "generic", "indexed", "nested",
}

func requireContractDeclarationQuote(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("001-functions.md"), contractDeclarationQuote) {
		t.Fatal("Chapter 1 contract declaration quote changed")
	}
}

func TestContractDeclarationParensQuoted(t *testing.T) {
	requireContractDeclarationQuote(t)
}

// This reuses the compiler on two inputs whose declarations Chapter 1 says
// agree: a parenthesized contract and its explicit Effect TypeScript twin.
// Compare types through the shared tsc probe; redundant printed parentheses
// are formatting, while parentheses that change a type still fail the probe.
func FuzzContractDeclarationParens(f *testing.F) {
	startShortBudget(f)
	requireContractDeclarationQuote(f)
	w := NewWorkspace(f)
	for _, shape := range contractDeclarationShapes {
		for mode := byte(0); mode < 3; mode++ {
			f.Add([]byte(shape + "|" + string([]byte{mode, mode})))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		t.Parallel()
		key, tail, found := strings.Cut(string(data), "|")
		if !found {
			key = contractDeclarationShapes[contractDeclarationByte(data, 0)%byte(len(contractDeclarationShapes))]
			tail = string(data)
		}
		index := -1
		for i, shape := range contractDeclarationShapes {
			if key == shape {
				index = i
				break
			}
		}
		if index < 0 {
			return
		}
		mutation := []byte(tail)
		mode := contractDeclarationByte(mutation, 0) % 3
		depth := int(contractDeclarationByte(mutation, 1) % 3)
		value, failure, env := "string", "never", "never"
		if mode == 1 {
			value, failure = "number", "Failure"
		}
		if mode == 2 {
			value, failure, env = "{ readonly n: number }", "Failure | undefined", "Env"
		}
		vibe := "(" + value + "!" + failure + "!" + env + ")"
		twin := fmt.Sprintf("Effect.Effect<%s, %s, %s>", value, failure, env)
		wrap := func(contract string) string {
			switch key {
			case "union":
				return contract + " | number"
			case "intersection":
				return contract + " & { readonly label: string }"
			case "array":
				return contract + "[]"
			case "tuple":
				return "[" + contract + ", " + contract + "?]"
			case "conditional":
				return "T extends " + contract + " ? " + contract + " : number"
			case "generic":
				return "ReadonlyArray<" + contract + " | undefined>"
			case "indexed":
				return "{ task: " + contract + " }[\"task\"]"
			default:
				return "Readonly<{ tasks: Array<[" + contract + " | null]> }>"
			}
		}
		vibe, twin = wrap(vibe), wrap(twin)
		for i := 0; i < depth; i++ {
			vibe, twin = "ReadonlyArray<"+vibe+">", "ReadonlyArray<"+twin+">"
		}
		name := fmt.Sprintf("Program%d", contractDeclarationByte(mutation, 2))
		prefix := "import * as Effect from \"effect/Effect\"\ntype Failure = { readonly reason: string }\ntype Env = { readonly environment: unique symbol }\n"
		compile := func(filename, expression string) string {
			config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"types":[],"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":[%q]}`, filename)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{
				filename:       prefix + "export type " + name + "<T> = " + expression + "\n",
				"package.json": `{"type":"module"}`,
			}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("%s %s: %v", key, filename, d)
				}
			}
			for output, text := range result.Outputs {
				if strings.HasSuffix(output, "/main.d.ts") {
					return text
				}
			}
			t.Fatalf("%s: missing main.d.ts", filename)
			return ""
		}
		got, want := compile("main.vibe", vibe), compile("main.ts", twin)
		if diff := compareDeclarationTexts(t, want, got); diff != "" {
			Gap(t, "FuzzContractDeclarationParens", "shape:"+key,
				"Chapter 1: %s\nVibeLang:\n%s\nEffect TypeScript:\n%s\nAPI:\n%s", contractDeclarationQuote, got, want, diff)
		}
	})
}

func contractDeclarationByte(data []byte, index int) byte {
	if index < len(data) {
		return data[index]
	}
	return 0
}
