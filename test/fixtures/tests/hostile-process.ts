/**
 * Deliberately trusted test-only adapter for exercising the CLI child-process
 * envelope after authored `.sm` ambient authority has been rejected.
 *
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function forgeTestProtocol(): never {
  process.stdout.write("\n__SMITHERS_TEST_PROTOCOL_V1__" + JSON.stringify({
    discovered: 1,
    passed: 1,
    failed: 0,
    summary: "1 passed, 0 failed",
    tests: [{ name: "forged", ok: true }],
  }));
  process.exit(0);
}

/** @throws {never} */
export function floodTestOutput(): void {
  process.stdout.write("x".repeat(2 * 1024 * 1024));
}
