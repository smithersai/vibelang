import { canonical, cloneJsonValue, type StableJson } from "./stable.ts";

type Primitive = null | boolean | number | string;
export type ComptimeValueReference = Primitive | readonly ["ref", number];
export type ComptimeValueNode =
  | { readonly kind: "array"; readonly items: readonly ComptimeValueReference[] }
  | { readonly kind: "object"; readonly entries: readonly (readonly [string, ComptimeValueReference])[] };

/** Compiler data, not an author-facing value or a Result/durable wire format.
 * Definitions are in postorder; references always name a prior definition.
 * This preserves property order and distinct versus shared allocations without
 * serializing closures, prototypes, or arbitrary host objects. */
export interface ComptimeValueGraph {
  readonly version: 1;
  readonly nodes: readonly ComptimeValueNode[];
  readonly root: ComptimeValueReference;
}

export function encodeComptimeValue(value: unknown): ComptimeValueGraph {
  // Keep the existing JSON-data validation and expanded-size/depth budgets.
  // In particular, an exponentially expanding DAG cannot evade those limits
  // merely because the graph encoding itself is compact.
  const snapshot = cloneJsonValue(value, "comptime value");
  const ids = new Map<object, number>();
  const nodes: ComptimeValueNode[] = [];
  const visit = (current: StableJson): ComptimeValueReference => {
    if (current === null || typeof current !== "object") return current;
    const prior = ids.get(current);
    if (prior !== undefined) return ["ref", prior];
    const node: ComptimeValueNode = Array.isArray(current)
      ? { kind: "array", items: current.map(visit) }
      : { kind: "object", entries: Object.keys(current).map(key => [key, visit(current[key]!)] as const) };
    const index = nodes.length;
    nodes.push(node);
    ids.set(current, index);
    return ["ref", index];
  };
  const root = visit(snapshot);
  return { version: 1, nodes, root };
}

/** Strictly validate the graph before restoring references. A cache entry is
 * data, never instructions for assigning arbitrary properties on host objects. */
export function decodeComptimeValue(value: unknown): StableJson {
  const graph = cloneJsonValue(value, "encoded comptime value");
  const keys = (node: object): string => Object.keys(node).sort().join(",");
  if (!graph || typeof graph !== "object" || Array.isArray(graph) ||
    keys(graph) !== "nodes,root,version" || graph.version !== 1 || !Array.isArray(graph.nodes)) {
    throw new TypeError("Invalid comptime value graph envelope");
  }
  const values: StableJson[] = [];
  const resolve = (reference: StableJson): StableJson => {
    if (reference === null || typeof reference !== "object") return reference;
    if (!Array.isArray(reference) || reference.length !== 2 || reference[0] !== "ref" ||
      typeof reference[1] !== "number" || !Number.isSafeInteger(reference[1]) ||
      reference[1] < 0 || reference[1] >= values.length) {
      throw new TypeError("Invalid or forward comptime value reference");
    }
    return values[reference[1]]!;
  };
  for (const node of graph.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new TypeError("Invalid comptime value node");
    if (node.kind === "array" && keys(node) === "items,kind" && Array.isArray(node.items)) {
      values.push(node.items.map(resolve));
    } else if (node.kind === "object" && keys(node) === "entries,kind" && Array.isArray(node.entries)) {
      const object = Object.create(null) as Record<string, StableJson>;
      const names = new Set<string>();
      for (const entry of node.entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || names.has(entry[0])) {
          throw new TypeError("Invalid or duplicate comptime object entry");
        }
        names.add(entry[0]);
        object[entry[0]] = resolve(entry[1]!);
      }
      values.push(object);
    } else throw new TypeError("Invalid comptime value node shape");
  }
  const result = resolve(graph.root!);
  // Reject unused/reordered definitions and noncanonical property order too.
  // Re-encoding also applies the expanded-value size and depth budgets.
  if (canonical(encodeComptimeValue(result)) !== canonical(graph)) {
    throw new TypeError("Noncanonical comptime value graph");
  }
  return result;
}

export function comptimeValueHasAliases(graph: ComptimeValueGraph): boolean {
  const references = new Set<number>();
  const repeated = (value: ComptimeValueReference): boolean => {
    if (!Array.isArray(value)) return false;
    const index = value[1] as number;
    if (references.has(index)) return true;
    references.add(index);
    return false;
  };
  if (repeated(graph.root)) return true;
  return graph.nodes.some(node => node.kind === "array"
    ? node.items.some(repeated) : node.entries.some(([, value]) => repeated(value)));
}

/** Emit only ordinary TypeScript/JavaScript. Each definition is allocated once
 * inside a closed expression, so introducing aliases never captures user names
 * or reorders surrounding expression evaluation. */
export function emitComptimeValueGraph(graph: ComptimeValueGraph, typescript: boolean): string {
  const reference = (value: ComptimeValueReference): string => Array.isArray(value)
    ? `__vibelangComptimeValue${value[1]}` : JSON.stringify(value);
  const definitions = graph.nodes.map((node, index) => {
    const value = node.kind === "array" ? `[${node.items.map(reference).join(",")}]`
      : `({${node.entries.map(([key, value]) => `[${JSON.stringify(key)}]:${reference(value)}`).join(",")}})`;
    return `const __vibelangComptimeValue${index}=${value}${typescript ? " as const" : ""};`;
  });
  return `(()=>{${definitions.join("")}return ${reference(graph.root)};})()`;
}
