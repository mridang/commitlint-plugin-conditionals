/**
 * @file Jest global teardown hook for the commitlint plugin test suite.
 */

/**
 * Releases resources after the Jest test suite has finished.
 * The suite starts no external services, so there is nothing to stop.
 * @example
 * // Referenced from jest.config.mjs as the globalTeardown module.
 * await teardown();
 */
export default async function teardown(): Promise<void> {
  // No external services to tear down.
}
