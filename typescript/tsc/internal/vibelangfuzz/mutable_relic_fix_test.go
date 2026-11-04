package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const mutableRelicFixKey = "key:mutable-relic:"
const mutableRelicDefaultQuote = "Ordinary interface and object-type properties, including optional members and index signatures, keep exactly the source's written `readonly` modifiers"

func TestMutableRelicFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), mutableRelicDefaultQuote) {
		t.Fatal(mutableRelicDefaultQuote)
	}
	if !strings.Contains(SpecText("003-failures.md"), "The tag is always the name, and every field is readonly.") {
		t.Fatal("VIP-13 error readonly rule")
	}
	TestMigrationDeclarationFixQuoted(t)
}

// Feed the existing FuzzFix declaration/type/Exit oracle, not another runtime
// comparison. Mutation varies ordinary property and index forms, holder,
// comments, payloads, names and optionality. Custom bodies stay out of scope.
func mutableRelicFixArchive(input string) string {
	key, data, _ := strings.Cut(strings.TrimPrefix(input, mutableRelicFixKey), "\n")
	if len(data) == 0 {
		data = "\x00"
	}
	pick := func(n int) byte { return data[n%len(data)] }
	number := int(pick(0))
	trivia := []string{" ", "\t", " /* keep marker comment */ ", " /* 😀 marker */ ", " /** field */ "}[pick(1)%5]
	if key == "error" {
		field := "value: number"
		if pick(2)&1 != 0 {
			field = "value?: number"
		}
		method := ""
		if pick(3)&1 != 0 {
			method = "get label(): number { return this.value ?? 0 }"
		}
		leading := ""
		if pick(5)&1 != 0 {
			leading = "/** payload */ "
			if pick(6)&1 != 0 {
				leading = "\n" + leading
			}
		}
		fixed := "fixed"
		if pick(4)&1 != 0 {
			fixed = "readonly"
		}
		matched := "match (other) { when Failure(let found): found.value; default: -1; }"
		if method != "" {
			matched = "value.label"
		}
		source := fmt.Sprintf("export error Failure { %smutable%s%s; %s?: string; %s }\nexport effect function main() { const value = new Failure({ value: %d }); const other = { _tag: \"Failure\", value: %d } as unknown as Failure; return [value.value, value._tag, %s]; }\n", leading, trivia, field, fixed, method, number, number+1, matched)
		return Archive(map[string]string{"main.vibe": source})
	}
	if key == "index" {
		keyType := "string"
		if pick(2)&1 != 0 {
			keyType = "number"
		}
		source := fmt.Sprintf("export interface Values {\n mutable%s[mutable: %s]: number }\nexport effect function main() { const values: Values = { 1: %d }; values[1] += 1; return values[1]; }\n", trivia, keyType, number)
		return Archive(map[string]string{"main.vibe": source})
	}
	name, optional := "value", ""
	if pick(2)&1 != 0 {
		name = "'value'"
		optional = "?"
	}
	prefix := ""
	if pick(4)&1 != 0 {
		prefix = "const key = \"value\" as const;\n"
		name, optional = "[key]", "?"
	}
	body := fmt.Sprintf("{\n /* field */ mutable%s%s%s: number; readonly fixed?: string; mutable?: boolean }", trivia, name, optional)
	holder := "export interface Values " + body
	if pick(3)&1 != 0 {
		holder = "export type Values = " + body
	}
	source := fmt.Sprintf("%s\nexport effect function main() { const values: Values = { value: %d }; values.value = %d; return values.value; }\n", holder, number, number+1)
	return Archive(map[string]string{"main.vibe": prefix + source})
}

func mutableRelicDeclarations(t *testing.T, before, after *Result) {
	t.Helper()
	count := 0
	for name, want := range before.Outputs {
		if !isDeclaration(name) {
			continue
		}
		count++
		if got, ok := after.Outputs[name]; !ok || got != want {
			Gap(t, "FuzzFix", "fix:mutable-relic:declaration-bytes", "Chapter 7: %s\n%s before:\n%s\nafter:\n%s", migrationDeclarationFixQuote, name, want, got)
		}
	}
	if count == 0 {
		t.Fatal("mutable rewrite did not emit declarations")
	}
}
