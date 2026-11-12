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
const Version = "0.0.13"

// Revision is the source revision a release binary was built from. The
// release build sets it at link time (scripts/release/build-binaries.sh);
// every other build leaves it empty. No command prints it, so --version is
// the same for every build of a version: the release scripts find the
// revision in the binary's bytes, which tells two builds of one version apart.
var Revision string

// releaseRevision is read from Revision in init. That read is what keeps the
// linked value in the binary; the linker drops a variable nothing reads.
var releaseRevision string

// ReleaseRevision returns the revision this binary was built from, or "" for
// a build that is not a release build.
func ReleaseRevision() string { return releaseRevision }

// The binary built from tsc/cmd/tsc is VibeLang's compiler, vibelang, under
// any file name, so --version and --help say so and name the TypeScript
// version it is built on:
//
//	$ vibelang --version
//	VibeLang 0.0.13 (TypeScript 7.1.0-dev)
func init() {
	releaseRevision = Revision
	base := "TypeScript " + core.Version()
	tsc.SetIdentity(tsc.Identity{
		Command:     "vibelang",
		Title:       "vibelang: The VibeLang Compiler - Version " + Version + " (" + base + ")",
		Version:     "VibeLang " + Version + " (" + base + ")",
		Icon:        "EK",
		HelpOptions: helpOptions(),
		Commands:    helpCommands,
	})
	// The language server's initialize response names it too.
	lsp.SetServerInfo("vibelang", Version+" ("+base+")")
}

// helpCommands are the subcommands the vibelang command runs itself: lint in
// this binary (cmd/tsc), format and agents in the npm package's launcher
// (packages/compiler/bin/vibelang).
var helpCommands = []tsc.HelpCommand{
	{Examples: []string{"vibelang lint", "vibelang lint -p ./path/to/tsconfig.json"}, Description: "Type-checks the project and reports VibeLang's lint rules, and Effect's when compilerOptions.plugins names @effect/language-service, without writing files."},
	{Examples: []string{"vibelang format --check", "vibelang format --write src/main.vibe"}, Description: "Checks or rewrites the formatting of .vibe, .vibex and // @vibe TypeScript files."},
	{Examples: []string{"vibelang agents init"}, Description: "Sets up coding agents (Claude Code, Codex, opencode, Cursor, VS Code) for the .vibe files in a repository."},
}

// Help metadata stays separate from the option parser: the entry point handles
// these commands itself, and vibelang is a tsconfig setting rather than a flag.
func helpOptions() []*tsoptions.CommandLineOption {
	var options []*tsoptions.CommandLineOption
	for _, flag := range []struct{ name, description string }{
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
		Description:              diagnostics.NewAdHocMessage("Legacy diagnostics in tsconfig.json (config only); use vibe.severities for new settings."),
		DefaultValueDescription:  "{}",
	})
	return options
}
