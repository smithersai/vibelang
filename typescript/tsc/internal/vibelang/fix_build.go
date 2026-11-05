package vibelang

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/execute/build"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// fixBuild repairs each project's own sources/configs in the compiler's build
// order. The ordinary build follows in cmd/tsc; repair writes no emitted output.
func fixBuild(ctx context.Context, sys tsc.System, args []string, options FixOptions) int {
	command := tsoptions.ParseBuildCommandLine(args, sys.FS(), sys.GetCurrentDirectory())
	if len(command.Errors) > 0 {
		return 0
	} // the compilation reports invalid options
	if command.CompilerOptions.Watch.IsTrue() {
		fmt.Fprintln(sys.ErrorWriter(), "vibelang --fix: --watch cannot be combined with --fix; run vibelang -p <tsconfig> --fix for each project.")
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	if command.CompilerOptions.Help.IsTrue() || command.BuildOptions.Dry.IsTrue() || command.BuildOptions.Clean.IsTrue() {
		return 0
	}
	if ctx.Err() != nil {
		fmt.Fprintln(sys.ErrorWriter(), "vibelang --fix: interrupted before project repairs.")
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	graph := build.NewOrchestrator(build.Options{Sys: sys, Command: command})
	graph.GenerateGraph(nil)
	if len(graph.GraphDiagnostics()) > 0 {
		return 0
	} // the normal build reports cycles
	order := graph.Order()
	scopes, err := buildFixScopes(sys, command, order, options)
	if err != nil {
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: %v\n", err)
		return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
	}
	refused := false
	for i, project := range order {
		if ctx.Err() != nil {
			fmt.Fprintln(sys.ErrorWriter(), "vibelang --fix: interrupted before project repairs.")
			return int(tsc.ExitStatusInvalidProject_OutputsSkipped)
		}
		local := options
		if options.Only != nil {
			local.Only = scopes[project]
			if len(local.Only) == 0 {
				continue
			}
		}
		fmt.Fprintf(sys.ErrorWriter(), "vibelang --fix: project %s (%d/%d).\n", relativeName(sys, project), i+1, len(order))
		status := fixSingleProject(ctx, sys, project, command.CompilerOptions, local)
		if status == FixStatusRefused {
			refused = true
			continue
		}
		if status != 0 {
			return status
		}
	}
	if refused {
		return FixStatusRefused
	}
	return 0
}

// Resolve the whole --only list before any project writes. Then give each
// project's existing gate only the listed modules that project actually owns.
func buildFixScopes(sys tsc.System, command *tsoptions.ParsedBuildCommandLine, order []tspath.RootedFilePath, options FixOptions) (map[tspath.RootedFilePath][]tspath.RootedFilePath, error) {
	if options.Only == nil {
		return nil, nil
	}
	scope := newFixScope(sys.FS(), options.Only)
	if len(scope.listed) == 0 {
		return nil, fmt.Errorf("--only lists no file")
	}
	found := map[tspath.PathKey]bool{}
	scopes := map[tspath.RootedFilePath][]tspath.RootedFilePath{}
	for _, project := range order {
		path := sys.FS().CaseSensitivity().PathKey(project.AsPath())
		config, _ := tsoptions.GetParsedCommandLineOfConfigFilePath(project, path, command.CompilerOptions, nil, sys.FS(), &tsc.ExtendedConfigCache{})
		if config == nil {
			continue
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(sys.FS(), sys.DefaultLibraryPath(), nil, nil, nil)})
		for _, file := range scope.fixable(program) {
			key := scope.key(file.FileName())
			found[key] = true
			scopes[project] = append(scopes[project], scope.listed[key])
		}
	}
	var missing []string
	for key, name := range scope.listed {
		if !found[key] {
			missing = append(missing, name.AsString())
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing)
		return nil, fmt.Errorf("--only lists files that are not .vibe modules of these build projects: %s", strings.Join(missing, ", "))
	}
	return scopes, nil
}
