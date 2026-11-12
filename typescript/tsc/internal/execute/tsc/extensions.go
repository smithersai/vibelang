package tsc

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
)

// Identity names a compiler built on this one in --version and --help.
type Identity struct {
	Command     string                         // the command the --help examples run, such as "esc"
	Title       string                         // the --help title, after which the options follow
	Version     string                         // the line --version prints
	Icon        string                         // the two letters in the --help header's icon, such as "ES"
	HelpOptions []*tsoptions.CommandLineOption // help-only additions or replacements by name
	Commands    []HelpCommand                  // the compiler's own subcommands, listed in --help before its flags
}

// HelpCommand is one subcommand that --help lists: the example commands and
// what they do.
type HelpCommand struct {
	Examples    []string
	Description string
}

// helpCommands returns the identified compiler's subcommands, or none.
func helpCommands() []HelpCommand {
	if identity != nil {
		return identity.Commands
	}
	return nil
}

var identity *Identity

// SetIdentity makes --version and --help name the compiler id describes. Call
// it only from the init function of an in-tree package that tsc/cmd/tsc
// imports; it is not synchronized.
func SetIdentity(id Identity) {
	identity = &id
}

func versionText(locale locale.Locale) string {
	if identity != nil {
		return identity.Version
	}
	return diagnostics.Version_0.Localize(locale, core.Version())
}

func helpTitle(locale locale.Locale) string {
	if identity != nil {
		return identity.Title
	}
	return diagnostics.X_tsc_Colon_The_TypeScript_Compiler.Localize(locale) + " - " + diagnostics.Version_0.Localize(locale, core.Version())
}

// helpExample rewrites a --help example that runs tsc to run the identified
// command instead.
func helpExample(example string) string {
	if identity != nil && (example == "tsc" || strings.HasPrefix(example, "tsc ")) {
		return identity.Command + example[len("tsc"):]
	}
	return example
}

func helpIcon() string {
	if identity != nil {
		return identity.Icon
	}
	return "TS"
}
