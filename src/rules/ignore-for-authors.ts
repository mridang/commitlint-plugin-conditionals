/**
 * @file Implements the `ignore-for-authors` commitlint rule, which bypasses a configured rule set for trusted sign-offs.
 */
import type { Rule, RuleConfigCondition, RuleOutcome } from '@commitlint/types';
import type { Commit } from 'conventional-commits-parser';

/**
 * Configuration for a single external rule to be enforced if the commit
 * is not from an ignored author.
 */
export interface ExternalRuleToEnforce {
  /**
   * The name of the NPM package that exports the rule.
   * Examples: '@commitlint/rules', 'commitlint-plugin-jira'.
   */
  packageName: string;

  /**
   * The name of the rule as exported by the `rules` object of the plugin
   * specified in `packageName`.
   * Example: 'type-enum', 'header-max-length', 'jira-task-id-empty'.
   */
  ruleName: string;

  /**
   * The value/options to pass to the target rule. The structure of this
   * value depends entirely on the requirements of the target rule from
   * the specified package.
   */
  value: unknown;
}

/**
 * Options for the `ignoreForAuthors` rule.
 * This rule allows for bypassing a set of specified linting rules if the
 * commit matches an author pattern, or enforcing those rules otherwise.
 */
export interface IgnoreForAuthorsRuleOptions {
  /**
   * An array of string patterns. If any of these patterns are found
   * within the raw commit message (`parsed.raw`), the `rulesToEnforce`
   * (if any) will be skipped, and this main rule will pass.
   * If omitted or empty, author pattern checking is skipped and
   * `rulesToEnforce` are always processed.
   */
  signOffPatternsToIgnore?: string[];

  /**
   * An array of external rule configurations to apply if the commit does
   * not have a `Signed-off-by:` line matching `signOffPatternsToIgnore`.
   * If this array is empty or not provided, and no ignored sign-off is
   * found, this main rule will pass.
   */
  rulesToEnforce?: ExternalRuleToEnforce[];
}

/**
 * Checks whether a value is a non-null object at runtime, so its properties can be read by name.
 * @param value - The value to check.
 * @returns True when the value is a non-null object.
 * @example
 * isRecord({ rules: {} }); // => true
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Finds the first configured sign-off pattern that appears in a
 * `Signed-off-by:` line of a commit message.
 * @param rawCommitMessage - The full raw commit message.
 * @param signOffPatterns - The patterns whose match bypasses the rule set.
 * @returns The matched pattern, or undefined when no sign-off matches.
 * @example
 * findIgnoredSignOff('feat: x\n\nSigned-off-by: dependabot[bot] <a@b.c>', [
 *   'dependabot[bot]',
 * ]); // => 'dependabot[bot]'
 */
const findIgnoredSignOff = (
  rawCommitMessage: string,
  signOffPatterns: string[],
): string | undefined => {
  const extractedSignOffs = Array.from(
    rawCommitMessage.matchAll(/^Signed-off-by:(.*)$/gimu),
    (match) => match[1].trim(),
  );

  return signOffPatterns.find((ignorePattern) =>
    extractedSignOffs.some((actualSignOff) =>
      actualSignOff.includes(ignorePattern),
    ),
  );
};

/**
 * Finds the rules catalog exported by an imported commitlint plugin module.
 * It prefers the `rules` property of the default export, then the default
 * export itself, then the module's named `rules` export.
 * @param targetPluginModule - The dynamically imported plugin module.
 * @returns The rules catalog, or undefined when the module exports none.
 * @example
 * const pluginModule = await import('@commitlint/rules');
 * findRulesCatalog(pluginModule); // => { 'type-enum': [Function], ... }
 */
const findRulesCatalog = (
  targetPluginModule: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const defaultExport = targetPluginModule.default;
  const defaultRules = isRecord(defaultExport)
    ? defaultExport.rules
    : undefined;
  if (isRecord(defaultRules)) {
    return defaultRules;
  }
  if (isRecord(defaultExport)) {
    return defaultExport;
  }
  const moduleRules = targetPluginModule.rules;
  return isRecord(moduleRules) ? moduleRules : undefined;
};

/**
 * Resolves a rule function by importing the package that exports it.
 * @param packageName - The npm package that exports the rule.
 * @param ruleName - The name of the rule within that package's rules catalog.
 * @returns The rule function, or undefined when the package does not export it.
 * @throws {Error} When the package cannot be imported.
 * @example
 * const typeEnum = await resolveRuleFunction('@commitlint/rules', 'type-enum');
 */
const resolveRuleFunction = async (
  packageName: string,
  ruleName: string,
): Promise<Rule<unknown> | undefined> => {
  // eslint-disable-next-line no-unsanitized/method -- the plugin to load is named in the user's commitlint config, so import() needs a runtime specifier; a static import cannot work and createRequire would break ESM-only plugins
  const targetPluginModule: unknown = await import(packageName);
  if (!isRecord(targetPluginModule)) {
    return undefined;
  }

  const rule = findRulesCatalog(targetPluginModule)?.[ruleName];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a commitlint rule is a plain function from a plugin the user named in their config, and its parameters cannot be checked at runtime
  return typeof rule === 'function' ? (rule as Rule<unknown>) : undefined;
};

/**
 * A `commitlint` rule named `ignoreForAuthors`.
 * (JSDoc from previous version describing behavior is still applicable)
 * This rule is asynchronous due to its use of dynamic `import()`.
 * @param parsedCommitData - The parsed commit object.
 * @param when - Rule applicability.
 * @param value - Options for this rule.
 * @returns A `Promise<RuleOutcome>`.
 * @example
 * const outcome = await ignoreForAuthors(parsedCommit, 'always', {
 *   signOffPatternsToIgnore: ['dependabot[bot]'],
 *   rulesToEnforce: [
 *     { packageName: '@commitlint/rules', ruleName: 'type-enum', value: [2, 'always', ['feat', 'fix']] },
 *   ],
 * });
 */
export const ignoreForAuthors: Rule<IgnoreForAuthorsRuleOptions> = async (
  parsedCommitData: Commit,
  when: RuleConfigCondition = 'always',
  value?: IgnoreForAuthorsRuleOptions,
): Promise<RuleOutcome> => {
  if (when === 'never') {
    return [true, ''];
  }

  const options = value ?? {};
  const { signOffPatternsToIgnore, rulesToEnforce } = options;

  // commitlint passes a `raw` property that the `Commit` type does not declare.
  const rawCommitMessage: unknown =
    'raw' in parsedCommitData ? parsedCommitData.raw : undefined;

  // noinspection SuspiciousTypeOfGuard
  if (typeof rawCommitMessage !== 'string') {
    return [
      false,
      `Raw commit message is not available or is invalid.`, // Prefix removed
    ];
  }

  if (signOffPatternsToIgnore && Array.isArray(signOffPatternsToIgnore)) {
    // noinspection SuspiciousTypeOfGuard
    if (
      !signOffPatternsToIgnore.every(
        (pattern): pattern is string => typeof pattern === 'string',
      )
    ) {
      return [
        false,
        `Configuration error: 'signOffPatternsToIgnore' must be an array of strings.`, // Prefix removed
      ];
    }

    const matchedPattern = findIgnoredSignOff(
      rawCommitMessage,
      signOffPatternsToIgnore,
    );
    if (matchedPattern) {
      return [
        true,
        `Commit has a 'Signed-off-by' line matching pattern ('${matchedPattern}'). Ruleset defined in 'rulesToEnforce' bypassed.`, // Prefix removed
      ];
    }
  }

  if (
    !rulesToEnforce ||
    !Array.isArray(rulesToEnforce) ||
    rulesToEnforce.length === 0
  ) {
    return [
      true,
      'No rules configured in "rulesToEnforce" for this author/commit, or author was ignored. Rule passes.', // Prefix removed
    ];
  }

  // eslint-disable-next-line functional/no-loop-statements -- the rules run sequentially and the first failing rule returns early
  for (const ruleConfig of rulesToEnforce) {
    // noinspection SuspiciousTypeOfGuard
    if (
      !isRecord(ruleConfig) ||
      typeof ruleConfig.packageName !== 'string' ||
      typeof ruleConfig.ruleName !== 'string'
    ) {
      return [
        false,
        `Invalid rule configuration in 'rulesToEnforce': 'packageName' and 'ruleName' must be strings.`, // Prefix removed
      ];
    }

    const { packageName, ruleName, value: ruleValue } = ruleConfig;
    const loaded = await resolveRuleFunction(packageName, ruleName)
      .then((resolved) => ({ resolved, errorMessage: null }))
      .catch((error: unknown) => ({
        resolved: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    if (loaded.errorMessage !== null) {
      return [
        false,
        `Error loading plugin package '${packageName}': ${loaded.errorMessage}`, // Prefix removed
      ];
    }
    const ruleFunction = loaded.resolved;

    if (typeof ruleFunction !== 'function') {
      return [
        false,
        `Rule '${ruleName}' not found or not a function in package '${packageName}'.`, // Prefix removed
      ];
    }

    const outcome: RuleOutcome = await Promise.resolve(
      ruleFunction(parsedCommitData, 'always', ruleValue),
    );
    const [isValid, messageFromSubRule] = outcome;

    if (!isValid) {
      return [
        false,
        `[via ${packageName}/${ruleName}] ${messageFromSubRule}`, // Kept a short prefix for sub-rule context
      ];
    }
  }

  return [
    true,
    'All configured "rulesToEnforce" passed for this author.', // Prefix removed
  ];
};
