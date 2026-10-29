package vibelangmapper

import (
	"context"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/contentmapper"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"gotest.tools/v3/assert"
)

// TestHostTransform drives the mapper with TypeScript's own content mapper
// host over an in-memory connection: initialize, openProject and transform
// as tsc sends them, then the validation and parse tsc applies to the result.
func TestHostTransform(t *testing.T) {
	t.Parallel()
	spawner := contentmapper.SpawnerFunc(func(command []string, dir string, stderr io.Writer) (io.ReadWriteCloser, error) {
		client, server := net.Pipe()
		go func() { _ = Serve(context.Background(), server) }()
		return client, nil
	})
	host := contentmapper.NewHost(t.Context(), spawner, locale.Default)
	defer host.Close()
	mapper := &contentmapper.Mapper{
		Definition: contentmapper.Definition{Package: "vibelang-ts-mapper", Extensions: []string{".vibe"}},
		Manifest:   contentmapper.Manifest{Name: "vibelang-ts-mapper", Version: "0.0.1", Exec: []string{"./bin/vibelang-mapper"}, DynamicConfig: true},
	}
	project := host.Project(contentmapper.ProjectSpec{ConfigFileName: "/p/tsconfig.json", Mappers: []*contentmapper.Mapper{mapper}})
	defer project.Close()

	fileName := tspath.RootedFilePathFromAbsolute("/p/greet.vibe")
	content := "error EmptyName { name: string }\nexport function greet(name: string) {\n  if (name === \"\") throw new EmptyName({ name })\n  return join name\n}\n"
	files, err := contentmapper.TransformAndParse(ast.SourceFileParseOptions{FileName: fileName}, content, mapper, project)
	assert.NilError(t, err)

	file := files.Canonical
	assert.Equal(t, file.VirtualFileName(), fileName.AppendSuffix(".ts"))
	assert.Equal(t, file.OriginalText(), content)
	assert.Equal(t, file.Text(), Project(content, FileContextOf(fileName.AsString())).Text)
	// The mapper's EK4611 on the invalid join operand arrives in original coordinates. Filter
	// by source: ParseResult parses the virtual text under the original
	// name, greet.vibe, so in the fork the parser reads it with VibeLang
	// syntax and reports none of the TS1434 errors stock tsc reports there.
	var mapperDiagnostics []*ast.Diagnostic
	for _, d := range file.Diagnostics() {
		if d.Source() == DiagnosticSource {
			mapperDiagnostics = append(mapperDiagnostics, d)
		}
	}
	assert.Equal(t, len(mapperDiagnostics), 1)
	assert.Equal(t, mapperDiagnostics[0].Code(), int32(4611))
	assert.Equal(t, content[mapperDiagnostics[0].Pos():mapperDiagnostics[0].End()], "name")
}

// TestVersionMismatchDiagnostic checks that openProject reports EK9002 for
// a project that installs another effect than the forms table pins, as a
// diagnostic on the mapper's tsconfig entry.
func TestVersionMismatchDiagnostic(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	assert.NilError(t, os.MkdirAll(filepath.Join(dir, "node_modules", "effect"), 0o755))
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "node_modules", "effect", "package.json"), []byte(`{"name": "effect", "version": "3.0.0"}`), 0o644))
	result, err := (&Handler{}).HandleRequest(t.Context(), contentmapper.MethodOpenProject,
		[]byte(`{"configFileName":`+strconv.Quote(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))+`,"projectHandle":"p","compilerOptions":{}}`))
	assert.NilError(t, err)
	diagnostics := result.(contentmapper.OpenProjectResult).OptionDiagnostics
	assert.Equal(t, len(diagnostics), 1)
	assert.Equal(t, diagnostics[0].Code, int32(CodeVersionMismatch))
	assert.Assert(t, strings.Contains(diagnostics[0].MessageText, "effect 3.0.0 (the table pins 4.1.0)"), diagnostics[0].MessageText)
}

// TestTracingOption checks that the mapper entry's tracing option reaches
// each file's context, and that an invalid value is a diagnostic on it.
func TestTracingOption(t *testing.T) {
	t.Parallel()
	h := &Handler{}
	_, err := h.HandleRequest(t.Context(), contentmapper.MethodOpenProject, []byte(`{"configFileName":"","projectHandle":"p","options":{"tracing":"all"},"compilerOptions":{}}`))
	assert.NilError(t, err)
	assert.Equal(t, h.projects["p"].Tracing, "all")
	result, err := h.HandleRequest(t.Context(), contentmapper.MethodOpenProject, []byte(`{"configFileName":"","projectHandle":"q","options":{"tracing":"some"},"compilerOptions":{}}`))
	assert.NilError(t, err)
	diagnostics := result.(contentmapper.OpenProjectResult).OptionDiagnostics
	assert.Equal(t, len(diagnostics), 1)
	assert.Equal(t, diagnostics[0].Code, int32(CodeInvalidOption))
	assert.Equal(t, h.projects["q"].Tracing, "")
}

// TestInitializeRequiresUTF8 checks that the mapper refuses a host that does
// not accept its byte offsets.
func TestInitializeRequiresUTF8(t *testing.T) {
	t.Parallel()
	_, err := (&Handler{}).HandleRequest(t.Context(), contentmapper.MethodInitialize, []byte(`{"positionEncodings":["utf-16"]}`))
	assert.ErrorContains(t, err, "utf-8")
	result, err := (&Handler{}).HandleRequest(t.Context(), contentmapper.MethodInitialize, []byte(`{"positionEncodings":["utf-8","utf-16"]}`))
	assert.NilError(t, err)
	assert.Equal(t, result.(contentmapper.InitializeResult).PositionEncoding, contentmapper.PositionEncodingUTF8)
}
