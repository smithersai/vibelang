/** Keep the predicate documentation, including café 😀. 
 * @throws {never}
 */
export const isResolved = <T>(v: T | undefined): v is T => v !== undefined
