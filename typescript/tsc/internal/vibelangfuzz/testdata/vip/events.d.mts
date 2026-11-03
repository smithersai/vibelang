/**
 * Appends a label to the run's event log.
 * @throws {never}
 */
export declare function ev(label: string): void;
/**
 * Throws value: a call known to throw, for Effect.try's thunk.
 * @throws {unknown}
 */
export declare function raise(value: unknown): never;
/** Empties the event log. */
export declare function reset(): void;
/** The labels logged since the last reset, in order. */
export declare function events(): readonly string[];
