package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	checker.RegisterDiagnosticsFilterHook(explainMissingPlatformTypes)
}

// missingPlatformTypes are TypeScript's codes that ask for host type
// definitions: TS2580 and TS2591 (@types/node) and TS2584 (lib dom).
var missingPlatformTypes = map[int32]bool{2580: true, 2584: true, 2591: true}

// explainMissingPlatformTypes adds a note to TypeScript's advice to install
// host types at a platform global in a .vibe file. Following that advice only
// trades the error for EK4402, so the note names the Effect replacement that
// EK4402 would name (Chapter 5, reaches the platform).
func explainMissingPlatformTypes(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || !missingPlatformTypes[d.Code()] {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil || !ast.IsIdentifier(name) {
			continue
		}
		key, ok := platformGlobals[name.Text()]
		if !ok {
			continue
		}
		next := note(d.Clone(), "In a .vibe file {0} is platform code: with those types installed it is EK4402, because VibeLang code does not use the platform directly.", name.Text())
		switch s := platformServices[key]; {
		case s == nil:
			note(next, "Move the platform code into a .ts module and expose it through an Effect.")
		case s.example != "":
			note(next, "Use {0}:   {1}", s.use, s.example)
		default:
			note(next, "Use {0}.", s.use)
		}
		all[i] = next
	}
	return all
}
