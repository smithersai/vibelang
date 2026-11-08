package vibelangfuzz

import (
	"slices"
	"strings"
)

const decoderModeNeverRow = "| `new TextDecoder().decode(bytes)`, or `decoder.decode(bytes)` with `const decoder = new TextDecoder(\"utf-8\", { ignoreBOM: true })` | `never` | call directly |"
const decoderModeThrowRow = "| `decoder.decode(bytes)` with `decoder` a parameter, a `let`, or made with `fatal: true` | `TypeError` | `try Effect.try(() => decoder.decode(bytes))` |"

// The chapter-level matrix uses the same receiver/options model as the
// standalone property, so its coverage quotes follow the installed rule.
func failuresTextDecoderModeCases() []*failCase {
	var cases []*failCase
	for _, receiverName := range []string{"inline", "const", "local-const", "let", "parameter"} {
		for _, optionsName := range []string{"none", "bom", "false", "true"} {
			receiver := textDecoderReceivers[receiverName]
			args := textDecoderOptions[optionsName]
			never := slices.Contains(textDecoderKnown, receiverName) && slices.Contains(textDecoderReplacing, optionsName)
			quote, code := decoderModeNeverRow, 0
			if !never {
				quote, code = decoderModeThrowRow, 401
			}
			decls := strings.ReplaceAll(receiver.module, "ARGS", args) + "declare const bytes: Uint8Array\n"
			body := strings.ReplaceAll(receiver.body, "ARGS", args)
			if !never {
				if receiverName == "parameter" {
					decls = strings.Replace(decls, "decoder.decode(bytes)", "⟦decoder.decode(bytes)⟧", 1)
				} else {
					body = "⟦" + body + "⟧"
				}
			}
			cases = append(cases, &failCase{Name: "textdecoder-mode-" + receiverName + "-" + optionsName, VIP: 4, Quote: quote, Host: "plain", Decls: decls, Body: body, Code: code, OneDiagnostic: !never})
		}
	}
	cases = append(cases, &failCase{Name: "textdecoder-mode-wrapped", VIP: 4, Quote: decoderModeThrowRow, Host: "effect", Decls: "declare const decoder: TextDecoder\ndeclare const bytes: Uint8Array\n", Body: "return try Effect.try(()=>decoder.decode(bytes))"})
	return cases
}
