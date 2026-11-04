package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const layerDeclarationFixKey = "key:layer-declaration-fix\n"

// Chapter 7 supplies the preservation oracle; VIP-9 supplies the service
// spelling. FuzzFix already compares comments, contracts, cold execution,
// Exit and idempotence. Feed its existing oracle a keyed generator rather
// than add another runtime comparison.
func TestLayerDeclarationFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
	const quote = "The key is Effect's run-time identity for the service."
	if !strings.Contains(SpecText("../vips/0009-service-declarations.md"), quote) {
		t.Fatalf("VIP-9 no longer says %q", quote)
	}
}

func layerDeclarationFixShadowed(input string) bool {
	data := []byte(strings.TrimPrefix(input, layerDeclarationFixKey))
	return len(data) > 6 && data[6]&1 != 0
}

func layerDeclarationFixArchive(input string) string {
	data := []byte(strings.TrimPrefix(input, layerDeclarationFixKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	n := int(pick(0)) - 128
	setup := ""
	value := fmt.Sprint(n)
	switch pick(1) % 3 {
	case 1:
		setup = fmt.Sprintf("events.push(\"setup\")\nconst start = %d\n", n)
		value = "start"
	case 2:
		setup = fmt.Sprintf("const start = try Effect.succeed(%d)\n", n)
		value = "start"
	}
	if pick(4)&1 != 0 && setup != "" {
		setup = "const start = try Effect.fail(\"setup\")\n"
	}
	contract := "value: number"
	member := "readonly value = (events.push(\"member\"), " + value + ")"
	read := "(try Counter).value"
	if pick(2)&1 != 0 {
		contract = "value(): number!!"
		member = "effect value() { events.push(\"method\"); return " + value + " }"
		if pick(5)&1 != 0 {
			contract = "value(): number!string"
			member = "effect value() { throw \"member\" }"
		}
		read = "try (try Counter).value()"
	}
	exported := ""
	if pick(3)&1 != 0 {
		exported = "export "
	}
	source := fmt.Sprintf(`service Counter { static readonly key = "fuzz/Counter"; %s }
const events: string[] = []
%slayer Live: Counter {
 %s%s
}
export effect function main() {
 let result = 0
 provide Live { result = %s; }
 return result + ":" + events.join(",")
}
`, contract, exported, setup, member, read)
	if layerDeclarationFixShadowed(input) {
		prefix := "const Layer = { succeed() { return \"captured\" }, effect() { return \"captured\" } }\n"
		if len(data) > 7 {
			switch data[7] % 4 {
			case 1:
				prefix = "import type { Layer } from \"effect\"\n"
			case 2:
				prefix = "import type * as Layer from \"effect/Layer\"\n"
			case 3:
				prefix = "import * as ActualLayer from \"effect/Layer\"\nconst Layer: typeof ActualLayer = { ...ActualLayer, get succeed() { events.push(\"captured\"); return ActualLayer.succeed }, get effect() { events.push(\"captured\"); return ActualLayer.effect } }\n"
			}
		}
		source = prefix + source
	}
	return Archive(map[string]string{"main.vibe": source})
}
