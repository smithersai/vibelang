package compiler

import "context"

// APIVersion is the version of the compiler transport contract. Version 2
// added multi-file root sets with relative `.sm` imports, the externally
// lowered request mode (LoweringExternal with per-file LoweredSource), and
// composed authored source maps in emitted artifacts. Version 3 added
// LoweringInternal: real Smithers lowering performed in Go inside the pinned
// fork against its own checker, factory, and printer. Version 4 made lowering
// mode mandatory and gave identity lowering an explicit wire value, so an
// omitted field can never silently disable Smithers checks.
const APIVersion = 4

// FileKind classifies a compiler input without tying extensions to a backend.
type FileKind string

const (
	FileKindTypeScript  FileKind = "typescript"
	FileKindSmithers    FileKind = "smithers"
	FileKindSmithersJSX FileKind = "smithers-jsx"
	FileKindAsset       FileKind = "asset"
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

// LoweringMode selects who lowers `.sm` syntax before TypeScript checking.
type LoweringMode string

const (
	// LoweringIdentity accepts the TypeScript-shaped subset of Smithers and
	// checks it through the fork's identity content mapper. Lowered fields must
	// be absent. It is an explicit compatibility/testing route, never a default.
	LoweringIdentity LoweringMode = "identity"
	// LoweringExternal means an external frontend already lowered every `.sm`
	// file. Each FileKindSmithers SourceFile must carry a LoweredSource; the bridge
	// checks the lowered TypeScript and composes all emitted source maps back to
	// the authored `.sm` positions.
	LoweringExternal LoweringMode = "external"
	// LoweringInternal lowers Smithers semantics inside the pinned fork, in Go,
	// against the fork's own parser, checker, node factory, and printer. The
	// bridge injects a compiler-owned prelude declaring the runtime Result
	// representation, recognizes it by resolved symbol identity, and rewrites
	// `throw` and `return` inside Result-returning functions into Result variant
	// constructions. Lowered fields must be absent: the bridge produces the
	// lowering and its authored source map itself.
	LoweringInternal LoweringMode = "internal"
)

// LoweredSource is the externally produced lowering of one authored `.sm`
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
	// Lowered carries the external lowering of a FileKindSmithers file. It is
	// required for every `.sm` file when the request uses LoweringExternal and
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
// internal Go option structs.
//
// Unknown fields are NOT retained: the bridge has a closed allowlist over this
// map and refuses anything outside it. That was true before this comment was
// corrected — the allowlist has always had a `default:` arm — and it is now
// refused with a diagnostic code rather than a bare error string. See
// compatibility.mdx §Forbidden and forkbridge/main.go.txt's compilerOptions.
type Options map[string]any

// ConfigFile is one tsconfig.json, by name and text.
type ConfigFile struct {
	Path string `json:"path"`
	Text string `json:"text"`
}

// CompileRequest is the serializable boundary used by the TypeScript CLI bridge.
type CompileRequest struct {
	RootNames []string `json:"rootNames"`
	// Files optionally carries an in-memory project. When omitted, process-backed
	// compilers load each root name from disk. Supplying Files is the deterministic
	// path used by editor hosts and by the pinned-fork conformance test.
	Files   []SourceFile `json:"files,omitempty"`
	Options Options      `json:"options,omitempty"`
	// Lowering explicitly selects the internal, identity, or externally lowered
	// path. The zero value is invalid. LoweringExternal requires in-memory Files.
	Lowering LoweringMode `json:"lowering,omitempty"`
	// ConfigFile is the project's tsconfig.json, by name and text, when the
	// caller has one. It crosses the wire as TEXT rather than as a parsed
	// options bag because compatibility.mdx §Forbidden requires the offending
	// option to be REJECTED, and a rejection has to point at what the author
	// wrote — a normalized bag has no positions. See
	// forkbridge/main.go.txt's validateSmithersConfigFile.
	ConfigFile *ConfigFile `json:"configFile,omitempty"`
	// RootDir is the project root every logical name — and therefore every
	// identity and every digest — is stated relative to when RootNames are read
	// from disk. It must be absolute, and it is HOST-SIDE ONLY: `json:"-"` keeps
	// it off the bridge wire, because by the time a request crosses that wire
	// every name in it is already logical and the bridge's own fixed `/src`
	// virtual root is the only root left. See identityPathsForDiskRoots.
	//
	// A relative RootName is read from beneath this directory and keeps its own
	// spelling; an absolute one is restated relative to it and refused if it
	// escapes. Leaving it empty does NOT fall back to the process working
	// directory: see identityPathsForDiskRoots for the derived root, which is a
	// function of the root names alone.
	RootDir string `json:"-"`
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
