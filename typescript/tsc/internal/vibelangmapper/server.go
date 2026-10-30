package vibelangmapper

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"maps"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"sync"

	"github.com/microsoft/TypeScript/tsc/internal/contentmapper"
	"github.com/microsoft/TypeScript/tsc/internal/ipc"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
)

// DiagnosticSource prefixes the code of every diagnostic the mapper reports,
// so EK9001 reads like the fork's own EK diagnostics.
const DiagnosticSource = "EK"

// VirtualExtension is the extension of every projected file: TypeScript
// checks greet.vibe as greet.vibe.ts.
const VirtualExtension = ".ts"

// Serve answers TypeScript's content mapper requests on rwc until the
// connection closes or ctx ends. TypeScript sends requests concurrently, and
// the connection handles each in its own goroutine; Project shares no state
// between calls, so transforms run in parallel.
func Serve(ctx context.Context, rwc io.ReadWriteCloser) error {
	return ipc.NewAsyncConn(rwc, &Handler{}).Run(ctx)
}

// Handler implements the content mapper protocol: initialize, openProject,
// transform and closeProject. The protocol is driven by TypeScript alone. A
// projection depends only on its file's text and context (FileContextOf),
// which reads package.json files that openProject reports as watched.
type Handler struct{}

// HandleRequest answers one protocol request.
func (h *Handler) HandleRequest(ctx context.Context, method string, params json.Value) (any, error) {
	switch method {
	case contentmapper.MethodInitialize:
		return initialize(params)
	case contentmapper.MethodOpenProject:
		return h.openProject(params)
	case contentmapper.MethodCloseProject:
		return nil, nil
	case contentmapper.MethodTransform:
		return h.transform(params)
	default:
		return nil, fmt.Errorf("vibelang-mapper: unknown method %q", method)
	}
}

// HandleNotification ignores notifications; the protocol defines none.
func (*Handler) HandleNotification(ctx context.Context, method string, params json.Value) error {
	return nil
}

// initialize selects UTF-8 positions, which are Go's string offsets, so
// the projector's byte offsets go on the wire unconverted.
func initialize(params json.Value) (any, error) {
	var p contentmapper.InitializeParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	if !slices.Contains(p.PositionEncodings, contentmapper.PositionEncodingUTF8) {
		return nil, fmt.Errorf("vibelang-mapper: the host does not accept utf-8 positions (offered %v)", p.PositionEncodings)
	}
	return contentmapper.InitializeResult{
		PositionEncoding: contentmapper.PositionEncodingUTF8,
		DiagnosticSource: DiagnosticSource,
	}, nil
}

// buildIdentity fingerprints the running mapper executable. TypeScript knows
// a mapper's code only by its package name and version, and
// vibelang-ts-mapper@0.0.1 names every VibeLang build, so openProject folds
// this into configIdentity: a new projector then invalidates what tsc
// --build and --incremental kept from the old one.
var buildIdentity = sync.OnceValue(func() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	file, err := os.Open(executable)
	if err != nil {
		return ""
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return ""
	}
	return hex.EncodeToString(hash.Sum(nil)[:16])
})

// openProject reports the package.json files whose names enter the
// project's module keys as watched files (the manifest declares
// dynamicConfig), with an identity of their names and of this build
// (buildIdentity), so a renamed package or a new mapper build invalidates
// every projection of the project. It also reports EK9004 when the project
// installs another version of effect or of an @effect package than the
// forms table was generated from (versionMismatch).
func (h *Handler) openProject(params json.Value) (any, error) {
	var p contentmapper.OpenProjectParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	files, identity := projectPackageFiles(p.ConfigFileName)
	result := contentmapper.OpenProjectResult{ConfigIdentity: buildIdentity() + ":" + identity, WatchedFiles: files}
	var options map[string]json.Value
	if len(p.Options) > 0 {
		if err := json.Unmarshal(p.Options, &options); err != nil || options == nil {
			result.OptionDiagnostics = append(result.OptionDiagnostics, contentmapper.OptionDiagnosticResult{
				Path: []json.Value{}, MessageText: "vibelang-ts-mapper's options must be an empty object.", Code: CodeInvalidOption,
			})
		} else {
			for _, key := range slices.Sorted(maps.Keys(options)) {
				result.OptionDiagnostics = append(result.OptionDiagnostics, contentmapper.OptionDiagnosticResult{
					Path:        []json.Value{json.Value(strconv.Quote(key))},
					MessageText: "Unknown vibelang-ts-mapper option " + strconv.Quote(key) + "; remove it.",
					Code:        CodeInvalidOption,
				})
			}
		}
	}
	if table, err := DefaultTable(); err == nil && p.ConfigFileName != "" {
		dir := path.Dir(filepath.ToSlash(p.ConfigFileName))
		if message := versionMismatch(table.Header, dir, os.ReadFile); message != "" {
			// A project-level diagnostic, on the mapper's tsconfig entry.
			result.OptionDiagnostics = append(result.OptionDiagnostics, contentmapper.OptionDiagnosticResult{
				Path:        []json.Value{},
				MessageText: message,
				Code:        CodeVersionMismatch,
			})
		}
	}
	return result, nil
}

// transform projects one file from its content and its context, with the
// context derived from its file name.
func (h *Handler) transform(params json.Value) (any, error) {
	var p contentmapper.TransformParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	return TransformResult(Project(p.Content, FileContextOf(p.FileName)))
}

// TransformResult encodes projection as the protocol's transform result.
func TransformResult(projection Projection) (contentmapper.TransformResult, error) {
	mappings, err := spanmap.New(projection.Segments).Marshal()
	if err != nil {
		return contentmapper.TransformResult{}, err
	}
	result := contentmapper.TransformResult{
		MappedOutput: contentmapper.MappedOutput{
			Text:      projection.Text,
			Extension: VirtualExtension,
			Mappings:  json.Value(mappings),
		},
	}
	for _, d := range projection.Diagnostics {
		result.Diagnostics = append(result.Diagnostics, contentmapper.Diagnostic{
			MessageText: d.Message,
			Start:       d.Start,
			Length:      d.Length,
			Code:        d.Code,
		})
	}
	return result, nil
}
