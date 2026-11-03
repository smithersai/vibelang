import { Effect } from "effect"
export function probe(s:unknown){return [Array.isArray(s),s instanceof Date,s instanceof RegExp,s instanceof Map,s instanceof Set,s instanceof Promise,s instanceof Uint8Array,s instanceof BigInt64Array,s instanceof ArrayBuffer,s instanceof Error,s instanceof AggregateError]}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>{const constructors=[Array,Date,RegExp,Map,Set,Promise,Uint8Array,BigInt64Array,ArrayBuffer,Error,AggregateError];return constructors.map(C=>probe(Object.create(C.prototype)))})}
