/**
 * @file Jest global setup hook for the commitlint plugin test suite.
 */

/**
 * Prepares the environment before the Jest test suite runs.
 * The suite needs no external services, so nothing is started here.
 * @example
 * // Referenced from jest.config.mjs as the globalSetup module.
 * await setup();
 */
export default async function setup(): Promise<void> {
  // No external services are required for the test suite.
}
