/**
 * Appends a label to the run's event log.
 * @throws {never}
 */
export declare function ev(label: string): void;
/** Empties the event log. */
export declare function reset(): void;
/** The labels logged since the last reset, in order. */
export declare function events(): readonly string[];
