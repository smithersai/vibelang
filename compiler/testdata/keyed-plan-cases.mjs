// JSON-only protocol inputs shared by the pinned upstream oracle and native
// regression tests. No Flow is evaluated to discover a graph.
export const emptyEffects = { reads: [], writes: [], boundaryMode: "hard" };
export const material = (body, inputs = [], kind = "sealed") => ({
  version: "flows/key-material/v2", kind, body, inputs, layers: [], capabilities: [],
});
export const draft = (id, body = { action: "example/A" }, inputs = [], kind = "sealed") => ({
  id, material: material(body, inputs, kind), effects: emptyEffects,
});
export const ref = (from, path = []) => ({ _tag: "Ref", from, path });
export const pending = (from) => ({ _tag: "Pending", from });
const literal = (value) => ({ _tag: "Literal", value });
const effects = (reads, writes, extra = {}) => ({ reads, writes, boundaryMode: "hard", ...extra });
const writer = (id, writes, extra = {}) => ({ ...draft(id), effects: effects([], writes), ...extra });
const reader = (id, reads, inputs = []) => ({ ...draft(id, { action: "example/Read" }, inputs), effects: effects(reads, []) });
const glob = (include, exclude) => ({ _tag: "Glob", include, ...(exclude ? { exclude } : {}) });
const tree = (path) => ({ _tag: "TreeArtifact", path });
const group = (entries) => ({ _tag: "Filegroup", name: "files", entries });
const options = (nodes) => ({ planId: "alpha-contract", flow: "example/Flow", nodes });
const compile = (name, nodes) => ({ name, operation: "compile", input: options(nodes) });

// Long combining sequences distinguish ECMAScript NFC from stream-safe text.
// Inserting or deleting CGJ changes both identity and filesystem overlap.
const combiningSequences = [
  ["30-marks", "a" + "\u0301".repeat(30)], ["31-marks", "a" + "\u0301".repeat(31)],
  ["40-marks", "a" + "\u0301".repeat(40)], ["leading", "\u0301".repeat(80)],
  ["explicit-cgj", "\u0301".repeat(30) + "\u034f" + "\u0301".repeat(10)],
  ["reordering", "a" + "\u0315\u0301\u0323".repeat(25)],
  ["excluded-composite", "\u0344".repeat(40)],
  ["hangul", "\u1100\u1161\u11a8" + "\u0301".repeat(40)],
  ["multiple-segments", "prefix/a" + "\u0301".repeat(40) + "/\u1100\u1161\u11a8" + "\u0323".repeat(45) + "/tail"],
  ["musical-decomposition", "\u{1d15e}" + "\u0301".repeat(40)],
];
let unicodeSeed = 912347;
const marks = ["\u0301", "\u0327", "\u0323", "\u0315", "\u0308", "\u0344", "\u0345", "\u0340", "\u0341", "\u0316"];
for (let sample = 0; sample < 40; sample++) {
  let text = ["a", "\u1100\u1161\u11a8", "\u1e0b", "\u0344", ""][sample % 5];
  for (let index = 0; index < 35 + sample; index++) {
    unicodeSeed = (Math.imul(unicodeSeed, 1664525) + 1013904223) >>> 0;
    text += marks[unicodeSeed % marks.length];
  }
  combiningSequences.push([`mixed-${sample}`, text]);
}

export const cases = [
  ...[
    ["null", null], ["object-order", { b: 2, a: 1 }], ["lambda", { text: "λ" }], ["empty-string", ""],
    ["numbers", [0, -0, 1e-7, 1e-6, 1e20, 1e21, 333333333.3333333, 5e-324, 1.7976931348623157e308]],
    ["utf16-keys", { "\uE000": 1, "🐱": 2, "\r": 3, "10": 4, "2": 5 }],
    ["escaping", { value: "<>&\u2028\u2029\b\f\n\r\t\\\"" }],
    ["no-nfc-on-json", ["é", "e\u0301"]],
  ].map(([name, input]) => ({ name: `key-${name}`, operation: "derive-key", input })),
  compile("empty", []),
  compile("one", [draft("a")]),
  compile("dependency-order", [draft("b", 2, [ref("a")]), draft("a", 1)]),
  compile("independent", [draft("a"), draft("b", 2)]),
  compile("renamed-address", [draft("renamed")]),
  compile("priority", [{ ...draft("a"), priority: 17 }]),
  compile("negative-priority", [{ ...draft("a"), priority: -9007199254740991 }]),
  compile("agent", [{ ...draft("a"), kind: "agent" }]),
  compile("merge", [{ ...draft("a"), kind: "merge" }]),
  compile("pending", [draft("a"), draft("b", 2, [pending("a")])]),
  compile("projected", [draft("a"), draft("b", 2, [ref("a", ["answer", ""])])]),
  compile("mixed-input-order", [draft("b", 2, [ref("a"), pending("a"), literal(3), ref("a", ["result"])]), draft("a")]),
  compile("literal-digest-shape", [draft("a", 1, [literal({ digest: "key1_" + "0".repeat(64), kind: "digest" })])]),
  compile("prototype-addresses", [draft("toString", 3, [ref("__proto__"), pending("constructor")]), draft("__proto__", 1), draft("constructor", 2)]),
  compile("compensable", [draft("a", 1, [], "compensable")]),
  compile("irreversible", [draft("a", 1, [], "irreversible")]),
  compile("nondeterministic", [{ ...draft("a"), material: { ...material(1), nondeterministic: true } }]),
  compile("placement-null", [{ ...draft("a"), material: { ...material(1), placement: null } }]),
  compile("nfc-sets", [{ ...draft("a"), material: { ...material(1), layers: ["é", "e\u0301", "🐱", "\uE000"], capabilities: ["b", "a", "b"] } }]),
  compile("nfc-normal-sets", [{ ...draft("a"), material: { ...material(1), layers: ["🐱", "é", "\uE000"], capabilities: ["a", "b"] } }]),
  ...combiningSequences.map(([name, text]) => compile(`long-nfc-${name}`, [{ ...draft("a"), material: { ...material(1), layers: [text, text.normalize("NFC")], capabilities: [text.normalize("NFD"), text] } }])),
  compile("long-nfc-cgj-distinct-paths", [writer("a", ["\u0301".repeat(40)], { conflictStrategy: "fail" }), writer("b", ["\u0301".repeat(30) + "\u034f" + "\u0301".repeat(10)])]),
  compile("long-nfc-path-alias", [writer("a", ["a" + "\u0301\u0323".repeat(30)]), writer("b", [("a" + "\u0301\u0323".repeat(30)).normalize("NFC")])]),
  compile("effects-override", [{ ...draft("a"), material: { ...material({ action: "example/A" }), effects: { hostile: true }, excess: 1 }, excess: 2,
    effects: { ...emptyEffects, excess: 3 } }]),
  compile("empty-removes-present", [{ ...draft("a"), effects: { ...emptyEffects, removes: [] } }]),
  compile("expected-boundary", [{ ...draft("a"), effects: { ...emptyEffects, boundaryMode: "expected" } }]),
  compile("write-serialize", [writer("a", ["out"]), writer("b", ["out"])]),
  compile("write-lane", [writer("a", ["out"], { conflictStrategy: "lane" }), writer("b", ["out"], { runtimeStrategy: "stop-merge" })]),
  compile("write-disjoint", [writer("a", ["one"]), writer("b", ["two"], { conflictStrategy: "fail" })]),
  compile("write-explicit-order", [writer("a", ["out"]), writer("b", ["out"], { material: material(2, [pending("a")]), conflictStrategy: "fail" })]),
  compile("read-after-writer", [reader("a", ["out"]), writer("b", ["out"])]),
  compile("read-old-version", [reader("a", ["out"]), writer("b", ["out"], { material: material(2, [pending("a")]) })]),
  compile("backslash-alias", [writer("a", ["dist\\same.js"]), writer("b", ["dist/same.js"])]),
  compile("nfc-path-alias", [writer("a", ["cafe\u0301/data"]), writer("b", ["café/data"])]),
  compile("trees", [writer("a", [tree("out")]), writer("b", [tree("out/sub")]), reader("c", ["out/sub/file"])]),
  compile("tree-prefix-control", [writer("a", [tree("out")]), writer("b", ["outside/file"])]),
  compile("glob-exclusion", [writer("a", [glob(["src/**/*.ts"], ["src/test/**"])]), writer("b", ["src/test/a.ts"]), writer("c", ["src/a.ts"])]),
  compile("glob-conservative", [writer("a", [glob(["a/**"])]), writer("b", [glob(["b/**"])]), writer("c", [tree("c")])]),
  compile("group-order", [writer("a", [group(["x", glob(["src/**"]), "x"])]), writer("b", ["x", "src/a"]), reader("c", [group(["x"])])]),
  compile("removal-producer", [{ ...draft("a"), effects: effects([], [], { removes: ["out"] }) }, reader("b", ["out"])]),
  compile("literal-star", [writer("a", ["src/*.ts"]), writer("b", ["src/a.ts"])]),
  compile("glob-regex-escaping", [writer("a", [glob(["src/[a]+(b)?.ts"])]), writer("b", ["src/[a]+(b)?.ts"]), writer("c", ["src/aab.ts"])]),
  compile("unicode-line-terminators", [writer("a", [glob(["**"])]), writer("b", ["file\u2028"]), writer("c", ["file\u2028middle"])]),
  compile("unicode-star", [writer("a", [glob(["*"])]), writer("b", ["file\u2028middle"])]),
  compile("c1-path", [writer("a", ["file\u0085"]), writer("b", ["file\u0085"])]),
  compile("missing-body", [{ ...draft("a"), material: { version: "flows/key-material/v2", kind: "sealed", inputs: [], layers: [], capabilities: [] } }]),
  compile("missing-literal-value", [draft("a", 1, [{ _tag: "Literal" }])]),
  compile("duplicate", [draft("a", 1), draft("a", 2)]),
  compile("unknown-dependency", [draft("a", 1, [ref("missing")])]),
  compile("cycle", [draft("a", 1, [ref("b")]), draft("b", 2, [ref("a")])]),
  compile("write-forbidden", [writer("a", ["out"], { conflictStrategy: "fail" }), writer("b", ["out"])]),
  compile("read-inferred-cycle", [writer("a", ["out"], { effects: effects(["out"], ["out"]) }), writer("b", ["out"])]),
  compile("write-and-remove", [{ ...writer("a", [tree("out")]), effects: effects([], [tree("out")], { removes: ["out/a"] }) }]),
  ...["/absolute", "C:/drive", "a/../b", "a/./b", "a//b", "a/", "\\absolute", "nul\u0000", "del\u007f", ""].map((path, index) => compile(`bad-path-${index}`, [writer("a", [path])])),
  compile("tree-read", [reader("a", [tree("out")])]),
  compile("nested-group", [writer("a", [group([group(["out"])])])]),
  compile("empty-glob", [writer("a", [glob([])])]),
  ...[
    ["tier", { material: material(1, [], "assumed") }],
    ["version", { material: { ...material(1), version: "flows/key-material/v1" } }],
    ["nondeterministic-false", { material: { ...material(1), nondeterministic: false } }],
    ["priority", { priority: 0.5 }], ["unsafe-priority", { priority: 9007199254740992 }],
    ["kind", { kind: "unknown" }], ["strategy", { conflictStrategy: "ignore" }],
    ["runtime", { runtimeStrategy: "ignore" }], ["null-priority", { priority: null }],
    ["effects", { effects: { reads: [], writes: [] } }], ["input-tag", { material: material(1, [{ kind: "ref", from: "a" }]) }],
  ].map(([name, fields]) => compile(`bad-${name}`, [{ ...draft("a"), ...fields }])),
];

export const appendCases = [
  { name: "dependency", base: options([draft("a")]), nodes: [draft("b", 2, [ref("a")])] },
  { name: "frozen-conflict", base: options([writer("a", ["out"])]), nodes: [writer("b", ["out"])] },
  { name: "frozen-reader", base: options([reader("a", ["out"])]), nodes: [writer("b", ["out"])] },
  { name: "new-reader", base: options([writer("a", ["out"])]), nodes: [reader("b", ["out"])] },
  { name: "empty-base", base: options([]), nodes: [draft("a")] },
  { name: "empty-append", base: options([draft("a")]), nodes: [] },
  { name: "duplicate-append", base: options([draft("a")]), nodes: [draft("a")] },
];
