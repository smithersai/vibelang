package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"testing"
)

var vipFieldKeys = []string{
	"$fiber", "$exit", "$cause", "$reason", "$array", "$map", "$set", "$class",
	"$number", "$undefined", "$bigint", "$symbol", "$function", "$cycle", "$deep",
	"fields", "__proto__", "constructor", "toString", "hasOwnProperty", "valueOf",
	"prototype", "__defineGetter__", "vipField_setter", "vipField_readonly",
}

func vipFieldObject(class any, fields map[string]any) map[string]any {
	return map[string]any{"$class": class, "fields": fields}
}
func vipFieldSuccess(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"_tag": "Success", "value": value})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func vipFieldInterrupt(id int) map[string]any {
	return map[string]any{"$exit": map[string]any{"_tag": "Failure", "reasons": []any{
		map[string]any{"_tag": "Interrupt", "fiberId": map[string]any{"$fiber": id}},
	}}}
}

// Source-keyed dictionaries are not encoded-value nodes. A dictionary entry
// may have any of the encoder's tag spellings without becoming a runtime tag.
func TestVIPCanonicalFieldNames(t *testing.T) {
	for _, class := range []any{"Object", "Error", nil} {
		for _, key := range vipFieldKeys {
			t.Run(fmt.Sprint(class)+"/"+key, func(t *testing.T) {
				first, e1 := CanonicalVIPExit(vipFieldSuccess(t, vipFieldObject(class, map[string]any{key: 1})))
				second, e2 := CanonicalVIPExit(vipFieldSuccess(t, vipFieldObject(class, map[string]any{key: 2})))
				if e1 != nil || e2 != nil {
					t.Fatalf("source field interpreted as control: %v / %v", e1, e2)
				}
				if first == second {
					t.Fatalf("changed source field hidden: %s", first)
				}
			})
		}
	}
	t.Run("source values cannot alias actual fiber IDs", func(t *testing.T) {
		run := func(id int) string {
			value := vipFieldObject("Object", map[string]any{
				"data":    vipFieldObject("Object", map[string]any{"$fiber": 20}),
				"runtime": vipFieldInterrupt(id),
			})
			got, err := CanonicalVIPExit(vipFieldSuccess(t, value))
			if err != nil {
				t.Fatal(err)
			}
			return got
		}
		if first, second := run(20), run(99); first != second {
			t.Fatalf("runtime IDs captured source data:\n%s\n%s", first, second)
		}
	})
	t.Run("field values still carry actual runtime tags", func(t *testing.T) {
		raw := func(id int) json.RawMessage {
			return vipFieldSuccess(t, vipFieldObject("Object", map[string]any{"$fiber": vipFieldInterrupt(id)}))
		}
		first, e1 := CanonicalVIPExit(raw(20))
		second, e2 := CanonicalVIPExit(raw(99))
		if e1 != nil || e2 != nil || first != second {
			t.Fatalf("runtime normalization changed: %s / %s / %v / %v", first, second, e1, e2)
		}
		// Marshal the independently constructed expected value, without passing
		// that expectation through the normalizer being tested.
		if want := string(raw(0)); first != want {
			t.Fatalf("nested runtime value lost: got %s, want %s", first, want)
		}
		malformed := vipFieldObject("Object", map[string]any{"data": map[string]any{"$exit": map[string]any{"_tag": "Success"}}})
		if _, err := CanonicalVIPExit(vipFieldSuccess(t, malformed)); err == nil {
			t.Fatal("malformed actual nested Exit admitted")
		}
	})
}

// Exercise the actual worker, including CreateDataProperty-style source
// keys that would invoke Object.prototype setters on an ordinary dictionary.
func TestVIPEncodedFieldNames(t *testing.T) {
	env := newVIPEnv(t)
	keys, err := json.Marshal(vipFieldKeys)
	if err != nil {
		t.Fatal(err)
	}
	body := `export const main = () => Effect.sync(() => {
 const keys = ` + string(keys) + `;
 const values = [];
 Object.defineProperty(Object.prototype,"vipField_setter",{configurable:true,set(){throw new Error("inherited setter ran")}});
 Object.defineProperty(Object.prototype,"vipField_readonly",{configurable:true,writable:false,value:0});
 for (const kind of ["Object","Error","null"]) for (const key of keys) {
  const value = kind === "Object" ? {} : kind === "Error" ? new TypeError("source") : Object.create(null);
  Object.defineProperty(value,key,{enumerable:true,configurable:true,writable:true,value:7});
  values.push(value);
 }
 return values;
})`
	out := env.runVIPModule(t, "source-field-names", body)
	if out.Kind != "exit" {
		t.Fatalf("worker did not finish: %+v", out)
	}
	var encoded struct {
		Tag   string `json:"_tag"`
		Value struct {
			Values []struct {
				Class  any                        `json:"$class"`
				Fields map[string]json.RawMessage `json:"fields"`
			} `json:"$array"`
		} `json:"value"`
	}
	if err := json.Unmarshal(out.Exit, &encoded); err != nil {
		t.Fatal(err)
	}
	if encoded.Tag != "Success" || len(encoded.Value.Values) != 3*len(vipFieldKeys) {
		t.Fatalf("wrong source values: %s", out.Exit)
	}
	for i, value := range encoded.Value.Values {
		key := vipFieldKeys[i%len(vipFieldKeys)]
		if len(value.Fields) != 1 || string(value.Fields[key]) != "7" {
			t.Errorf("source field %q changed: %s", key, value.Fields[key])
		}
	}
}
