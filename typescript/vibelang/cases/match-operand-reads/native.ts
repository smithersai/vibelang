import { Match } from "effect";
import { importedReady as literalReady, computedReady, mutableReady } from "./constants.ts";
const trace: string[] = [];
const config = { get ready(): 2 { trace.push("get:value"); return 2; } };
const captured = { get ready(): 2 { trace.push("get:type"); return 2; } };
const stable = { ready: 2 as const };
export function choose(value: number): string {
  return Match.value(value).pipe(
    Match.when(1, (): string => "first"),
    Match.when(config.ready, (): string => "second"),
    Match.orElse((): string => "miss"));
}
const chooseCaptured = Match.type<number>().pipe(
  Match.when(captured.ready, (): string => "hit"),
  Match.orElse((): string => "miss"));
export function chooseStable(value: number): string {
  return Match.value(value).pipe(
    Match.when(stable.ready, (): string => "hit"),
    Match.orElse((): string => "miss"));
}
export function chooseLocal(value: number): string {
  const localReady = 2;
  return Match.value(value).pipe(
    Match.when(localReady, (): string => "hit"),
    Match.orElse((): string => "miss"));
}
export function chooseImported(value: number): string {
  return Match.value(value).pipe(
    Match.when(literalReady, (): string => "hit"),
    Match.orElse((): string => "miss"));
}
export function chooseComputed(value: number): string {
  return Match.value(value).pipe(
    Match.when(computedReady, (): string => "hit"),
    Match.orElse((): string => "miss"));
}
export function chooseMutable(value: number): string {
  return Match.value(value).pipe(
    Match.when(mutableReady, (): string => "hit"),
    Match.orElse((): string => "miss"));
}
export const initialized = [...trace];
export function inspect(): { before: string[]; value: string[]; type: string[]; data: string[]; local: string[]; imported: string[]; computed: string[]; mutable: string[]; after: string[] } {
  const before = [...trace];
  const value = [1, 2, 3].map(choose);
  const type = [1, 2, 3].map(chooseCaptured);
  const data = [1, 2, 3].map(chooseStable);
  const local = [1, 2, 3].map(chooseLocal);
  const imported = [1, 2, 3].map(chooseImported);
  const computed = [1, 2, 3].map(chooseComputed);
  const mutable = [1, 2, 3].map(chooseMutable);
  return { before, value, type, data, local, imported, computed, mutable, after: [...trace] };
}

function chooseBeforeReady(value: number): string {
  return Match.value(value).pipe(Match.when(1, (): string => "first"), Match.when(eagerReady, (): string => "second"), Match.orElse((): string => "miss"));
}
export const earlyResult = ((): string => { try { return chooseBeforeReady(1) } catch { return "tdz" } })();
const eagerReady = 2;
