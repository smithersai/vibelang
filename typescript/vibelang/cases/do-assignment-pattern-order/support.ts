/** Native abrupt-completion fixture: no expected Effect failure.
 * @throws {never}
 */
export function fail(value: string): any { throw value }
export function describe(error: unknown) { return error instanceof Error ? { name: error.name, message: error.message } : error }
