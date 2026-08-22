package compiler

import "context"

// APIVersion is the version of the compiler transport contract. Version 2
// added multi-file root sets with relative `.vibe` imports, the externally
// lowered request mode (LoweringExternal with per-file LoweredSource), and
// composed authored source maps in emitted artifacts.
const APIVersion = 2

// FileKind classifies a compiler input without tying extensions to a backend.
type FileKind string

const (
	FileKindTypeScript FileKind = "typescript"
	FileKindVibe       FileKind = "vibe"
	FileKindVibeJSX    FileKind = "vibe-jsx"
	FileKindAsset      FileKind = "asset"
)

// Phase identifies the compiler phase that produced a diagnostic or artifact.
type Phase string

const (
	PhaseParse    Phase = "parse"
	PhaseBind     Phase = "bind"
	PhaseCheck    Phase = "check"
	PhaseLower    Phase = "lower"
	PhaseEmit     Phase = "emit"
	PhaseComptime Phase = "comptime"
)

// DiagnosticCategory follows TypeScript's error/warning/suggestion/message shape.
type DiagnosticCategory string

const (
	DiagnosticError      DiagnosticCategory = "error"
	DiagnosticWarning    DiagnosticCategory = "warning"
	DiagnosticSuggestion DiagnosticCategory = "suggestion"
	DiagnosticMessage    DiagnosticCategory = "message"
)

// LoweringMode selects who lowers `.vibe` syntax before TypeScript checking.
type LoweringMode string

const (
	// LoweringIdentity accepts the TypeScript-shaped subset of VibeLang and
	// checks it through the fork's identity content mapper. Lowered fields must
	// be absent.
	LoweringIdentity LoweringMode = ""
	// LoweringExternal means an external frontend already lowered every `.vibe`
	// file. Each FileKindVibe SourceFile must carry a LoweredSource; the bridge
	// checks the lowered TypeScript and composes all emitted source maps back to
	// the authored `.vibe` positions.
	LoweringExternal LoweringMode = "external"
)

// LoweredSource is the externally produced lowering of one authored `.vibe`
// file: the generated TypeScript and the version-3 source map from the
// authored file to that TypeScript.
//
// The map is validated exactly and rejected fail-closed unless all of the
// following hold:
//   - it is a JSON object containing only the fields version, file,
//     sourceRoot, sources, sourcesContent, names, and mappings;
//   - version is 3 and sourceRoot is absent or empty;
//   - sources names exactly the authored file (its request path, optionally
//     prefixed "./");
//   - sourcesContent, when present, is exactly one entry equal to the
//     authored text;
//   - mappings decodes as base64 VLQ, every segment's source index is 0, every
//     name index is in range, and every position lies within the lowered
//     (generated side) or authored (source side) text.
//
// Position semantics: a lowered position maps through the greatest mapping on
// the same lowered line at or before its column; the authored column advances
// one-for-one with the offset into that mapping's run, clamped to the authored
// line end. Lowered positions on lines without mappings, before the first
// mapping of their line, or inside a segment that has no source fields are
// unmapped: emitted source maps keep them unmapped and diagnostics there
// attach to the authored file without a span. Columns are UTF-16 code units.
type LoweredSource struct {
	Text      string `json:"text"`
	SourceMap string `json:"sourceMap"`
}

// SourceFile is an immutable compiler-owned source input.
type SourceFile struct {
	Path string   `json:"path"`
	Kind FileKind `json:"kind"`
	Text string   `json:"text"`
	// Lowered carries the external lowering of a FileKindVibe file. It is
	// required for every `.vibe` file when the request uses LoweringExternal and
	// must be absent otherwise.
	Lowered *LoweredSource `json:"lowered,omitempty"`
}

// Span uses UTF-16 offsets so diagnostics can round-trip through TypeScript tools.
type Span struct {
	Start  int `json:"start"`
	Length int `json:"length"`
}

// Diagnostic is the transport-neutral diagnostic shape used by the bridge.
type Diagnostic struct {
	Code     string             `json:"code"`
	Category DiagnosticCategory `json:"category"`
	Message  string             `json:"message"`
	File     string             `json:"file,omitempty"`
	Span     *Span              `json:"span,omitempty"`
	Phase    Phase              `json:"phase,omitempty"`
}

// Options carries compatibility options without prematurely copying upstream's
// internal Go option structs. Unknown fields are retained for forward compatibility.
type Options map[string]any

// CompileRequest is the serializable boundary used by the TypeScript CLI bridge.
type CompileRequest struct {
	RootNames []string `json:"rootNames"`
	// Files optionally carries an in-memory project. When omitted, process-backed
	// compilers load each root name from disk. Supplying Files is the deterministic
	// path used by editor hosts and by the pinned-fork conformance test.
	Files   []SourceFile `json:"files,omitempty"`
	Options Options      `json:"options,omitempty"`
	// Lowering selects the identity content-mapper path (default) or the
	// externally lowered path. LoweringExternal requires in-memory Files.
	Lowering LoweringMode `json:"lowering,omitempty"`
}

// Artifact describes one emitted file.
type Artifact struct {
	Path    string `json:"path"`
	Content []byte `json:"content"`
}

// CompileResult mirrors the main observable compiler outputs.
type CompileResult struct {
	Diagnostics []Diagnostic `json:"diagnostics"`
	Artifacts   []Artifact   `json:"artifacts"`
	EmitSkipped bool         `json:"emitSkipped"`
}

// Compiler is the backend-independent surface consumed by the CLI and npm API.
type Compiler interface {
	Compile(context.Context, CompileRequest) (CompileResult, error)
}

// Extension is the intended narrow seam around the upstream TypeScript phases.
// Concrete checked IR types remain intentionally absent until the upstream audit
// becomes a fork and those representations can be shared safely.
type Extension interface {
	Name() string
	APIVersion() int
	FileExtensions() []string
	Parse(context.Context, SourceFile) (any, error)
	Check(context.Context, any) ([]Diagnostic, error)
	Lower(context.Context, any) (any, error)
}
