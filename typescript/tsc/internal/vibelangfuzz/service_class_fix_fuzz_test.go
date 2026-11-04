package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const serviceClassFixKey = "key:service-class-fix\n"

func TestServiceClassFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
	const quote = "The key is Effect's run-time identity for the service."
	if !strings.Contains(SpecText("../vips/0009-service-declarations.md"), quote) {
		t.Fatalf("VIP-9 no longer says %q", quote)
	}
}

// Reuse FuzzFix's comment, type, declaration and Exit oracles. Vary trivia,
// export visibility, service names and shape member types without changing
// the explicit key whose runtime identity the repair must retain.
func serviceClassFixArchive(input string) string {
	data := []byte(strings.TrimPrefix(input, serviceClassFixKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	separators := []string{" ", " /*keep*/ ", "\t/*first*/ /*second*/\t", "\u00a0/*unicode*/\u00a0"}
	separator := separators[int(pick(0))%len(separators)]
	name := []string{"Counter", "Users", "Settings"}[int(pick(1))%3]
	exported := ""
	if pick(2)&1 != 0 {
		exported = "export "
	}
	n := int(pick(3)) - 128
	typ, value := "number", fmt.Sprint(n)
	if pick(4)&1 != 0 {
		typ, value = "string", fmt.Sprintf("%q", fmt.Sprint(n))
	}
	source := fmt.Sprintf(`%sservice%sclass %s {
 static readonly key = "fuzz/decl-class"
 value: %s
}
export type Value = %s.Shape["value"]
const Live = Layer.succeed(%s, { value: %s })
export effect function main() {
 let result: Value = %s
 provide Live { result = (try %s).value; }
 return result
}
`, exported, separator, name, typ, name, name, value, value, name)
	return Archive(map[string]string{"main.vibe": source})
}
