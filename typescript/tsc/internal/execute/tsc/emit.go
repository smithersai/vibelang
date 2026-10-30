package tsc

import (
	"context"
	"fmt"
	"io"
	"runtime"
	"slices"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/execute/incremental"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/tracing"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// FilterDiagnosticsForExitCodeCallback is invoked to filter diagnostics before
// exit-code determination. It allows external packages to exclude certain
// diagnostics from affecting the exit code while still reporting them.
var FilterDiagnosticsForExitCodeCallback func(*core.CompilerOptions, []*ast.Diagnostic) []*ast.Diagnostic

// RegisterFilterDiagnosticsForExitCodeCallback registers a callback to filter
// diagnostics for exit-code determination.
func RegisterFilterDiagnosticsForExitCodeCallback(cb func(*core.CompilerOptions, []*ast.Diagnostic) []*ast.Diagnostic) {
	FilterDiagnosticsForExitCodeCallback = cb
}

func GetTraceWithWriterFromSys(w io.Writer, locale locale.Locale, testing CommandLineTesting) func(msg *diagnostics.Message, args ...any) {
	if testing == nil {
		return func(msg *diagnostics.Message, args ...any) {
			fmt.Fprintln(w, msg.Localize(locale, args...))
		}
	} else {
		return testing.GetTrace(w, locale)
	}
}

type EmitInput struct {
	Sys                System
	ProgramLike        compiler.ProgramLike
	Program            *compiler.Program
	Config             *tsoptions.ParsedCommandLine
	ReportDiagnostic   DiagnosticReporter
	ReportErrorSummary DiagnosticsReporter
	Writer             io.Writer
	WriteFile          compiler.WriteFile
	CompileTimes       *CompileTimes
	Testing            CommandLineTesting
	TestingMTimesCache *collections.SyncMap[tspath.PathKey, time.Time]
	Tracing            *tracing.Tracing
}

func EmitAndReportStatistics(input EmitInput) (CompileAndEmitResult, *Statistics) {
	var statistics *Statistics
	result := EmitFilesAndReportErrors(input)
	if result.Status != ExitStatusSuccess {
		// compile exited early
		return result, nil
	}
	result.times.totalTime = input.Sys.SinceStart()

	if input.Config.CompilerOptions().Diagnostics.IsTrue() || input.Config.CompilerOptions().ExtendedDiagnostics.IsTrue() {
		var memStats runtime.MemStats
		// GC must be called twice to allow things to settle.
		runtime.GC()
		runtime.GC()
		runtime.ReadMemStats(&memStats)

		statistics = statisticsFromProgram(input, &memStats)
		statistics.Report(input.Writer, input.Testing)
	}

	// VibeLang: only errors make the exit status non-zero; warnings, such as
	// EK9204 and the EK48xx lint rules (D241), do not fail a build.
	diagnosticsForExitCode := result.Diagnostics
	if FilterDiagnosticsForExitCodeCallback != nil {
		diagnosticsForExitCode = FilterDiagnosticsForExitCodeCallback(input.Config.CompilerOptions(), result.Diagnostics)
	}
	hasErrors := slices.ContainsFunc(diagnosticsForExitCode, func(d *ast.Diagnostic) bool { return d.Category() == diagnostics.CategoryError })
	if result.EmitResult.EmitSkipped && hasErrors {
		result.Status = ExitStatusDiagnosticsPresent_OutputsSkipped
	} else if hasErrors {
		result.Status = ExitStatusDiagnosticsPresent_OutputsGenerated
	}
	return result, statistics
}

func EmitFilesAndReportErrors(input EmitInput) (result CompileAndEmitResult) {
	result.times = input.CompileTimes
	ctx := context.Background()

	allDiagnostics := compiler.GetDiagnosticsOfAnyProgram(
		ctx,
		input.ProgramLike,
		nil,
		false,
		func(ctx context.Context, file *ast.SourceFile) []*ast.Diagnostic {
			// Options diagnostics include global diagnostics (even though we collect them separately),
			// and global diagnostics create checkers, which then bind all of the files. Do this binding
			// early so we can track the time.
			if tr := input.Tracing; tr != nil {
				defer tr.Push(tracing.PhaseBind, "bindSourceFiles", nil, true)()
			}
			bindStart := input.Sys.Now()
			diags := input.ProgramLike.GetBindDiagnostics(ctx, file)
			result.times.bindTime = input.Sys.Now().Sub(bindStart)
			return diags
		},
		func(ctx context.Context, file *ast.SourceFile) []*ast.Diagnostic {
			if tr := input.Tracing; tr != nil {
				defer tr.Push(tracing.PhaseCheck, "checkSourceFiles", nil, true)()
			}
			checkStart := input.Sys.Now()
			diags := input.ProgramLike.GetSemanticDiagnostics(ctx, file)
			result.times.checkTime = input.Sys.Now().Sub(checkStart)
			if program, ok := input.ProgramLike.(*incremental.Program); ok {
				nestedEmitTime := program.TakeNestedEmitTime()
				if nestedEmitTime > result.times.checkTime {
					result.times.checkTime = 0
				} else {
					result.times.checkTime -= nestedEmitTime
				}
				result.times.emitTime += nestedEmitTime
			}
			return diags
		},
	)

	emitResult := &compiler.EmitResult{EmitSkipped: true, Diagnostics: []*ast.Diagnostic{}}
	if !input.ProgramLike.Options().ListFilesOnly.IsTrue() {
		emitStart := input.Sys.Now()
		emitResult = input.ProgramLike.Emit(ctx, compiler.EmitOptions{
			WriteFile: input.WriteFile,
		})
		if input.Program != nil {
			// VibeLang: each .vibe module's x.d.vibe.ts, with the vibelang setting declarationSidecars.
			sidecars := input.Program.EmitDeclarationSidecars(ctx, func(fileName string, text string) error {
				return input.Sys.FS().WriteFile(tspath.RootedFilePathFromNormalized(fileName), text)
			})
			if emitResult != nil {
				emitResult.Diagnostics = append(emitResult.Diagnostics, sidecars...)
			}
		}
		result.times.emitTime += input.Sys.Now().Sub(emitStart)
	}
	if emitResult != nil {
		allDiagnostics = append(allDiagnostics, emitResult.Diagnostics...)
	}
	if input.Testing != nil {
		input.Testing.OnEmittedFiles(emitResult, input.TestingMTimesCache)
	}

	allDiagnostics = compiler.SortAndDeduplicateDiagnostics(allDiagnostics)
	for _, diagnostic := range allDiagnostics {
		input.ReportDiagnostic(diagnostic)
	}

	listFiles(input, emitResult)

	input.ReportErrorSummary(allDiagnostics)
	result.Diagnostics = allDiagnostics
	result.EmitResult = emitResult
	result.Status = ExitStatusSuccess
	return result
}

func listFiles(input EmitInput, emitResult *compiler.EmitResult) {
	if input.Testing != nil {
		input.Testing.OnListFilesStart(input.Writer)
		defer input.Testing.OnListFilesEnd(input.Writer)
	}
	options := input.Program.Options()
	if options.ListEmittedFiles.IsTrue() {
		for _, file := range emitResult.EmittedFiles {
			fmt.Fprintln(input.Writer, "TSFILE:", file.AsString())
		}
	}
	if options.ExplainFiles.IsTrue() {
		input.Program.ExplainFiles(input.Writer, input.Config.Locale(), input.Sys.GetCurrentDirectory())
	} else if options.ListFiles.IsTrue() || options.ListFilesOnly.IsTrue() {
		for _, file := range input.Program.GetSourceFiles() {
			if file.EmbeddedModule() != nil {
				continue // a VibeLang module declaration's body, which is not a file (D283)
			}
			fmt.Fprintln(input.Writer, file.FileName())
		}
	}
}
