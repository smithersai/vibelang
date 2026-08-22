package compiler

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// PinnedTypeScriptRevision is the exact smithersai/TypeScript revision this
// bridge accepts. Keep it in sync with typescript-fork.json; a test enforces
// the lock.
const PinnedTypeScriptRevision = "c087644e82dc3d48cf87e4c5519eeaaea9daf35c"

const forkBridgeAPIVersion = APIVersion

var (
	// ErrForkUnavailable means the exact source checkout or required Go
	// toolchain could not be used. There is deliberately no JavaScript fallback.
	ErrForkUnavailable = errors.New("pinned TypeScript fork unavailable")
	// ErrForkProtocol means the pinned bridge returned an invalid or explicitly
	// rejected request/response.
	ErrForkProtocol = errors.New("pinned TypeScript fork protocol error")
)

// ForkConfig locates an exact TypeScript checkout and a disposable/cacheable
// directory for the bridge binary. CheckoutDirectory is the repository root
// containing tsc/go.mod, not the tsc directory itself.
type ForkConfig struct {
	CheckoutDirectory string
	CacheDirectory    string
	GoCommand         string
}

// ForkError preserves the failed operation while allowing errors.Is checks.
type ForkError struct {
	Op     string
	Detail string
	Err    error
}

func (e *ForkError) Error() string {
	if e.Detail == "" {
		return fmt.Sprintf("TypeScript fork %s: %v", e.Op, e.Err)
	}
	return fmt.Sprintf("TypeScript fork %s: %s: %v", e.Op, e.Detail, e.Err)
}

func (e *ForkError) Unwrap() error { return e.Err }

//go:embed forkbridge/main.go.txt
var forkBridgeSource []byte

// NewPinnedFork verifies, builds, and handshakes with a compiler bridge from
// the exact locked fork revision. The bridge is compiled with Go's overlay
// facility, so the external checkout remains byte-for-byte untouched.
func NewPinnedFork(ctx context.Context, config ForkConfig) (Compiler, error) {
	executable, err := preparePinnedForkBridge(ctx, config)
	if err != nil {
		return nil, err
	}
	return &forkCompiler{executable: executable}, nil
}

type forkCompiler struct {
	executable string
}

type forkEnvelope struct {
	APIVersion       int            `json:"apiVersion"`
	CompilerRevision string         `json:"compilerRevision"`
	Result           *CompileResult `json:"result"`
	Error            *forkWireError `json:"error,omitempty"`
}

type forkWireError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (c *forkCompiler) Compile(ctx context.Context, request CompileRequest) (CompileResult, error) {
	if err := ctx.Err(); err != nil {
		return CompileResult{EmitSkipped: true}, err
	}
	request, result, err := hydrateCompileRequest(request)
	if err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return CompileResult{EmitSkipped: true}, err
	}

	payload, err := json.Marshal(request)
	if err != nil {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "encode request", Err: errors.Join(ErrForkProtocol, err)}
	}

	command := exec.CommandContext(ctx, c.executable)
	command.Stdin = bytes.NewReader(payload)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return CompileResult{EmitSkipped: true}, ctxErr
		}
		return CompileResult{EmitSkipped: true}, &ForkError{
			Op:     "execute bridge",
			Detail: strings.TrimSpace(stderr.String()),
			Err:    errors.Join(ErrForkUnavailable, err),
		}
	}

	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	decoder.DisallowUnknownFields()
	var envelope forkEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "decode response", Detail: stderr.String(), Err: errors.Join(ErrForkProtocol, err)}
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "decode response", Detail: stderr.String(), Err: errors.Join(ErrForkProtocol, fmt.Errorf("expected one JSON value: %w", err))}
	}
	if envelope.APIVersion != forkBridgeAPIVersion || envelope.CompilerRevision != PinnedTypeScriptRevision {
		return CompileResult{EmitSkipped: true}, &ForkError{
			Op:     "validate response",
			Detail: fmt.Sprintf("got API %d revision %q", envelope.APIVersion, envelope.CompilerRevision),
			Err:    ErrForkProtocol,
		}
	}
	if envelope.Result == nil || envelope.Result.Diagnostics == nil || envelope.Result.Artifacts == nil {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "validate response", Detail: "missing result or result collections", Err: ErrForkProtocol}
	}
	if envelope.Error != nil {
		return *envelope.Result, &ForkError{
			Op:     envelope.Error.Code,
			Detail: envelope.Error.Message,
			Err:    ErrForkProtocol,
		}
	}
	return *envelope.Result, nil
}

func hydrateCompileRequest(request CompileRequest) (CompileRequest, CompileResult, error) {
	if len(request.RootNames) == 0 {
		result := CompileResult{
			Diagnostics: []Diagnostic{{
				Code:     "VIBE0002",
				Category: DiagnosticError,
				Message:  "the pinned compiler bridge requires at least one root name",
				Phase:    PhaseParse,
			}},
			EmitSkipped: true,
		}
		return request, result, &ForkError{Op: "validate request", Err: ErrForkProtocol}
	}
	if err := validateLoweredRequest(request); err != nil {
		result := CompileResult{
			Diagnostics: []Diagnostic{{
				Code:     "VIBE0004",
				Category: DiagnosticError,
				Message:  err.Error(),
				Phase:    PhaseLower,
			}},
			EmitSkipped: true,
		}
		return request, result, &ForkError{Op: "validate request", Detail: err.Error(), Err: ErrForkProtocol}
	}
	if len(request.Files) != 0 {
		return request, CompileResult{}, nil
	}

	originalRootNames := request.RootNames
	request.RootNames = make([]string, 0, len(originalRootNames))
	request.Files = make([]SourceFile, 0, len(originalRootNames))
	for _, rootName := range originalRootNames {
		content, err := os.ReadFile(rootName)
		if err != nil {
			result := CompileResult{
				Diagnostics: []Diagnostic{{
					Code:     "VIBE0003",
					Category: DiagnosticError,
					Message:  err.Error(),
					File:     rootName,
					Phase:    PhaseParse,
				}},
				EmitSkipped: true,
			}
			return request, result, &ForkError{Op: "read root", Detail: rootName, Err: errors.Join(ErrForkProtocol, err)}
		}
		logicalName, err := logicalPathForDiskRoot(rootName)
		if err != nil {
			return request, CompileResult{EmitSkipped: true}, err
		}
		request.RootNames = append(request.RootNames, logicalName)
		request.Files = append(request.Files, SourceFile{
			Path: logicalName,
			Kind: fileKindForPath(rootName),
			Text: string(content),
		})
	}
	return request, CompileResult{}, nil
}

func logicalPathForDiskRoot(name string) (string, error) {
	logicalName := filepath.Clean(name)
	if filepath.IsAbs(logicalName) {
		workingDirectory, err := os.Getwd()
		if err != nil {
			return "", &ForkError{Op: "canonicalize root", Detail: name, Err: errors.Join(ErrForkProtocol, err)}
		}
		logicalName, err = filepath.Rel(workingDirectory, logicalName)
		if err != nil {
			return "", &ForkError{Op: "canonicalize root", Detail: name, Err: errors.Join(ErrForkProtocol, err)}
		}
	}
	if logicalName == "." || logicalName == ".." || strings.HasPrefix(logicalName, ".."+string(filepath.Separator)) {
		return "", &ForkError{Op: "canonicalize root", Detail: name + " is outside the working directory", Err: ErrForkProtocol}
	}
	return filepath.ToSlash(logicalName), nil
}

func fileKindForPath(name string) FileKind {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".vibe":
		return FileKindVibe
	default:
		return FileKindTypeScript
	}
}

func preparePinnedForkBridge(ctx context.Context, config ForkConfig) (string, error) {
	if config.CheckoutDirectory == "" {
		return "", &ForkError{Op: "locate checkout", Detail: "CheckoutDirectory is empty", Err: ErrForkUnavailable}
	}
	checkout, err := filepath.Abs(config.CheckoutDirectory)
	if err != nil {
		return "", &ForkError{Op: "locate checkout", Err: errors.Join(ErrForkUnavailable, err)}
	}
	checkout, err = filepath.EvalSymlinks(checkout)
	if err != nil {
		return "", &ForkError{Op: "locate checkout", Err: errors.Join(ErrForkUnavailable, err)}
	}
	if err := verifyPinnedCheckout(ctx, checkout); err != nil {
		return "", err
	}

	cacheBase := config.CacheDirectory
	if cacheBase == "" {
		cacheBase, err = os.UserCacheDir()
		if err != nil {
			return "", &ForkError{Op: "locate cache", Err: errors.Join(ErrForkUnavailable, err)}
		}
		cacheBase = filepath.Join(cacheBase, "vibelang", "typescript-bridge")
	}
	cacheBase, err = resolvePathForCreation(cacheBase)
	if err != nil {
		return "", &ForkError{Op: "locate cache", Err: errors.Join(ErrForkUnavailable, err)}
	}
	digest := sha256.Sum256(forkBridgeSource)
	cacheDirectory := filepath.Join(cacheBase, PinnedTypeScriptRevision+"-"+hex.EncodeToString(digest[:8])+"-"+runtime.GOOS+"-"+runtime.GOARCH)
	if pathsOverlap(checkout, cacheDirectory) {
		return "", &ForkError{
			Op:     "locate cache",
			Detail: "bridge cache and TypeScript checkout must not overlap",
			Err:    ErrForkUnavailable,
		}
	}
	if err := os.MkdirAll(cacheDirectory, 0o755); err != nil {
		return "", &ForkError{Op: "create cache", Err: errors.Join(ErrForkUnavailable, err)}
	}

	executableName := "vibelang-typescript-bridge"
	if runtime.GOOS == "windows" {
		executableName += ".exe"
	}
	executable := filepath.Join(cacheDirectory, executableName)
	if revision, _ := bridgeRevision(ctx, executable); revision == PinnedTypeScriptRevision {
		return executable, nil
	}

	buildDirectory, err := os.MkdirTemp(cacheDirectory, "build-*")
	if err != nil {
		return "", &ForkError{Op: "create build directory", Err: errors.Join(ErrForkUnavailable, err)}
	}
	defer os.RemoveAll(buildDirectory)
	replacement := filepath.Join(buildDirectory, "main.go")
	if err := os.WriteFile(replacement, forkBridgeSource, 0o644); err != nil {
		return "", &ForkError{Op: "materialize overlay", Err: errors.Join(ErrForkUnavailable, err)}
	}
	overlayPath := filepath.Join(buildDirectory, "overlay.json")
	overlay := struct {
		Replace map[string]string `json:"Replace"`
	}{Replace: map[string]string{
		filepath.Join(checkout, "tsc", "cmd", "tsc", "main.go"): replacement,
	}}
	overlayJSON, err := json.Marshal(overlay)
	if err != nil {
		return "", &ForkError{Op: "encode overlay", Err: errors.Join(ErrForkUnavailable, err)}
	}
	if err := os.WriteFile(overlayPath, overlayJSON, 0o644); err != nil {
		return "", &ForkError{Op: "materialize overlay", Err: errors.Join(ErrForkUnavailable, err)}
	}

	goCommand := config.GoCommand
	if goCommand == "" {
		goCommand = "go"
	}
	temporaryExecutable := filepath.Join(buildDirectory, executableName)
	command := exec.CommandContext(
		ctx,
		goCommand,
		"build",
		"-trimpath",
		"-overlay", overlayPath,
		"-ldflags", "-X main.compilerRevision="+PinnedTypeScriptRevision+" -X main.bridgeAPIVersion="+strconv.Itoa(forkBridgeAPIVersion),
		"-o", temporaryExecutable,
		"./cmd/tsc",
	)
	command.Dir = filepath.Join(checkout, "tsc")
	command.Env = environmentWithout("GOWORK")
	command.Env = append(command.Env, "GOWORK=off")
	var buildOutput bytes.Buffer
	command.Stdout = &buildOutput
	command.Stderr = &buildOutput
	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", &ForkError{
			Op:     "build bridge",
			Detail: strings.TrimSpace(buildOutput.String()),
			Err:    errors.Join(ErrForkUnavailable, err),
		}
	}
	if err := os.Rename(temporaryExecutable, executable); err != nil {
		// Another cold-cache builder may have atomically installed the same
		// revision first. Accept only a successful exact-revision handshake.
		if revision, _ := bridgeRevision(ctx, executable); revision == PinnedTypeScriptRevision {
			return executable, nil
		}
		return "", &ForkError{Op: "install bridge", Err: errors.Join(ErrForkUnavailable, err)}
	}
	if revision, handshakeErr := bridgeRevision(ctx, executable); revision != PinnedTypeScriptRevision {
		detail := fmt.Sprintf("bridge reported revision %q", revision)
		if handshakeErr != nil {
			detail += ": " + handshakeErr.Error()
		}
		return "", &ForkError{Op: "handshake", Detail: detail, Err: ErrForkProtocol}
	}
	return executable, nil
}

// resolvePathForCreation resolves symlinks in the deepest existing ancestor
// without creating the requested path. This lets overlap checks happen before
// any cache directory is written.
func resolvePathForCreation(name string) (string, error) {
	absolute, err := filepath.Abs(name)
	if err != nil {
		return "", err
	}
	candidate := filepath.Clean(absolute)
	missing := make([]string, 0)
	for {
		resolved, err := filepath.EvalSymlinks(candidate)
		if err == nil {
			for index := len(missing) - 1; index >= 0; index-- {
				resolved = filepath.Join(resolved, missing[index])
			}
			return filepath.Clean(resolved), nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(candidate)
		if parent == candidate {
			return "", err
		}
		missing = append(missing, filepath.Base(candidate))
		candidate = parent
	}
}

func pathsOverlap(first string, second string) bool {
	return pathContains(first, second) || pathContains(second, first)
}

func pathContains(parent string, child string) bool {
	relative, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return relative == "." || relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func verifyPinnedCheckout(ctx context.Context, checkout string) error {
	revisionCommand := exec.CommandContext(ctx, "git", "-C", checkout, "rev-parse", "HEAD")
	revisionBytes, err := revisionCommand.Output()
	if err != nil {
		return &ForkError{Op: "verify revision", Detail: checkout, Err: errors.Join(ErrForkUnavailable, err)}
	}
	if revision := strings.TrimSpace(string(revisionBytes)); revision != PinnedTypeScriptRevision {
		return &ForkError{
			Op:     "verify revision",
			Detail: fmt.Sprintf("got %q, require %q", revision, PinnedTypeScriptRevision),
			Err:    ErrForkUnavailable,
		}
	}
	statusCommand := exec.CommandContext(ctx, "git", "-C", checkout, "status", "--porcelain", "--untracked-files=all", "--", "tsc")
	statusBytes, err := statusCommand.Output()
	if err != nil {
		return &ForkError{Op: "verify worktree", Err: errors.Join(ErrForkUnavailable, err)}
	}
	if status := strings.TrimSpace(string(statusBytes)); status != "" {
		return &ForkError{Op: "verify worktree", Detail: status, Err: ErrForkUnavailable}
	}
	modulePath := filepath.Join(checkout, "tsc", "go.mod")
	moduleBytes, err := os.ReadFile(modulePath)
	if err != nil {
		return &ForkError{Op: "verify compiler module", Detail: modulePath, Err: errors.Join(ErrForkUnavailable, err)}
	}
	if !strings.Contains(string(moduleBytes), "module github.com/microsoft/TypeScript/tsc") {
		return &ForkError{Op: "verify compiler module", Detail: "unexpected tsc/go.mod module path", Err: ErrForkUnavailable}
	}
	return nil
}

func bridgeRevision(ctx context.Context, executable string) (string, error) {
	if _, err := os.Stat(executable); err != nil {
		return "", err
	}
	command := exec.CommandContext(ctx, executable, "--revision")
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%w (%s)", err, strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func environmentWithout(name string) []string {
	prefix := name + "="
	environment := os.Environ()
	result := environment[:0]
	for _, entry := range environment {
		if !strings.HasPrefix(entry, prefix) {
			result = append(result, entry)
		}
	}
	return result
}
