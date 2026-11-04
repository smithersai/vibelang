package vibelangfuzz

import "fmt"

// The shared FuzzFix oracle checks the Chapter 7 quotation in
// TestOptionMatchFixQuoted, including type, runtime, and declaration preservation.
// Vary hidden payload aliases, generic interfaces, nested private names, local
// shadows, Some/None, and the selected callback's value.
func optionMatchPrivatePayloadArchive(data []byte) string {
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	declaration, payload, extra := "interface TextFile { readonly content: string }", "TextFile", ""
	switch pick(0) % 5 {
	case 1:
		declaration = "type TextFile = { readonly content: string }"
	case 2:
		declaration, payload = "interface TextFile<A> { readonly content: A }", "TextFile<string>"
	case 3:
		declaration = "interface Metadata { readonly size: number }; interface TextFile { readonly content: string; readonly metadata: Metadata }"
		extra = ", metadata: { size: 1 }"
	case 4:
		declaration = "export interface TextFile { readonly content: string }"
	}
	value := fmt.Sprintf("Option.some({ content: %q%s })", fmt.Sprintf("text-%d", pick(2)), extra)
	if pick(1)&1 != 0 {
		value = "Option.none()"
	}
	prefix := ""
	if pick(3)&1 != 0 {
		prefix = "type TextFile = { unrelated: number }; export type Local = TextFile;\n"
	}
	foreign := "import { Option } from \"effect\"\n" + declaration + "\nexport const file: Option.Option<" + payload + "> = " + value + ";\n"
	source := "import { file } from \"./foreign.js\"\n" + prefix +
		"export const text = Option.match(file, { onNone: (): string => \"none\", onSome: (file): string => file.content });\n" +
		"export function main() { return Effect.succeed(text); }\n"
	return Archive(map[string]string{"main.vibe": source, "foreign.ts": foreign})
}
