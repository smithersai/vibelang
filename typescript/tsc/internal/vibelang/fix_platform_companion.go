package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

const platformCompanionMarker = "// Generated platform helpers for this VibeLang module.\n"

// One invocation owns one new companion per source. It can append to its
// verified overlay, but never edits a TypeScript file that already exists.
func platformCompanion(fs vfs.FS, file *ast.SourceFile, texts map[tspath.RootedFilePath]string) (tspath.RootedFilePath, string, string) {
	stem := strings.TrimSuffix(file.FileName().AsString(), ".vibe") + ".platform"
	name := tspath.RootedFilePath(stem + ".ts")
	previous := texts[name]
	for _, suffix := range []string{".ts", ".tsx", ".js", ".d.ts"} {
		if fs.FileExists(tspath.RootedFilePath(stem + suffix)) {
			if suffix == ".ts" && strings.HasPrefix(previous, platformCompanionMarker) {
				// The fix filesystem freezes previous reads for its Original
				// fields. Ownership comes from this run's fresh-file overlay,
				// not a comparison with that deliberately older disk view.
				continue
			}
			return name, "", "the sibling TypeScript module already exists; existing foreign files are never rewritten"
		}
	}
	if previous != "" && !strings.HasPrefix(previous, platformCompanionMarker) {
		return name, "", "the sibling TypeScript module is already reserved"
	}
	return name, previous, ""
}

func appendPlatformCompanion(previous, imports, helper string) string {
	if previous == "" {
		previous = platformCompanionMarker
	}
	if imports != "" && !strings.Contains(previous, imports) {
		previous = platformCompanionMarker + imports + strings.TrimPrefix(previous, platformCompanionMarker)
	}
	return previous + helper
}

// A parameterized sync callback may move with its inputs. The original input
// expressions remain arguments at the original call site, in order; only
// their already evaluated values cross into the factory. References from
// inside the callback still obey the existing capture/receiver checks.
func platformWrapperInputs(c *checker.Checker, file *ast.SourceFile, call *ast.Node) (params, inputs, tail, why string) {
	args := call.Arguments()
	if len(args) < 2 || !(ast.IsArrowFunction(args[0]) || ast.IsFunctionExpression(args[0])) {
		return "", "", "", "the wrapper has no literal callback with explicit inputs"
	}
	if why = platformWrapperCaptureWithInputs(c, file, call, true); why != "" {
		return
	}
	fresh := &freshNames{file: file}
	var parameters, expressions []string
	var edits []sourceEdit
	base := call.Expression().End()
	for i, arg := range args[1:] {
		if ast.IsSpreadElement(arg) {
			return "", "", "", "the wrapper spreads its inputs"
		}
		name := fresh.freshName("$input" + strconv.Itoa(i))
		parameters = append(parameters, name+": "+c.TypeToStringEx(c.GetTypeAtLocation(arg), arg, checker.TypeFormatFlagsNoTruncation, nil))
		expressions = append(expressions, nodeText(file, arg))
		edits = append(edits, sourceEdit{nodeStart(file, arg) - base, arg.End() - base, name})
	}
	return strings.Join(parameters, ", "), strings.Join(expressions, ", "), applyEdits(file.Text()[base:call.End()], edits), ""
}
