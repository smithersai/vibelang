package compiler

import "context"

// APIVersion is the version of the initial compiler extension contract.
const APIVersion = 1

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

// SourceFile is an immutable compiler-owned source input.
type SourceFile struct {
	Path string   `json:"path"`
	Kind FileKind `json:"kind"`
	Text string   `json:"text"`
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
	Options   Options  `json:"options,omitempty"`
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
