package pprof

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	runtimepprof "runtime/pprof"
	"time"

	"github.com/google/pprof/profile"
)

// JSONProfile holds the native compiler's CPU samples until compilation ends.
type JSONProfile struct {
	data bytes.Buffer
	file *os.File
}

func BeginJSONProfile(path string) (*JSONProfile, error) {
	if info, err := os.Stat(path); err == nil && info.IsDir() {
		name := time.Now().UTC().Format("2006-01-02T15-04-05.000Z") + fmt.Sprintf("+P%d.cpuprofile", os.Getpid())
		path = filepath.Join(path, name)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	file, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	session := &JSONProfile{file: file}
	if err := runtimepprof.StartCPUProfile(&session.data); err != nil {
		file.Close()
		return nil, err
	}
	return session, nil
}

func (p *JSONProfile) Stop() (err error) {
	runtimepprof.StopCPUProfile()
	defer func() { err = errors.Join(err, p.file.Close()) }()
	samples, err := profile.ParseData(p.data.Bytes())
	if err != nil {
		return err
	}
	return json.NewEncoder(p.file).Encode(chromeProfile(samples))
}

type profileFrame struct {
	FunctionName string `json:"functionName"`
	ScriptID     string `json:"scriptId"`
	URL          string `json:"url"`
	LineNumber   int64  `json:"lineNumber"`
	ColumnNumber int64  `json:"columnNumber"`
}

type profileNode struct {
	ID        int          `json:"id"`
	CallFrame profileFrame `json:"callFrame"`
	HitCount  int64        `json:"hitCount"`
	Children  []int        `json:"children,omitempty"`
}

type cpuProfile struct {
	Nodes     []profileNode `json:"nodes"`
	StartTime int64         `json:"startTime"`
	EndTime   int64         `json:"endTime"`
}

// Chrome's CPU profile format permits aggregated call-tree hit counts without
// samples/timeDeltas. Go aggregates repeated stacks, so exporting those optional
// time-series fields would invent an order that the original profile did not keep.
// https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile
func chromeProfile(p *profile.Profile) cpuProfile {
	result := cpuProfile{
		Nodes:   []profileNode{{ID: 1, CallFrame: profileFrame{FunctionName: "(root)", ScriptID: "0", LineNumber: -1, ColumnNumber: -1}}},
		EndTime: p.DurationNanos / 1000,
	}
	type frameKey struct {
		parent int
		frame  profileFrame
	}
	ids := map[frameKey]int{}
	countIndex := 0
	for i, sampleType := range p.SampleType {
		if sampleType.Type == "samples" && sampleType.Unit == "count" {
			countIndex = i
			break
		}
	}
	for _, sample := range p.Sample {
		parent := 1
		for i := len(sample.Location) - 1; i >= 0; i-- {
			location := sample.Location[i]
			lines := location.Line
			if len(lines) == 0 {
				lines = []profile.Line{{}}
			}
			for j := len(lines) - 1; j >= 0; j-- {
				line := lines[j]
				frame := profileFrame{FunctionName: fmt.Sprintf("(address %x)", location.Address), ScriptID: "0", LineNumber: line.Line - 1, ColumnNumber: line.Column - 1}
				if function := line.Function; function != nil {
					frame.FunctionName = function.Name
					frame.ScriptID = fmt.Sprint(function.ID)
					frame.URL = function.Filename
				}
				key := frameKey{parent, frame}
				id, found := ids[key]
				if !found {
					id = len(result.Nodes) + 1
					ids[key] = id
					result.Nodes[parent-1].Children = append(result.Nodes[parent-1].Children, id)
					result.Nodes = append(result.Nodes, profileNode{ID: id, CallFrame: frame})
				}
				parent = id
			}
		}
		if countIndex < len(sample.Value) {
			result.Nodes[parent-1].HitCount += sample.Value[countIndex]
		}
	}
	return result
}
