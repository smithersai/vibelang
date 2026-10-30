package vibelangfmt

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"io"
	"slices"
	"strings"
	"testing"
	"time"
)

// fakeHost plays dprint's side of the process plugin protocol.
type fakeHost struct {
	t      *testing.T
	in     io.WriteCloser // the plugin's stdin
	out    *bufio.Reader  // the plugin's stdout
	nextID uint32
}

type hostMessage struct {
	id, kind uint32
	body     []uint32 // the u32 fields, in order
	sized    [][]byte // the sized fields, in order
}

func (h *fakeHost) u32() uint32 {
	h.t.Helper()
	var b [4]byte
	if _, err := io.ReadFull(h.out, b[:]); err != nil {
		h.t.Fatalf("reading from the plugin: %v", err)
	}
	return binary.BigEndian.Uint32(b[:])
}

func (h *fakeHost) sized() []byte {
	h.t.Helper()
	data := make([]byte, h.u32())
	if _, err := io.ReadFull(h.out, data); err != nil {
		h.t.Fatalf("reading from the plugin: %v", err)
	}
	return data
}

// read reads one message from the plugin.
func (h *fakeHost) read() hostMessage {
	h.t.Helper()
	m := hostMessage{id: h.u32(), kind: h.u32()}
	switch m.kind {
	case messageSuccess:
		m.body = []uint32{h.u32()}
	case messageDataResponse, messageError:
		m.body = []uint32{h.u32()}
		m.sized = [][]byte{h.sized()}
	case messageFormatResponse:
		m.body = []uint32{h.u32(), h.u32()}
		if m.body[1] == 1 {
			m.sized = [][]byte{h.sized()}
		}
	case messageHostFormat:
		m.body = []uint32{h.u32()}
		m.sized = append(m.sized, h.sized())
		m.body = append(m.body, h.u32(), h.u32())
		m.sized = append(m.sized, h.sized(), h.sized())
	default:
		h.t.Fatalf("the plugin sent message kind %d", m.kind)
	}
	var end [4]byte
	if _, err := io.ReadFull(h.out, end[:]); err != nil || !slices.Equal(end[:], successBytes) {
		h.t.Fatalf("a message from the plugin did not end with the success bytes")
	}
	return m
}

// send writes one message to the plugin and returns its id.
func (h *fakeHost) send(kind uint32, fields ...any) uint32 {
	h.t.Helper()
	h.nextID++
	data := message(nil).u32(h.nextID).u32(kind)
	for _, field := range fields {
		switch v := field.(type) {
		case uint32:
			data = data.u32(v)
		case string:
			data = data.sized([]byte(v))
		}
	}
	data = append(data, successBytes...)
	if _, err := h.in.Write(data); err != nil {
		h.t.Fatalf("writing to the plugin: %v", err)
	}
	return h.nextID
}

func startPlugin(t *testing.T) (*fakeHost, chan error) {
	t.Helper()
	pluginIn, hostOut := io.Pipe()
	hostIn, pluginOut := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- ServePlugin(pluginIn, pluginOut, PluginOptions{Version: "9.9.9", License: "license text"})
		pluginOut.Close()
	}()
	h := &fakeHost{t: t, in: hostOut, out: bufio.NewReader(hostIn)}
	if _, err := hostOut.Write([]byte{0, 0, 0, 0}); err != nil {
		t.Fatal(err)
	}
	if status, version := h.u32(), h.u32(); status != 0 || version != pluginSchemaVersion {
		t.Fatalf("schema establishment answered %d %d", status, version)
	}
	return h, done
}

func TestPluginAnswersDprint(t *testing.T) {
	t.Parallel()
	h, done := startPlugin(t)

	id := h.send(messageGetPluginInfo)
	info := h.read()
	if info.kind != messageDataResponse || info.body[0] != id {
		t.Fatalf("plugin info answered %+v", info)
	}
	var plugin map[string]any
	if err := json.Unmarshal(info.sized[0], &plugin); err != nil || plugin["name"] != PluginName || plugin["configKey"] != "vibelang" || plugin["version"] != "9.9.9" {
		t.Fatalf("plugin info %s", info.sized[0])
	}

	id = h.send(messageRegisterConfig, uint32(1), `{"lineWidth":120}`, `{"lineWidth":80}`)
	if m := h.read(); m.kind != messageSuccess || m.body[0] != id {
		t.Fatalf("register config answered %+v", m)
	}
	h.send(messageGetFileMatchingInfo, uint32(1))
	if m := h.read(); m.kind != messageDataResponse || string(m.sized[0]) != `{"fileExtensions":["vibe"],"fileNames":[]}` {
		t.Fatalf("file matching answered %s", m.sized[0])
	}
	h.send(messageGetConfigDiagnostic, uint32(1))
	if m := h.read(); m.kind != messageDataResponse || !strings.Contains(string(m.sized[0]), `"propertyName":"lineWidth"`) {
		t.Fatalf("diagnostics answered %s", m.sized[0])
	}

	// Format a file: the plugin asks the host to format its TypeScript form,
	// and the host's formatter indents it.
	source := "function f(): string!Gone {\nreturn withSpan(\"x\") { return 1 }\n}\n"
	formatID := h.send(messageFormat, "/repo/a.vibe", uint32(0), uint32(len(source)), uint32(1), "", source)
	request := h.read()
	if request.kind != messageHostFormat || request.body[0] != formatID || string(request.sized[0]) != "/repo/a.vibe.ts" {
		t.Fatalf("host format request %+v", request)
	}
	if string(request.sized[1]) != `{"module.sortImportDeclarations":"maintain","module.sortExportDeclarations":"maintain","importDeclaration.sortNamedImports":"maintain","exportDeclaration.sortNamedExports":"maintain"}` {
		t.Fatalf("host formatting must preserve module evaluation order and the order of named imports and exports: %s", request.sized[1])
	}
	typescript := string(request.sized[2])
	formatted := strings.Replace(strings.Replace(typescript, "\nreturn", "\n  return", 1), "{ return 1 })", "{\n    return 1\n  })", 1)
	h.send(messageFormatResponse, request.id, uint32(1), formatted)
	response := h.read()
	if response.kind != messageFormatResponse || response.body[0] != formatID || response.body[1] != 1 {
		t.Fatalf("format answered %+v", response)
	}
	if got, want := string(response.sized[0]), "function f(): string!Gone {\n  return withSpan(\"x\") {\n    return 1\n  }\n}\n"; got != want {
		t.Fatalf("formatted\n%s\nwant\n%s", got, want)
	}

	// A file the host leaves unchanged is reported unchanged.
	unchanged := "const v = 1\n"
	formatID = h.send(messageFormat, "/repo/b.vibe", uint32(0), uint32(len(unchanged)), uint32(1), "", unchanged)
	request = h.read()
	h.send(messageFormatResponse, request.id, uint32(0))
	if m := h.read(); m.kind != messageFormatResponse || m.body[0] != formatID || m.body[1] != 0 {
		t.Fatalf("an unchanged file answered %+v", m)
	}

	// A file with a syntax error fails without asking the host.
	broken := "const v = (\n"
	formatID = h.send(messageFormat, "/repo/c.vibe", uint32(0), uint32(len(broken)), uint32(1), "", broken)
	if m := h.read(); m.kind != messageError || m.body[0] != formatID || !strings.HasPrefix(string(m.sized[0]), "vibelang format: 1:12: Expression expected") {
		t.Fatalf("a syntax error answered %+v %s", m, m.sized)
	}

	// A failed host format fails the file.
	formatID = h.send(messageFormat, "/repo/d.vibe", uint32(0), uint32(len(unchanged)), uint32(1), "", unchanged)
	request = h.read()
	h.send(messageError, request.id, "typescript plugin failed")
	if m := h.read(); m.kind != messageError || m.body[0] != formatID || !strings.Contains(string(m.sized[0]), "typescript plugin failed") {
		t.Fatalf("a failed host format answered %+v", m)
	}

	id = h.send(messageClose)
	if m := h.read(); m.kind != messageSuccess || m.body[0] != id {
		t.Fatalf("close answered %+v", m)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the plugin did not stop after close")
	}
}

// TestPluginFormatsConcurrently checks that the plugin keeps reading while
// a format waits for the host, so two files can format at once.
func TestPluginFormatsConcurrently(t *testing.T) {
	t.Parallel()
	h, _ := startPlugin(t)
	h.send(messageRegisterConfig, uint32(1), `{}`, `{}`)
	h.read()
	a, b := "const a = 1\n", "const b  =  2\n"
	first := h.send(messageFormat, "/a.vibe", uint32(0), uint32(len(a)), uint32(1), "", a)
	second := h.send(messageFormat, "/b.vibe", uint32(0), uint32(len(b)), uint32(1), "", b)
	requests := map[uint32]hostMessage{}
	for range 2 {
		m := h.read()
		requests[m.body[0]] = m
	}
	// Answer the second request first.
	h.send(messageFormatResponse, requests[second].id, uint32(1), "const b = 2\n")
	h.send(messageFormatResponse, requests[first].id, uint32(0))
	got := map[uint32]hostMessage{}
	for range 2 {
		m := h.read()
		got[m.body[0]] = m
	}
	if got[first].body[1] != 0 || got[second].body[1] != 1 || string(got[second].sized[0]) != "const b = 2\n" {
		t.Fatalf("concurrent formats answered %+v", got)
	}
	h.in.Close()
}
