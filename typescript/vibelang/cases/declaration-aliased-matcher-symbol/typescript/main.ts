import {customMatcher} from "vibelang-runtime"
const {customMatcher:key}=Symbol
export type AliasKey=typeof customMatcher
export type DestructuredKey=typeof key
export interface P{[customMatcher](s:unknown):boolean}
export function main():boolean{return typeof customMatcher==="symbol"}
