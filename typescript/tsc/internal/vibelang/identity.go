package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/lsp"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
)

// Version is the VibeLang version of this compiler. It matches the
// version in packages/compiler/package.json.
const Version = "0.0.11"

// The binary built from tsc/cmd/tsc is VibeLang's compiler, vibelang, under
// any file name, so --version and --help say so and name the TypeScript
// version it is built on:
//
//	$ vibelang --version
//	VibeLang 0.0.11 (TypeScript 7.1.0-dev)
func init() {
	base := "TypeScript " + core.Version()
	tsc.SetIdentity(tsc.Identity{
		Command:     "vibelang",
		Title:       "vibelang: The VibeLang Compiler - Version " + Version + " (" + base + ")",
		Version:     "VibeLang " + Version + " (" + base + ")",
		Icon:        "EK",
		HelpOptions: helpOptions(),
	})
	// The language server's initialize response names it too.
	lsp.SetServerInfo("vibelang", Version+" ("+base+")")
}

// Help metadata stays separate from the option parser: the entry point handles
// these commands itself, and vibelang is a tsconfig setting rather than a flag.
func helpOptions() []*tsoptions.CommandLineOption {
	var options []*tsoptions.CommandLineOption
	for _, flag := range []struct{ name, description string }{
		{"fix", "Apply safe quick fixes to the project before compiling; incompatible with --build and --watch."},
		{"lsp", "Start the language server (use --lsp --stdio)."},
		{"stdio", "Use standard input and output for the language server (after --lsp)."},
		{"estree", "Parse a .vibe file from stdin and print its ESTree JSON: --estree <file>."},
		{"write-dprint-plugin", "Write the dprint process plugin for a package: --write-dprint-plugin <directory>."},
		{"loader-root", "Type-check and emit only the .vibe files under a directory, as a module loader's compile does: --loader-root <directory>."},
	} {
		options = append(options, &tsoptions.CommandLineOption{
			Name:                     flag.name,
			Kind:                     tsoptions.CommandLineOptionTypeBoolean,
			IsCommandLineOnly:        true,
			ShowInSimplifiedHelpView: true,
			Category:                 diagnostics.Command_line_Options,
			Description:              diagnostics.NewAdHocMessage(flag.description),
		})
	}
	options = append(options, &tsoptions.CommandLineOption{
		Name:                     "vibelang",
		Kind:                     tsoptions.CommandLineOptionTypeObject,
		IsTSConfigOnly:           true,
		ShowInSimplifiedHelpView: true,
		Category:                 diagnostics.Language_and_Environment,
		Description:              diagnostics.NewAdHocMessage("Configure diagnostics and trusted packages in tsconfig.json (config only)."),
		DefaultValueDescription:  "{}",
	})
	return options
}
