package pprof

import (
	"encoding/json"
	"testing"

	"github.com/google/pprof/profile"
)

func TestChromeProfilePreservesInlineCallOrderAndWeights(t *testing.T) {
	outer := &profile.Function{ID: 1, Name: "outer", Filename: "fixture.go"}
	inner := &profile.Function{ID: 2, Name: "inner", Filename: "fixture.go"}
	p := &profile.Profile{
		SampleType:    []*profile.ValueType{{Type: "cpu", Unit: "nanoseconds"}, {Type: "samples", Unit: "count"}},
		DurationNanos: 123000,
		Sample: []*profile.Sample{
			{Location: []*profile.Location{{Line: []profile.Line{{Function: inner, Line: 9}, {Function: outer, Line: 3}}}}, Value: []int64{700, 7}},
			{Location: []*profile.Location{{Line: []profile.Line{{Function: outer, Line: 3}}}}, Value: []int64{200, 2}},
		},
	}
	got := chromeProfile(p)
	if got.EndTime != 123 || len(got.Nodes) != 3 {
		t.Fatalf("profile: %+v", got)
	}
	if got.Nodes[1].CallFrame.FunctionName != "outer" || got.Nodes[1].HitCount != 2 || got.Nodes[2].CallFrame.FunctionName != "inner" || got.Nodes[2].HitCount != 7 {
		t.Fatalf("call tree: %+v", got.Nodes)
	}
	if len(got.Nodes[1].Children) != 1 || got.Nodes[1].Children[0] != 3 {
		t.Fatalf("inline child: %+v", got.Nodes[1])
	}
	data, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["samples"] != nil || fields["timeDeltas"] != nil {
		t.Fatalf("aggregated samples must not invent a timeline: %s", data)
	}
}

func FuzzChromeProfileConservesSamples(f *testing.F) {
	f.Add([]byte{})
	f.Add([]byte{0, 1, 2, 3, 4, 9, 255})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 32 {
			data = data[:32]
		}
		p := &profile.Profile{SampleType: []*profile.ValueType{{Type: "samples", Unit: "count"}}, DurationNanos: int64(len(data)) * 1000}
		var total int64
		for _, value := range data {
			count := int64(value % 8)
			total += count
			sample := &profile.Sample{Value: []int64{count}}
			for j := 0; j <= int(value%6); j++ {
				fn := &profile.Function{ID: uint64(value%4 + 1), Name: string(rune('a' + value%4)), Filename: "fixture.go"}
				sample.Location = append(sample.Location, &profile.Location{Line: []profile.Line{{Function: fn, Line: int64(j + 1)}}})
			}
			p.Sample = append(p.Sample, sample)
		}
		got := chromeProfile(p)
		var actual int64
		reachable := map[int]bool{1: true}
		for i, node := range got.Nodes {
			if node.ID != i+1 || !reachable[node.ID] {
				t.Fatalf("node is not reachable exactly in parent order: %+v", got.Nodes)
			}
			actual += node.HitCount
			for _, child := range node.Children {
				if child <= node.ID || child > len(got.Nodes) || reachable[child] {
					t.Fatalf("invalid tree edge %d -> %d", node.ID, child)
				}
				reachable[child] = true
			}
		}
		if actual != total || got.StartTime != 0 || got.EndTime != int64(len(data)) {
			t.Fatalf("lost CPU counts/duration: got %d want %d; %+v", actual, total, got)
		}
	})
}
