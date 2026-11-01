package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatReturnTypesKey = "key:foldkit-written-return-types\n"

var formatReturnTypeKeys = []string{"simple", "nested", "generic", "union", "array", "generic-nested", "constructor", "conditional"}

const formatReturnTypesQuote = "It preserves inferred and declared public types, declarations and throws contracts"

//gate:spec-tests
func TestFormatReturnTypesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), formatReturnTypesQuote) {
		t.Fatalf("chapter 7 no longer says %q", formatReturnTypesQuote)
	}
}

func formatReturnTypesSource(source string) string {
	if !strings.HasPrefix(source, formatReturnTypesKey) {
		return source
	}
	tail := strings.TrimPrefix(source, formatReturnTypesKey)
	data := []byte(tail)
	if key, rest, found := strings.Cut(tail, "\n"); found {
		if index := slices.Index(formatReturnTypeKeys, key); index >= 0 {
			data = append([]byte{byte(index)}, []byte(rest)...)
		}
	}
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	types := []string{
		"() => string",
		"() => (() => string)",
		"<A>(a: A) => A",
		"(() => string) | undefined",
		"(() => string)[]",
		"<A>(a: A) => (() => A)",
		"new () => object",
		"true extends true ? (() => string) : never",
	}
	bodies := []string{
		"(): string => 'ok'",
		"(): (() => string) => (): string => 'ok'",
		"<A>(a: A): A => a",
		"undefined",
		"[]",
		"<A>(a: A): (() => A) => (): A => a",
		"class {}",
		"(): string => 'ok'",
	}
	index := int(pick(0)) % len(types)
	returned := types[index]
	if pick(1)&64 != 0 {
		returned = []string{
			"() => (/* leaf */ string /* leafEnd */)",
			"() => (() => (/* leaf */ string /* leafEnd */))",
			"<A>(a: A) => (/* leaf */ A /* leafEnd */)",
			"(() => (/* leaf */ string /* leafEnd */)) | undefined",
			"(() => (/* leaf */ string /* leafEnd */))[]",
			"<A>(a: A) => (() => (/* leaf */ A /* leafEnd */))",
			"new () => (/* leaf */ object /* leafEnd */)",
			"true extends true ? (() => (/* leaf */ string /* leafEnd */)) : never",
		}[index]
	}
	if pick(1)&4 != 0 {
		returned = "/* public */ " + returned + " /* result */"
	}
	for group := range 1 + int(pick(1)%3) {
		prefix, suffix := "", ""
		if pick(1)&16 != 0 {
			prefix = fmt.Sprintf("/* group%d */ ", group)
			suffix = fmt.Sprintf(" /* end%d */", group)
		}
		if pick(1)&128 != 0 {
			prefix = fmt.Sprintf("// group%d\n", group) + prefix
			suffix += fmt.Sprintf(" // end%d\n", group)
		}
		returned = "(" + prefix + returned + suffix + ")"
	}
	if pick(1)&32 != 0 {
		returned = "/* before */ " + returned + " /* after */"
	}
	result := fmt.Sprintf("export const make = (): %s => %s\n", returned, bodies[index])
	if pick(2)&1 != 0 {
		result = fmt.Sprintf("export function make(): %s { return %s }\n", returned, bodies[index])
	}
	if pick(1)&8 != 0 {
		result = "module publicApi {\n" + result + "}\n"
	}
	return result
}

// The AST oracle intentionally ignores redundant type parentheses. Compare
// declaration bytes as well: this Foldkit source grouping reaches public emit.
// Chapter 7 / VIP-34: "It preserves inferred and declared public types, declarations and throws contracts".
func FuzzFormatWrittenReturnTypes(f *testing.F) {
	startShortBudget(f)
	for _, key := range formatReturnTypeKeys {
		f.Add(key, byte(0), false)
		f.Add(key, byte(4), true)
		f.Add(key, byte(8), false)
		f.Add(key, byte(16), false)
		f.Add(key, byte(32), true)
		f.Add(key, byte(64), false)
		f.Add(key, byte(128), true)
		f.Add(key, byte(255), false)
	}
	w := NewWorkspace(f)
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, key string, groups byte, declaration bool) {
		index := slices.Index(formatReturnTypeKeys, key)
		if index < 0 {
			if len(key) == 0 {
				index = 0
			} else {
				index = int(key[0]) % len(formatReturnTypeKeys)
			}
			key = formatReturnTypeKeys[index]
		}
		var mode byte
		if declaration {
			mode = 1
		}
		source := formatReturnTypesSource(formatReturnTypesKey + key + "\n" + string([]byte{groups, mode}))
		toolsGuard(t, "FuzzFormatWrittenReturnTypes", func() {
			once, err := vibelangfmt.Format("main.vibe", source, formatter)
			if err != nil {
				Gap(t, "FuzzFormatWrittenReturnTypes", "return-type:refusal", "%v\n%s", err, source)
			}
			before := toolsCompile(t, w, "FuzzFormatWrittenReturnTypes", Single(source).Files)
			defer before.Remove()
			for _, diagnostic := range before.Diagnostics {
				if diagnostic.Category().Name() == "error" {
					t.Fatalf("invalid return-type generator: %s\n%s", diagnostic.String(), source)
				}
			}
			after := toolsRecompile(t, w, before, Single(once).Files)
			if difference := toolsFormatDifference(before, after); difference != "" {
				Gap(t, "FuzzFormatWrittenReturnTypes", "return-type:meaning", "%s\n%s\n%s", difference, source, once)
			}
			declarations := 0
			for name, text := range before.Outputs {
				if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
					declarations++
					if text != after.Outputs[name] {
						Gap(t, "FuzzFormatWrittenReturnTypes", "return-type:bytes:"+key, "%s\n%s\n%s\nbefore:\n%s\nafter:\n%s", formatReturnTypesQuote, source, once, text, after.Outputs[name])
					}
				}
			}
			if declarations == 0 {
				t.Fatal("declaration oracle emitted no declarations")
			}
			twice, err := vibelangfmt.Format("main.vibe", once, formatter)
			if err != nil || twice != once {
				Gap(t, "FuzzFormatWrittenReturnTypes", "return-type:idempotence", "%v\n%s\n%s", err, once, twice)
			}
		})
	})
}

func TestFormatReturnTypeGenerator(t *testing.T) {
	formatter := toolsFormatter(t)
	for kind := byte(0); kind < 8; kind++ {
		for _, groups := range []byte{0, 1, 2, 4, 8, 12, 16, 32, 64, 128, 255} {
			for mode := byte(0); mode < 2; mode++ {
				source := formatReturnTypesSource(formatReturnTypesKey + formatReturnTypeKeys[kind] + "\n" + string([]byte{groups, mode}))
				if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
					t.Fatalf("%s\n%s", syntax, source)
				}
				once, err := vibelangfmt.Format("main.vibe", source, formatter)
				if err != nil {
					t.Fatalf("%v\n%s", err, source)
				}
				twice, err := vibelangfmt.Format("main.vibe", once, formatter)
				if err != nil || once != twice {
					t.Fatalf("unstable: %v\n%s\n%s", err, once, twice)
				}
			}
		}
	}
}
