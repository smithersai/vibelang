package parser

import "slices"

// VibeLangKeywords are the words the parser reads as VibeLang syntax in a
// .vibe file where TypeScript reads an identifier. Each is a keyword only
// where its form stands, so `const data = 1` and `x.match(y)` still parse,
// but an Effect export with one of these names is not a global; a .vibe file
// writes it Effect.match (VIP-6, internal/effectglobals). A form that reads a
// new word adds it here; TestVibeLangKeywordsCoverParser fails until it does.
var VibeLangKeywords = slices.Concat(vibelangDeclarationWords, vibelangMaskWords, []string{
	"effect",                               // effect functions and blocks (VIP-1, VIP-2)
	"fork", "join", "select", "concurrent", // the fiber forms (D166-D170, vibelang_fibers.go)
	"provide", "handle", // provide blocks (D173) and handle statements (D132)
	"match", "when", "and", "or", "not", // pattern matching (VIP-7, vibelang_match.go)
})

// vibelangDeclarationWords start a VibeLang declaration when an identifier
// follows on the same line (isVibeLangDeclarationWord).
var vibelangDeclarationWords = []string{"error", "service", "control", "layer", "schema", "data"}

// vibelangMaskWords start an interruption block when a block follows on the
// same line (isVibeLangMaskWord, D180).
var vibelangMaskWords = []string{"uninterruptible", "restore", "interruptible"}
