/**
 * Compiler-owned request keys shared by body emission and artifact validation.
 * These data constants must not load the execution runtime into the compiler.
 * Site kind and key are both checked, so an Action cannot impersonate a timer.
 */
export const DURABLE_SLEEP_KEY = "vibelang:flows/sleep@1"
