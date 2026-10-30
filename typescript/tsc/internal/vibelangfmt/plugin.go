package vibelangfmt

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
)

// The dprint process plugin (dprint's process plugin schema version 5,
// https://github.com/dprint/dprint/blob/main/docs/process-plugin-development.md).
//
// dprint starts the plugin's executable with --parent-pid and talks to it
// over stdin and stdout. The plugin claims .vibe files. To format one it
// writes the file as TypeScript and asks dprint to format that with the
// plugin that formats .ts files, under the configuration's "typescript"
// settings (a host format request), so a .vibe file follows exactly the
// style of the TypeScript beside it.

// PluginName is the plugin's name, which is also the name of its executable
// in a plugin archive.
const PluginName = "dprint-plugin-vibelang"

// PluginConfigKey is the key of the plugin's section of a dprint configuration.
const PluginConfigKey = "vibelang"

const (
	messageSuccess             = 0
	messageDataResponse        = 1
	messageError               = 2
	messageClose               = 3
	messageIsAlive             = 4
	messageGetPluginInfo       = 5
	messageGetLicenseText      = 6
	messageRegisterConfig      = 7
	messageReleaseConfig       = 8
	messageGetConfigDiagnostic = 9
	messageGetFileMatchingInfo = 10
	messageGetResolvedConfig   = 11
	messageCheckConfigUpdates  = 12
	messageFormat              = 13
	messageFormatResponse      = 14
	messageCancelFormat        = 15
	messageHostFormat          = 16
	pluginSchemaVersion        = 5
)

var successBytes = []byte{255, 255, 255, 255}

// PluginOptions describe the plugin to dprint.
type PluginOptions struct {
	Version string
	License string
	HelpURL string
}

// pluginServer is one plugin process's side of the protocol.
type pluginServer struct {
	options PluginOptions
	reader  *bufio.Reader
	writer  io.Writer
	writeMu sync.Mutex
	nextID  atomic.Uint32

	mu      sync.Mutex
	configs map[uint32]map[string]any
	// hosts holds the reply channel of each host format request in flight.
	hosts map[uint32]chan hostReply
	wg    sync.WaitGroup
}

type hostReply struct {
	text    string
	changed bool
	err     error
}

// ServePlugin answers dprint's messages on in and out until dprint closes the
// plugin or the input ends.
func ServePlugin(in io.Reader, out io.Writer, options PluginOptions) error {
	s := &pluginServer{options: options, reader: bufio.NewReader(in), writer: out, configs: map[uint32]map[string]any{}, hosts: map[uint32]chan hostReply{}}
	// Schema establishment: dprint sends 0 and expects 0 and the schema version.
	request, err := s.readU32()
	if err != nil {
		return err
	}
	if request != 0 {
		return fmt.Errorf("dprint plugin: expected a schema version request, got %d", request)
	}
	if err := s.writeRaw(binary.BigEndian.AppendUint32(binary.BigEndian.AppendUint32(nil, 0), pluginSchemaVersion)); err != nil {
		return err
	}
	for {
		closed, err := s.handleMessage()
		if closed {
			return nil
		}
		if errors.Is(err, io.EOF) {
			s.wg.Wait()
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func (s *pluginServer) readU32() (uint32, error) {
	var b [4]byte
	if _, err := io.ReadFull(s.reader, b[:]); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint32(b[:]), nil
}

func (s *pluginServer) readSized() ([]byte, error) {
	size, err := s.readU32()
	if err != nil {
		return nil, err
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(s.reader, data); err != nil {
		return nil, err
	}
	return data, nil
}

func (s *pluginServer) readSuccessBytes() error {
	var b [4]byte
	if _, err := io.ReadFull(s.reader, b[:]); err != nil {
		return err
	}
	if !slices.Equal(b[:], successBytes) {
		return fmt.Errorf("dprint plugin: a message did not end with the success bytes")
	}
	return nil
}

func (s *pluginServer) writeRaw(data []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err := s.writer.Write(data)
	return err
}

// message is an outgoing message's body, built field by field.
type message []byte

func (m message) u32(v uint32) message { return binary.BigEndian.AppendUint32(m, v) }

func (m message) sized(data []byte) message { return append(m.u32(uint32(len(data))), data...) }

// send writes one message of kind with body, under a new message id, and
// returns the id.
func (s *pluginServer) send(kind uint32, body message) (uint32, error) {
	id := s.nextID.Add(1)
	data := message(nil).u32(id).u32(kind)
	data = append(data, body...)
	data = append(data, successBytes...)
	return id, s.writeRaw(data)
}

// sendHostFormat asks dprint to format text as the file at path. The reply
// channel is registered before the request is written, since the reply may
// arrive at once.
func (s *pluginServer) sendHostFormat(original uint32, path string, text string) (chan hostReply, error) {
	reply := make(chan hostReply, 1)
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	id := s.nextID.Add(1)
	s.mu.Lock()
	s.hosts[id] = reply
	s.mu.Unlock()
	data := message(nil).u32(id).u32(messageHostFormat).u32(original).sized([]byte(path)).u32(0).u32(uint32(len(text))).sized([]byte(`{"module.sortImportDeclarations":"maintain","module.sortExportDeclarations":"maintain","importDeclaration.sortNamedImports":"maintain","exportDeclaration.sortNamedExports":"maintain"}`)).sized([]byte(text))
	data = append(data, successBytes...)
	if _, err := s.writer.Write(data); err != nil {
		return nil, err
	}
	return reply, nil
}

func (s *pluginServer) success(id uint32) error {
	_, err := s.send(messageSuccess, message(nil).u32(id))
	return err
}

func (s *pluginServer) data(id uint32, data []byte) error {
	_, err := s.send(messageDataResponse, message(nil).u32(id).sized(data))
	return err
}

func (s *pluginServer) fail(id uint32, err error) error {
	_, sendErr := s.send(messageError, message(nil).u32(id).sized([]byte(err.Error())))
	return sendErr
}

func (s *pluginServer) json(id uint32, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return s.fail(id, err)
	}
	return s.data(id, data)
}

// handleMessage reads and answers one message. It reports whether dprint
// closed the plugin.
func (s *pluginServer) handleMessage() (bool, error) {
	id, err := s.readU32()
	if err != nil {
		return false, err
	}
	kind, err := s.readU32()
	if err != nil {
		return false, err
	}
	switch kind {
	case messageClose:
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		return true, s.success(id)
	case messageIsAlive, messageGetPluginInfo, messageGetLicenseText:
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		switch kind {
		case messageIsAlive:
			return false, s.success(id)
		case messageGetPluginInfo:
			return false, s.json(id, map[string]any{
				"name":            PluginName,
				"version":         s.options.Version,
				"configKey":       PluginConfigKey,
				"helpUrl":         s.options.HelpURL,
				"configSchemaUrl": "",
				"updateUrl":       nil,
			})
		default:
			return false, s.data(id, []byte(s.options.License))
		}
	case messageRegisterConfig:
		configID, err := s.readU32()
		if err != nil {
			return false, err
		}
		if _, err := s.readSized(); err != nil { // the global configuration
			return false, err
		}
		pluginConfig, err := s.readSized()
		if err != nil {
			return false, err
		}
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		config := map[string]any{}
		if len(pluginConfig) != 0 {
			if err := json.Unmarshal(pluginConfig, &config); err != nil {
				return false, s.fail(id, err)
			}
		}
		s.mu.Lock()
		s.configs[configID] = config
		s.mu.Unlock()
		return false, s.success(id)
	case messageReleaseConfig, messageGetConfigDiagnostic, messageGetFileMatchingInfo, messageGetResolvedConfig:
		configID, err := s.readU32()
		if err != nil {
			return false, err
		}
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		s.mu.Lock()
		config, ok := s.configs[configID]
		if kind == messageReleaseConfig {
			delete(s.configs, configID)
		}
		s.mu.Unlock()
		switch kind {
		case messageReleaseConfig:
			return false, s.success(id)
		case messageGetConfigDiagnostic:
			diagnostics := []map[string]string{}
			keys := make([]string, 0, len(config))
			for key := range config {
				keys = append(keys, key)
			}
			slices.Sort(keys)
			for _, key := range keys {
				diagnostics = append(diagnostics, map[string]string{"propertyName": key, "message": "Unknown property in configuration. The vibelang plugin formats .vibe files with the \"typescript\" settings."})
			}
			return false, s.json(id, diagnostics)
		case messageGetFileMatchingInfo:
			if !ok {
				return false, s.fail(id, fmt.Errorf("did not find configuration for id: %d", configID))
			}
			return false, s.json(id, map[string]any{"fileExtensions": []string{"vibe"}, "fileNames": []string{}})
		default:
			if !ok {
				return false, s.fail(id, fmt.Errorf("did not find configuration for id: %d", configID))
			}
			return false, s.json(id, map[string]any{})
		}
	case messageCheckConfigUpdates:
		if _, err := s.readSized(); err != nil {
			return false, err
		}
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		return false, s.json(id, map[string]any{"changes": []any{}})
	case messageFormat:
		return false, s.handleFormat(id)
	case messageFormatResponse:
		original, err := s.readU32()
		if err != nil {
			return false, err
		}
		changed, err := s.readU32()
		if err != nil {
			return false, err
		}
		var text []byte
		if changed == 1 {
			if text, err = s.readSized(); err != nil {
				return false, err
			}
		}
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		s.reply(original, hostReply{text: string(text), changed: changed == 1})
		return false, nil
	case messageError:
		original, err := s.readU32()
		if err != nil {
			return false, err
		}
		text, err := s.readSized()
		if err != nil {
			return false, err
		}
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		s.reply(original, hostReply{err: errors.New(string(text))})
		return false, nil
	case messageSuccess, messageCancelFormat:
		if _, err := s.readU32(); err != nil {
			return false, err
		}
		return false, s.readSuccessBytes()
	case messageDataResponse:
		if _, err := s.readU32(); err != nil {
			return false, err
		}
		if _, err := s.readSized(); err != nil {
			return false, err
		}
		return false, s.readSuccessBytes()
	case messageHostFormat:
		// Only a plugin asks to host format; read the request and refuse it.
		if _, err := s.readU32(); err != nil {
			return false, err
		}
		if _, err := s.readSized(); err != nil {
			return false, err
		}
		for range 2 {
			if _, err := s.readU32(); err != nil {
				return false, err
			}
		}
		for range 2 {
			if _, err := s.readSized(); err != nil {
				return false, err
			}
		}
		if err := s.readSuccessBytes(); err != nil {
			return false, err
		}
		return false, s.fail(id, errors.New("the vibelang plugin cannot host format"))
	default:
		// The rest of an unknown message cannot be read; the process must end.
		return false, fmt.Errorf("dprint plugin: unknown message kind %d", kind)
	}
}

func (s *pluginServer) reply(original uint32, reply hostReply) {
	s.mu.Lock()
	channel, ok := s.hosts[original]
	delete(s.hosts, original)
	s.mu.Unlock()
	if ok {
		channel <- reply
	}
}

// handleFormat reads a format request and formats the file on its own
// goroutine, so the plugin keeps reading the host's replies.
func (s *pluginServer) handleFormat(id uint32) error {
	path, err := s.readSized()
	if err != nil {
		return err
	}
	start, err := s.readU32()
	if err != nil {
		return err
	}
	end, err := s.readU32()
	if err != nil {
		return err
	}
	if _, err := s.readU32(); err != nil { // the configuration id
		return err
	}
	if _, err := s.readSized(); err != nil { // the override configuration
		return err
	}
	text, err := s.readSized()
	if err != nil {
		return err
	}
	if err := s.readSuccessBytes(); err != nil {
		return err
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		if start != 0 || int(end) != len(text) {
			// A range: the formatter formats whole files only.
			_, _ = s.send(messageFormatResponse, message(nil).u32(id).u32(0))
			return
		}
		source := string(text)
		formatTypeScript := func(typescript string) (string, error) {
			reply, err := s.sendHostFormat(id, string(path)+".ts", typescript)
			if err != nil {
				return "", err
			}
			r := <-reply
			if r.err != nil {
				return "", r.err
			}
			if !r.changed {
				return typescript, nil
			}
			return r.text, nil
		}
		result, err := Format(string(path), source, formatTypeScript)
		switch {
		case err != nil:
			_ = s.fail(id, errors.New(strings.TrimPrefix(err.Error(), string(path)+": ")))
		case result == source:
			_, _ = s.send(messageFormatResponse, message(nil).u32(id).u32(0))
		default:
			_, _ = s.send(messageFormatResponse, message(nil).u32(id).u32(1).sized([]byte(result)))
		}
	}()
	return nil
}
