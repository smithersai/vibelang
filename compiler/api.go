package compiler

import "context"

// APIVersion is the version of the compiler transport contract. Version 2
// added multi-file root sets with relative `.vibe` imports, the externally
// lowered request mode (LoweringExternal with per-file LoweredSource), and
// composed authored source maps in emitted artifacts. Version 3 added
// LoweringInternal: real VibeLang lowering performed in Go inside the pinned
// fork against its own checker, factory, and printer. Version 4 made lowering
// mode mandatory and gave identity lowering an explicit wire value, so an
// omitted field can never silently disable VibeLang checks. Version 5 adds an
// explicitly TypeScript-only native project mode and additive source policies
// for isolated generated programs. Neither can disable checks on .vibe inputs.
// Version 6 adds batched syntax inspection with serializable module-use facts.
// Version 7 adds native formatting and authored token lookup.
// Version 8 adds compiler-owned source-loader registration recognition.
// Version 9 adds inert generated asset-module validation.
// Version 10 adds native asset-import discovery and root-confined resolution.
// Version 11 adds explicitly unchecked ordinary TypeScript transpilation.
// Version 12 adds native worker-module closure and registration analysis.
// Version 13 adds native canonical function fingerprints.
// Version 14 adds bounded runtime-module edges, initialization trust and resolution,
// plus authored top-level membership in syntax inspection.
// Version 15 adds native JSON/config inspection and duplicate-key spans.
// Version 16 adds binding-owned durable host-module rewrite facts.
// Version 17 adds native syntax-schema derivation for the validator-IR helper.
// Version 18 adds native closed-runtime module factory assembly.
// Version 19 adds standalone checked Action contract derivation.
// Version 20 adds checked exported-function rows and nominal failure schemas.
// Version 21 adds shared native configuration validation.
// Version 22 adds generated-project checking with explicit dependency reads.
// Version 23 adds native declaration text operations and generated declaration emit.
// Version 24 adds checked executable-body boundary contracts over generated sources.
// Version 25 adds exact module literal spans/kinds for native editor navigation.
// Version 26 adds batched native checked-type schema queries.
// Version 27 adds native conditional recovery plans and lexical token facts.
// Version 28 adds native comptime phase planning with explicit tracked inputs.
// Version 29 adds native whole-project language analysis and provisional rows.
// Version 30 adds optional root-confined dependency discovery to that query.
// Version 31 can keep authored language sources explicit while discovering
// ordinary foreign dependencies for project analysis, and supports checker-only
// runtime aliases with native revalidation of generated inert-data modules.
// Version 32 adds native SDK-ABI TypeScript lowering as an explicit intermediate
// artifact, distinct from editor facts and generated-program checking.
// Version 33 adds the explicit SDK declaration ABI target.
// Version 34 adds private executable-body intermediate lowering in Go.
// Version 35 adds opt-in top-level variable/function syntax inventories.
// Version 36 adds standalone bounded Plan and independent Manifest compilation.
// Version 37 adds the explicit ordinary TypeScript CLI mode on this executable.
// Version 38 adds inert keyed Plan compilation, verification and append.
// Version 39 adds checked single-module source to the explicit keyed Plan profile.
// Version 40 binds the keyed-source/v2 ordered value codec and Ref projections.
// Version 41 adds source-only provider value-boundary checking.
// Version 42 adds explicit keyed source declaration-module dependencies.
// Version 43 expands statically bounded keyed source fan-out into Action nodes.
// Version 44 composes checked source Flow declarations into keyed graphs.
// Version 45 checks retained static Flow bodies before keyed Plan extraction.
// Version 46 composes source child Flows inside static fan-out callbacks.
// Version 47 binds checked enclosing Flow values into static fan-out templates.
// Version 48 adds checked scalar computation data to the keyed source profile.
// Version 49 adds complete conditional topology for the keyed demand adapter.
// Version 50 connects logical/nullish conditional work to the keyed branch ABI.
// Version 51 derives scoped statement branches and early returns as keyed data.
// Version 52 preserves checked nullable success narrowing in keyed source data.
// Version 53 exposes opt-in native dependency reads/probes for build invalidation.
// Version 54 adds bounded native project configuration and source discovery.
const APIVersion = 54

// FileKind classifies a compiler input without tying extensions to a backend.
type FileKind string

const (
	FileKindTypeScript  FileKind = "typescript"
	FileKindVibeLang    FileKind = "vibelang"
	FileKindVibeLangJSX FileKind = "vibelang-jsx"
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

// LoweringMode selects who lowers `.vibe` syntax before TypeScript checking.
type LoweringMode string

const (
	// LoweringTypeScript compiles ordinary TypeScript/JavaScript with the native
	// compiler. It refuses every VibeLang input rather than interpreting one as
	// TypeScript and losing its language checks.
	LoweringTypeScript LoweringMode = "typescript"
	// LoweringIdentity accepts the TypeScript-shaped subset of VibeLang and
	// checks it through the fork's identity content mapper. Lowered fields must
	// be absent. It is an explicit compatibility/testing route, never a default.
	LoweringIdentity LoweringMode = "identity"
	// LoweringExternal means an external frontend already lowered every `.vibe`
	// file. Each FileKindVibeLang SourceFile must carry a LoweredSource; the bridge
	// checks the lowered TypeScript and composes all emitted source maps back to
	// the authored `.vibe` positions.
	LoweringExternal LoweringMode = "external"
	// LoweringInternal lowers VibeLang semantics inside the pinned fork, in Go,
	// against the fork's own parser, checker, node factory, and printer. The
	// bridge injects a compiler-owned prelude declaring the runtime Result
	// representation, recognizes it by resolved symbol identity, and rewrites
	// `throw` and `return` inside Result-returning functions into Result variant
	// constructions. Lowered fields must be absent: the bridge produces the
	// lowering and its authored source map itself.
	LoweringInternal LoweringMode = "internal"
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
	// Lowered carries the external lowering of a FileKindVibeLang file. It is
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

// LanguageAnalyzer reports data from ordinary native checked lowering. Files
// can retain provisional rows when Checked is false; these are editor facts,
// NOT authenticated implementation contracts. No artifacts are published.
type LanguageAnalysisRequest struct {
	TraceDependencies bool `json:"traceDependencies,omitempty"`
	// Query-only retained static Flow checking; never runtime-emission authority.
	StaticPlanCheck bool         `json:"staticPlanCheck,omitempty"`
	Files           []SourceFile `json:"files"`
	// Optional read-only dependency discovery beneath an explicit directory.
	// Explicit source bytes win over disk; omitted means no filesystem reads.
	ResolutionRoot string `json:"resolutionRoot,omitempty"`
	// Do not read additional .vibe source files from disk. Ordinary foreign
	// dependencies still resolve beneath ResolutionRoot. Supplied bytes win.
	ExplicitVibeLangSources bool `json:"explicitVibeLangSources,omitempty"`
	// Checker-only aliases for supplied TypeScript modules. CompilerData is a
	// request for native inert-data validation, never unchecked trust authority.
	RuntimeModules []LanguageAnalysisRuntimeModule `json:"runtimeModules,omitempty"`
	// Explicit SDK target for declaration-contract checking. The standalone
	// emitter's runtime remains a different ABI, never an implicit fallback.
	SDKRuntimeImport string `json:"sdkRuntimeImport,omitempty"`
}
type LanguageAnalysisRuntimeModule struct {
	Path         string   `json:"path"`
	Aliases      []string `json:"aliases"`
	CompilerData bool     `json:"compilerData,omitempty"`
}
type AnalyzedError struct {
	Name         string `json:"name"`
	FieldsSource string `json:"fieldsSource"`
	Start        int    `json:"start"`
	End          int    `json:"end"`
}
type AnalyzedFunction struct {
	Name           string   `json:"name"`
	Exported       bool     `json:"exported"`
	Async          bool     `json:"async"`
	Channel        string   `json:"channel"`
	ExplicitReturn bool     `json:"explicitReturn"`
	Start          int      `json:"start"`
	End            int      `json:"end"`
	BodyStart      int      `json:"bodyStart"`
	BodyEnd        int      `json:"bodyEnd"`
	ModuleScope    bool     `json:"moduleScope"`
	Failures       []string `json:"failures"`
	Requirements   []string `json:"requirements"`
}
type AnalyzedFile struct {
	Path      string             `json:"path"`
	Analyzed  bool               `json:"analyzed"`
	Errors    []AnalyzedError    `json:"errors"`
	Functions []AnalyzedFunction `json:"functions"`
}
type LanguageAnalysisResult struct {
	Dependencies *DependencyTrace `json:"dependencies,omitempty"`
	// Checked certifies that native checking ran for the language roots and
	// compiler-owned support. Foreign declarations constrain those consumers,
	// but their implementation bodies retain their own compiler environment;
	// this is not a whole-foreign-project typechecking certificate.
	Checked     bool           `json:"checked"`
	Diagnostics []Diagnostic   `json:"diagnostics"`
	Files       []AnalyzedFile `json:"files"`
}
type LanguageAnalyzer interface {
	AnalyzeLanguage(context.Context, LanguageAnalysisRequest) (LanguageAnalysisResult, error)
}

type LanguageLoweringRequest struct {
	Project                    LanguageAnalysisRequest  `json:"project"`
	RuntimeImport              string                   `json:"runtimeImport"`
	Outputs                    []LanguageLoweringOutput `json:"outputs,omitempty"`
	PreserveVibeLangSpecifiers bool                     `json:"preserveVibeLangSpecifiers,omitempty"`
}
type LanguageLoweringOutput struct {
	Path                  string `json:"path"`
	OutputFileName        string `json:"outputFileName,omitempty"`
	SourceName            string `json:"sourceName,omitempty"`
	StripImportAttributes bool   `json:"stripImportAttributes,omitempty"`
}
type LanguageLoweredFile struct {
	Path      string `json:"path"`
	Text      string `json:"text"`
	SourceMap string `json:"sourceMap"`
}

// The generated TypeScript still needs checking against the selected SDK.
// OK attests only source checking and successful native intermediate lowering.
type LanguageLoweringResult struct {
	OK          bool                   `json:"ok"`
	Analysis    LanguageAnalysisResult `json:"analysis"`
	Diagnostics []Diagnostic           `json:"diagnostics"`
	Files       []LanguageLoweredFile  `json:"files"`
}
type LanguageLowerer interface {
	LowerLanguage(context.Context, LanguageLoweringRequest) (LanguageLoweringResult, error)
}

// Options carries compatibility options without prematurely copying upstream's
// internal Go option structs.
//
// For VibeLang, unknown fields are NOT retained: the bridge has a closed allowlist over this
// map and refuses anything outside it. That was true before this comment was
// corrected — the allowlist has always had a `default:` arm — and it is now
// refused with a diagnostic code rather than a bare error string. See
// compatibility.mdx §Forbidden and forkbridge/main.go.txt's compilerOptions.
// LoweringTypeScript instead uses upstream's validating JSON compiler-option
// parser. Its in-memory host owns output/root paths; conflicting path options
// are rejected, not silently ignored.
type Options map[string]any

// ConfigFile is one tsconfig.json, by name and text.
type ConfigFile struct {
	Path string `json:"path"`
	Text string `json:"text"`
}

// ConfigValidator checks the language's mandatory/forbidden options on the
// native JSON AST without loading a project, following extends, or reading disk.
type ConfigValidationResult struct {
	Diagnostics []Diagnostic `json:"diagnostics"`
}
type ConfigValidator interface {
	ValidateConfig(context.Context, ConfigFile) (ConfigValidationResult, error)
}

// ProjectDiscoverer resolves JSONC/extends and include/exclude with the native
// compiler and its compiler-owned .vibe mapper. It never executes plugins.
type ProjectConfigRequest struct { Path string `json:"path"` }
type ProjectConfigOptions struct {
	RootDir string `json:"rootDir"`
	OutDir string `json:"outDir"`
	Declaration bool `json:"declaration"`
	SourceMap bool `json:"sourceMap"`
	NoEmit bool `json:"noEmit"`
}
type ProjectConfigResult struct {
	Files []string `json:"files"`
	Configurations []ConfigFile `json:"configurations"`
	Options ProjectConfigOptions `json:"options"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}
type ProjectDiscoverer interface {
	DiscoverProject(context.Context, ProjectConfigRequest) (ProjectConfigResult, error)
}

// GeneratedProjectChecker checks already-generated TypeScript, not language
// source. Files are absolute, normalized output paths; their text wins over
// disk. DiskDependencies explicitly permits ordinary upstream dependency and
// package resolution (read-only, bounded), never execution or config loading.
// Exact bare module overrides use upstream paths resolution, not source edits.
type GeneratedProjectFile struct {
	Path string `json:"path"`
	Text string `json:"text"`
	// Explicit foreign projections use ordinary strict TypeScript policy.
	// Omitted/language keeps every mandatory language compiler option.
	Configuration string `json:"configuration,omitempty"`
}
type GeneratedProjectRequest struct {
	TraceDependencies bool                   `json:"traceDependencies,omitempty"`
	Files             []GeneratedProjectFile `json:"files"`
	CurrentDirectory  string                 `json:"currentDirectory"`
	DiskDependencies  bool                   `json:"diskDependencies"`
	ModuleOverrides   map[string]string      `json:"moduleOverrides,omitempty"`
}
type GeneratedProjectResult struct {
	Dependencies *DependencyTrace `json:"dependencies,omitempty"`
	Diagnostics  []Diagnostic     `json:"diagnostics"`
}

// DependencyTrace inventories native disk reads and positive/negative resolver
// probes. Explicit overlays and pinned libraries are not disk dependencies.
// Directories records membership reads and missing directory probes, not every
// positive ancestor check (individual file probes cover resolution below them).
type DependencyTrace struct {
	Files       []string `json:"files"`
	Directories []string `json:"directories"`
}
type GeneratedProjectChecker interface {
	CheckGeneratedProject(context.Context, GeneratedProjectRequest) (GeneratedProjectResult, error)
}

// BodyContractDeriver checks the actual generated entry and derives bounded
// structural codecs. It does not compile authored language or execute code.
type BodyContractRequest struct {
	Project          GeneratedProjectRequest `json:"project"`
	EntryFile        string                  `json:"entryFile"`
	Entry            string                  `json:"entry"`
	LogicalFileName  string                  `json:"logicalFileName"`
	RuntimeSpecifier string                  `json:"runtimeSpecifier"`
	Resumable        bool                    `json:"resumable"`
	Async            bool                    `json:"async"`
}
type BodyContractResult struct {
	OK          bool         `json:"ok"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	Reason      string       `json:"reason"`
	Message     string       `json:"message"`
	SchemasJSON string       `json:"schemasJson"`
}
type BodyContractDeriver interface {
	BodyContract(context.Context, BodyContractRequest) (BodyContractResult, error)
}

type DeclarationRows struct {
	Failures     []string `json:"failures"`
	Requirements []string `json:"requirements"`
}
type DeclarationTextRequest struct {
	Operation string                     `json:"operation"`
	Path      string                     `json:"path"`
	Text      string                     `json:"text"`
	Effects   map[string]DeclarationRows `json:"effects,omitempty"`
	Runtimes  []string                   `json:"runtimes,omitempty"`
}
type DeclarationTextResult struct {
	Text    string                     `json:"text"`
	Effects map[string]DeclarationRows `json:"effects"`
}
type GeneratedDeclarationMetadata struct {
	Effects       map[string]DeclarationRows `json:"effects"`
	RuntimeModule *string                    `json:"runtimeModule,omitempty"`
}
type GeneratedDeclarationsRequest struct {
	Project  GeneratedProjectRequest                 `json:"project"`
	Metadata map[string]GeneratedDeclarationMetadata `json:"metadata,omitempty"`
}
type GeneratedDeclarationsResult struct {
	OK          bool                   `json:"ok"`
	Outputs     []GeneratedProjectFile `json:"outputs"`
	Diagnostics []Diagnostic           `json:"diagnostics"`
}
type DeclarationCompiler interface {
	DeclarationText(context.Context, DeclarationTextRequest) (DeclarationTextResult, error)
	EmitGeneratedDeclarations(context.Context, GeneratedDeclarationsRequest) (GeneratedDeclarationsResult, error)
}

// SourcePolicy adds host-owned restrictions to selected ordinary source files.
// It is not a sandbox, and it does not replace type checking or runtime
// isolation. Only LoweringTypeScript accepts it. Names and syntax are checked
// by the native parser; clients never need a second parser/compiler library.
type SourcePolicy struct {
	Files                []string `json:"files"`
	DiagnosticCode       string   `json:"diagnosticCode"`
	MessagePrefix        string   `json:"messagePrefix"`
	ForbidModuleSyntax   bool     `json:"forbidModuleSyntax"`
	ForbiddenIdentifiers []string `json:"forbiddenIdentifiers"`
}

// CompileRequest is the serializable boundary used by the TypeScript CLI bridge.
type CompileRequest struct {
	RootNames []string `json:"rootNames"`
	// Files optionally carries an in-memory project. When omitted, process-backed
	// compilers load each root name from disk. Supplying Files is the deterministic
	// path used by editor hosts and by the pinned-fork conformance test.
	Files   []SourceFile `json:"files,omitempty"`
	Options Options      `json:"options,omitempty"`
	// Lowering explicitly selects the native TypeScript, internal, identity, or externally lowered
	// path. The zero value is invalid. LoweringExternal requires in-memory Files.
	Lowering LoweringMode `json:"lowering,omitempty"`
	// ConfigFile is the project's tsconfig.json, by name and text, when the
	// caller has one. It crosses the wire as TEXT rather than as a parsed
	// options bag because compatibility.mdx §Forbidden requires the offending
	// option to be REJECTED, and a rejection has to point at what the author
	// wrote — a normalized bag has no positions. See
	// forkbridge/main.go.txt's validateVibeLangConfigFile.
	// This field validates source legality; it does not load options. Supply
	// resolved compiler-option values separately in Options.
	ConfigFile   *ConfigFile   `json:"configFile,omitempty"`
	SourcePolicy *SourcePolicy `json:"sourcePolicy,omitempty"`
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

// DurableModuleAnalyzer supplies authored UTF-16 rewrite ranges for a single
// in-memory module. It does not derive a Flow descriptor or certify language
// legality. Only private function declarations/literals reachable exclusively
// from one compiler-bound durable call qualify for removal. Initializers and
// other executable module statements are not dead-code-eliminated.
type DurableModuleRequest struct {
	Source string `json:"source"`
}
type DurableModuleResult struct {
	Diagnostics []Diagnostic `json:"diagnostics"`
	Imports     []Span       `json:"imports"`
	Calls       []Span       `json:"calls"`
	Removals    []Span       `json:"removals"`
}
type DurableModuleAnalyzer interface {
	DurableModule(context.Context, DurableModuleRequest) (DurableModuleResult, error)
}

// SyntaxSchemaDeriver is the deliberately limited declaration-to-validator-IR
// helper, not the checked vibelang:schema intrinsic or a type-check certificate.
// SchemaJSON preserves authored property order and JS UTF-16 string values.
type SyntaxSchemaRequest struct {
	Source   string `json:"source"`
	TypeName string `json:"typeName"`
}
type SyntaxSchemaResult struct {
	OK         bool   `json:"ok"`
	SchemaJSON string `json:"schemaJson"`
	Message    string `json:"message"`
	ParseError bool   `json:"parseError"`
}
type SyntaxSchemaDeriver interface {
	SyntaxSchema(context.Context, SyntaxSchemaRequest) (SyntaxSchemaResult, error)
}

// CheckedSchemasDeriver reifies exact single-type-argument call sites in an
// immutable virtual source closure. This is a type query, not an acceptance
// gate or intrinsic authorization. Modules map bare names to supplied files.
type CheckedSchemaQuery struct {
	File string `json:"file"`
	Span Span   `json:"span"`
}
type CheckedSchemasRequest struct {
	Files   []InspectionSource   `json:"files"`
	Modules map[string]string    `json:"modules"`
	Queries []CheckedSchemaQuery `json:"queries"`
}
type CheckedSchemaResult struct {
	OK         bool   `json:"ok"`
	SchemaJSON string `json:"schemaJson"`
	Failure    string `json:"failure"`
	Message    string `json:"message"`
}
type CheckedSchemasResult struct {
	Schemas []CheckedSchemaResult `json:"schemas"`
}
type CheckedSchemasDeriver interface {
	CheckedSchemas(context.Context, CheckedSchemasRequest) (CheckedSchemasResult, error)
}

type SourceRecoveryRequest struct {
	Text string `json:"text"`
}
type SourceRecoveryDiagnostic struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
	Start    int    `json:"start"`
}
type RecoveryRun struct {
	DerivedStart  int `json:"derivedStart"`
	AuthoredStart int `json:"authoredStart"`
	Length        int `json:"length"`
}
type RecoveryGlue struct {
	DerivedStart int `json:"derivedStart"`
	Length       int `json:"length"`
	Anchor       int `json:"anchor"`
}
type RecoveryToken struct {
	Kind           string `json:"kind"`
	Text           string `json:"text"`
	Start          int    `json:"start"`
	End            int    `json:"end"`
	EndsExpression bool   `json:"endsExpression"`
}
type SourceRecoveryResult struct {
	Code             string                     `json:"code"`
	Changed          bool                       `json:"changed"`
	IdentityFallback bool                       `json:"identityFallback"`
	Diagnostics      []SourceRecoveryDiagnostic `json:"diagnostics"`
	RejectedStarts   []int                      `json:"rejectedStarts"`
	Verbatim         []RecoveryRun              `json:"verbatim"`
	Glue             []RecoveryGlue             `json:"glue"`
	Tokens           []RecoveryToken            `json:"tokens"`
}
type SourceRecoveryPlanner interface {
	RecoverSource(context.Context, SourceRecoveryRequest) (SourceRecoveryResult, error)
}

type ComptimeTextInput struct {
	File      string `json:"file"`
	Specifier string `json:"specifier"`
	Text      string `json:"text"`
	Error     string `json:"error"`
}
type ComptimePlanRequest struct {
	Files               []InspectionSource  `json:"files"`
	Target              string              `json:"target"`
	Inputs              []ComptimeTextInput `json:"inputs"`
	SchemaRuntimeImport string              `json:"schemaRuntimeImport"`
}
type ComptimePlanRange struct {
	File string `json:"file"`
	Span Span   `json:"span"`
}
type ComptimePlanRead struct {
	At        ComptimePlanRange `json:"at"`
	Specifier string            `json:"specifier"`
}
type ComptimePlanDiagnostic struct {
	At      ComptimePlanRange `json:"at"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
}
type ComptimePlanCall struct {
	At           ComptimePlanRange   `json:"at"`
	Argument     ComptimePlanRange   `json:"argument"`
	MappedOrigin ComptimePlanRange   `json:"mappedOrigin"`
	Origins      []ComptimePlanRange `json:"origins"`
	Inputs       []int               `json:"inputs"`
	ValueJSON    string              `json:"valueJson"`
	SchemaType   string              `json:"schemaType"`
}
type ComptimePlanEdit struct {
	At           ComptimePlanRange   `json:"at"`
	Kind         string              `json:"kind"`
	Text         string              `json:"text"`
	MappedOrigin ComptimePlanRange   `json:"mappedOrigin"`
	Origins      []ComptimePlanRange `json:"origins"`
}
type ComptimePlanResult struct {
	Complete    bool                     `json:"complete"`
	Diagnostics []ComptimePlanDiagnostic `json:"diagnostics"`
	Reads       []ComptimePlanRead       `json:"reads"`
	Calls       []ComptimePlanCall       `json:"calls"`
	Edits       []ComptimePlanEdit       `json:"edits"`
}

// ComptimePlanner never executes source or reads the host filesystem. An
// incomplete plan publishes only diagnostics and actually-reached input reads.
// A caller can snapshot those reads and submit a fresh immutable request.
type ComptimePlanner interface {
	PlanComptime(context.Context, ComptimePlanRequest) (ComptimePlanResult, error)
}

// RuntimeFactoryAssembler erases already-lowered TS and assembles a strict JS
// factory with a single explicitly supplied runtime ABI. It never checks the
// source language, derives contracts, evaluates code or authenticates an artifact.
type RuntimeFactoryRequest struct {
	Source           string `json:"source"`
	Entry            string `json:"entry"`
	RuntimeSpecifier string `json:"runtimeSpecifier"`
}
type RuntimeFactoryResult = CanonicalFunctionResult
type RuntimeFactoryAssembler interface {
	RuntimeFactory(context.Context, RuntimeFactoryRequest) (RuntimeFactoryResult, error)
}

// ActionContractDeriver checks one declaration source and returns its bounded
// canonical descriptor. It does not execute code or supply an implementation.
type ActionContractRequest struct {
	Source     string `json:"source"`
	FileName   string `json:"fileName"`
	ExportName string `json:"exportName"`
	ID         string `json:"id"`
	Version    int64  `json:"version"`
}
type ActionContractResult struct {
	OK           bool         `json:"ok"`
	Diagnostics  []Diagnostic `json:"diagnostics"`
	ContractJSON string       `json:"contractJson"`
}
type ActionContractDeriver interface {
	ActionContract(context.Context, ActionContractRequest) (ActionContractResult, error)
}

// CheckedFunctionInspector checks and lowers the complete explicit source set
// before publishing an export's authored span, rows and failure codec. This is
// semantic data, not a compiler-object facade or an implementation attestation.
type CheckedFunctionRequest struct {
	Files      []SourceFile `json:"files"`
	EntryFile  string       `json:"entryFile"`
	ExportName string       `json:"exportName"`
	// Derive exact input/success codecs for a single-input durable provider.
	// Omitted keeps the ordinary row-inspection profile unchanged.
	DurableBoundary bool `json:"durableBoundary,omitempty"`
}
type CheckedFunctionFacts struct {
	File              string   `json:"file"`
	Name              string   `json:"name"`
	Span              Span     `json:"span"`
	Requirements      []string `json:"requirements"`
	TypedFailures     []string `json:"typedFailures"`
	Panic             bool     `json:"panic"`
	FailureSchemaJSON string   `json:"failureSchemaJson"`
	ValueSchemasJSON  string   `json:"valueSchemasJson"`
}
type CheckedFunctionResult struct {
	OK          bool                  `json:"ok"`
	Diagnostics []Diagnostic          `json:"diagnostics"`
	Message     string                `json:"message"`
	Function    *CheckedFunctionFacts `json:"function"`
}
type CheckedFunctionInspector interface {
	CheckedFunction(context.Context, CheckedFunctionRequest) (CheckedFunctionResult, error)
}

// InspectionSource selects an upstream parser mode without exposing an AST.
// Inspection proves syntax only, never VibeLang legality or type correctness.
type InspectionSource struct {
	Path       string `json:"path"`
	Text       string `json:"text"`
	ScriptKind string `json:"scriptKind"` // typescript, javascript, tsx, jsx, json
	// Non-JSON only. Requests top-level variable/function declarations,
	// including private bindings, patterns, ambient signatures and overloads.
	DeclarationBindings bool `json:"declarationBindings,omitempty"`
}

type InspectionRequest struct {
	Files []InspectionSource `json:"files"`
}

// ModuleSyntax is a syntactic module access. A nil Specifier means its target
// is not a literal. Type-only forms remain identifiable, never executable edges
// by implication. Spans are UTF-16 offsets in the supplied source.
type ModuleSyntax struct {
	Kind          string  `json:"kind"`
	TopLevel      bool    `json:"topLevel"`
	Span          Span    `json:"span"`
	Specifier     *string `json:"specifier,omitempty"`
	SpecifierSpan *Span   `json:"specifierSpan,omitempty"`
	SpecifierKind string  `json:"specifierKind,omitempty"`
}

type InspectedSource struct {
	Path         string         `json:"path"`
	Diagnostics  []Diagnostic   `json:"diagnostics"`
	ModuleSyntax []ModuleSyntax `json:"moduleSyntax"`
	// Present only for JSON/config syntax. Literal spans preserve even escaped
	// unpaired-surrogate keys without changing their identity in transport.
	JSONDuplicateKeys *[]Span `json:"jsonDuplicateKeys,omitempty"`
	// Present only when requested. Empty on a parse failure, not a claim that
	// recovered syntax has no bindings. Never an export or runtime-value proof.
	DeclarationBindings *[]DeclarationBinding `json:"declarationBindings,omitempty"`
}

// DeclarationBinding is one top-level variable or function declaration.
// Name is the decoded identifier, or nil for a pattern/anonymous function.
// NameSpan addresses the exact binding spelling; only anonymous functions
// omit it. Span and NameSpan are authored UTF-16 ranges, in source order.
type DeclarationBinding struct {
	Kind     string  `json:"kind"` // variable, function
	Span     Span    `json:"span"`
	Name     *string `json:"name"`
	NameSpan *Span   `json:"nameSpan"`
}

type InspectionResult struct {
	Files []InspectedSource `json:"files"`
}

// SourceInspector is the native parser query surface used by host tooling.
// The pinned compiler implements this alongside Compiler. It emits no code,
// performs no module resolution and never reads the host filesystem.
type SourceInspector interface {
	Inspect(context.Context, InspectionRequest) (InspectionResult, error)
}

// FormatRequest asks the native whitespace formatter to preserve the authored
// program. FileName is a diagnostic label, never a filesystem read. The current
// language formatter accepts the TypeScript-shaped surface, not JSX.
type FormatRequest struct {
	Text       string `json:"text"`
	FileName   string `json:"fileName,omitempty"`
	IndentSize *int   `json:"indentSize,omitempty"`
	NewLine    string `json:"newLine,omitempty"`
}

type FormatDiagnostic struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
	Start    int    `json:"start"` // authored UTF-16 offset
	Line     int    `json:"line"`  // 1-based, all ECMAScript line terminators
	Column   int    `json:"column"`
}

type FormatResult struct {
	OK          bool               `json:"ok"`
	Code        string             `json:"code"`
	Changed     bool               `json:"changed"`
	Diagnostics []FormatDiagnostic `json:"diagnostics"`
}

type TokenRequest struct {
	Text   string `json:"text"`
	Offset int    `json:"offset"` // authored UTF-16 offset
}

// SourceToken is a lexical fact, not an AST object or a 5.9 SyntaxKind number.
// Kind is the pinned native scanner's symbolic kind name.
type SourceToken struct {
	Kind  string `json:"kind"`
	Text  string `json:"text"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

type TokenResult struct {
	Token *SourceToken `json:"token"`
}

type SourceFormatter interface {
	Format(context.Context, FormatRequest) (FormatResult, error)
	TokenAt(context.Context, TokenRequest) (TokenResult, error)
}

// LoaderRegistrationRequest never executes its supplied source. Discovery is
// a spelling-only candidate query; recognition uses native checker identity.
type LoaderRegistrationRequest struct {
	Mode     string `json:"mode"` // discover or recognize
	FileName string `json:"fileName"`
	Source   string `json:"source"`
}

type LoaderRegistrationDiagnostic struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
	FileName string `json:"fileName"`
	Line     int    `json:"line"` // 1-based; column uses authored UTF-16 units
	Column   int    `json:"column"`
}

type LoaderRegistration struct {
	FileName      string `json:"fileName"`
	Type          string `json:"type"`
	SandboxSource string `json:"sandboxSource"`
	Line          int    `json:"line"`
	Column        int    `json:"column"`
}

type LoaderRegistrationResult struct {
	Candidate    bool                           `json:"candidate"`
	OK           bool                           `json:"ok"`
	Identified   bool                           `json:"identified"`
	Registration *LoaderRegistration            `json:"registration,omitempty"`
	Diagnostics  []LoaderRegistrationDiagnostic `json:"diagnostics"`
}

type LoaderRegistrationAnalyzer interface {
	LoaderRegistration(context.Context, LoaderRegistrationRequest) (LoaderRegistrationResult, error)
}

type AssetOutputRequest struct {
	Source              string   `json:"source"`
	DeclaredLogicalKeys []string `json:"declaredLogicalKeys"`
}

type AssetOutputResult struct {
	OK         bool     `json:"ok"`
	Message    string   `json:"message"`
	References []string `json:"references"`
}

// AssetOutputValidator checks syntax and the inert-data output grammar, never
// executes the module. It does not replace type checking of the consuming graph.
type AssetOutputValidator interface {
	ValidateAssetOutput(context.Context, AssetOutputRequest) (AssetOutputResult, error)
}

type AssetImportSource struct {
	Path string `json:"path"`
	Text string `json:"text"`
}

// AssetImportsRequest parses authored sources without evaluating them. If
// ResolutionRoot is supplied, the native resolver may read package metadata
// and file identities only below that absolute directory. Omitting it performs
// no disk reads. Paths in Files and the result remain project-relative.
type AssetImportsRequest struct {
	Files          []AssetImportSource `json:"files"`
	ResolutionRoot string              `json:"resolutionRoot,omitempty"`
}
type AssetImportPosition struct {
	Start  int `json:"start"`
	Line   int `json:"line"`
	Column int `json:"column"`
}
type AssetImportRequest struct {
	Specifier     string              `json:"specifier"`
	Attributes    map[string]string   `json:"attributes"`
	Form          string              `json:"form"`
	Site          AssetImportPosition `json:"site"`
	SpecifierSite AssetImportPosition `json:"specifierSite"`
}
type AssetOrdinaryImport struct {
	Specifier    string `json:"specifier"`
	ResolvedPath string `json:"resolvedPath,omitempty"`
}
type AssetImportsFile struct {
	Path            string                         `json:"path"`
	Requests        []AssetImportRequest           `json:"requests"`
	OrdinaryImports []AssetOrdinaryImport          `json:"ordinaryImports"`
	Diagnostics     []LoaderRegistrationDiagnostic `json:"diagnostics"`
}
type AssetImportsResult struct {
	Files []AssetImportsFile `json:"files"`
}
type AssetImportsAnalyzer interface {
	AssetImports(context.Context, AssetImportsRequest) (AssetImportsResult, error)
}

type TranspileSource struct {
	Path string `json:"path"`
	Text string `json:"text"`
}

// TranspileRequest converts ordinary TypeScript/JavaScript files independently.
// It does NOT check types, resolve imports or lower VibeLang. Options are
// validated native emission controls; default target/module/newline are
// ES2022/ESNext/LF. Files must not name VibeLang or declaration sources.
type TranspileRequest struct {
	Files   []TranspileSource `json:"files"`
	Options Options           `json:"options,omitempty"`
}
type TranspiledSource struct {
	Path        string       `json:"path"`
	EmitSkipped bool         `json:"emitSkipped"`
	JavaScript  string       `json:"javascript"`
	SourceMap   string       `json:"sourceMap"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}
type TranspileResult struct {
	Files []TranspiledSource `json:"files"`
}
type Transpiler interface {
	Transpile(context.Context, TranspileRequest) (TranspileResult, error)
}

// BundleModulesRequest analyzes an already-checked/lowered worker closure.
// This validates its module boundaries and reads bound registration calls;
// it does not issue a checked implementation contract or mint nominal IDs.
type BundleModulesRequest struct {
	Files              []TranspileSource `json:"files"`
	RuntimeSpecifier   string            `json:"runtimeSpecifier"`
	RuntimeHelpers     []string          `json:"runtimeHelpers"`
	RegistrationExport string            `json:"registrationExport"`
}
type BundleModuleDiagnostic struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}
type BundleRegistration struct {
	Path      string `json:"path"`
	ClassName string `json:"className"`
	Identity  string `json:"identity"`
}
type BundleModulesResult struct {
	Diagnostics   []BundleModuleDiagnostic `json:"diagnostics"`
	Registrations []BundleRegistration     `json:"registrations"`
}
type BundleModulesAnalyzer interface {
	BundleModules(context.Context, BundleModulesRequest) (BundleModulesResult, error)
}

type CanonicalFunctionRequest struct {
	Source string `json:"source"`
}
type CanonicalFunctionResult struct {
	OK      bool   `json:"ok"`
	Code    string `json:"code"`
	Message string `json:"message"`
}
type FunctionCanonicalizer interface {
	CanonicalFunction(context.Context, CanonicalFunctionRequest) (CanonicalFunctionResult, error)
}

// RuntimeModulesRequest reads graph facts, not checked-program certificates.
// ParseDiagnostics are explicit recovery diagnostics for the consuming compiler.
// Optional native resolution can read only package metadata below ResolutionRoot.
// Resolution messages belong to individual specifiers, which may instead be
// owned by an asset loader; they grant no authority to read or emit an asset.
type RuntimeModuleSource struct {
	Path                          string `json:"path"`
	Text                          string `json:"text"`
	DeferComputedDynamicSpecifier bool   `json:"deferComputedDynamicSpecifier,omitempty"`
}
type RuntimeModulesRequest struct {
	Files          []RuntimeModuleSource `json:"files"`
	ResolutionRoot string                `json:"resolutionRoot,omitempty"`
}
type RuntimeModuleEdge struct {
	Kind                 string `json:"kind"`
	Specifier            string `json:"specifier"`
	Start                int    `json:"start"`
	End                  int    `json:"end"`
	TypeOnly             bool   `json:"typeOnly"`
	ModuleInitialization bool   `json:"moduleInitialization"`
	Attributes           bool   `json:"attributes"`
}
type RuntimeModuleDiagnostic struct {
	AssetImportPosition
	Message string `json:"message"`
}
type RuntimeModuleResolution struct {
	Specifier   string `json:"specifier"`
	RuntimePath string `json:"runtimePath,omitempty"`
	TypePath    string `json:"typePath,omitempty"`
	Message     string `json:"message"`
}
type RuntimeModuleFile struct {
	Path             string                    `json:"path"`
	Edges            []RuntimeModuleEdge       `json:"edges"`
	LeadingNoThrow   bool                      `json:"leadingNoThrow"`
	FirstStatement   AssetImportPosition       `json:"firstStatement"`
	Diagnostics      []RuntimeModuleDiagnostic `json:"diagnostics"`
	ParseDiagnostics []Diagnostic              `json:"parseDiagnostics"`
	Resolutions      []RuntimeModuleResolution `json:"resolutions"`
}
type RuntimeModulesResult struct {
	Files []RuntimeModuleFile `json:"files"`
}
type RuntimeModulesAnalyzer interface {
	RuntimeModules(context.Context, RuntimeModulesRequest) (RuntimeModulesResult, error)
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
