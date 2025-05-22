import type { Rule, RuleConfigCondition, RuleOutcome } from '@commitlint/types';
import type { Commit as ParserCommit } from 'conventional-commits-parser';

/**
 * Defines the minimal expected structure of a dynamically imported
 * commitlint plugin module for rule access.
 */
interface LoadedCommitlintPluginModule {
  default?:
    | { rules?: Record<string, Rule<unknown> | undefined> }
    | Record<string, Rule<unknown> | undefined>;
  rules?: Record<string, Rule<unknown> | undefined>;
}

/**
 * Configuration for a single external rule to be enforced if the commit
 * is not from an ignored author.
 */
export interface ExternalRuleToEnforce {
  /**
   * The name of the NPM package that exports the rule.
   * Examples: '@commitlint/rules', 'commitlint-plugin-jira'
   */
  packageName: string;
  /**
   * The name of the rule as exported by the `rules` object of the plugin
   * specified in `packageName`.
   * Example: 'type-enum', 'header-max-length', 'jira-task-id-empty'
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
 * The commit object type that `commitlint` rules actually receive at runtime.
 * It extends the `Commit` type from `conventional-commits-parser`
 * and ensures the `raw` property (the full commit message string)
 * is present.
 */
// @ts-expect-error: raw is not present in the Commit type.
interface LintCommit extends ParserCommit {
  raw: string;
}

/**
 * A `commitlint` rule named `ignoreForAuthors`.
 * (JSDoc from previous version describing behavior is still applicable)
 * This rule is asynchronous due to its use of dynamic `import()`.
 *
 * @param parsedCommitData - The parsed commit object.
 * @param when - Rule applicability.
 * @param value - Options for this rule.
 * @returns A `Promise<RuleOutcome>`.
 */
export const ignoreForAuthors: Rule<IgnoreForAuthorsRuleOptions> = async (
  parsedCommitData: ParserCommit,
  when: RuleConfigCondition = 'always',
  value?: IgnoreForAuthorsRuleOptions,
): Promise<RuleOutcome> => {
  if (when === 'never') {
    return [true, ''];
  }

  const parsed = parsedCommitData as LintCommit;
  const options = value || {};
  const { signOffPatternsToIgnore, rulesToEnforce } = options;

  const rawCommitMessage = parsed.raw;

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

    if (signOffPatternsToIgnore.length > 0) {
      const signOffRegex = /^Signed-off-by:\s*(.*)$/gim;
      let match;
      const extractedSignOffs: string[] = [];
      while ((match = signOffRegex.exec(rawCommitMessage)) !== null) {
        extractedSignOffs.push(match[1].trim());
      }

      if (extractedSignOffs.length > 0) {
        const matchedPattern = signOffPatternsToIgnore.find((ignorePattern) =>
          extractedSignOffs.some((actualSignOff) =>
            actualSignOff.includes(ignorePattern),
          ),
        );

        if (matchedPattern) {
          return [
            true,
            `Commit has a 'Signed-off-by' line matching pattern ('${matchedPattern}'). Ruleset defined in 'rulesToEnforce' bypassed.`, // Prefix removed
          ];
        }
      }
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

  for (const ruleConfig of rulesToEnforce) {
    // noinspection SuspiciousTypeOfGuard
    if (
      !ruleConfig ||
      typeof ruleConfig.packageName !== 'string' ||
      typeof ruleConfig.ruleName !== 'string'
    ) {
      return [
        false,
        `Invalid rule configuration in 'rulesToEnforce': 'packageName' and 'ruleName' must be strings.`, // Prefix removed
      ];
    }

    const { packageName, ruleName, value: ruleValue } = ruleConfig;
    let ruleFunction: Rule<unknown> | undefined;

    try {
      // eslint-disable-next-line no-unsanitized/method
      const targetPluginModule = (await import(
        packageName
      )) as LoadedCommitlintPluginModule;

      let rulesCatalog: Record<string, Rule<unknown> | undefined> | undefined;

      if (targetPluginModule.default) {
        if (
          typeof targetPluginModule.default.rules === 'object' &&
          targetPluginModule.default.rules !== null
        ) {
          rulesCatalog = targetPluginModule.default.rules;
        } else if (typeof targetPluginModule.default === 'object') {
          rulesCatalog = targetPluginModule.default as Record<
            string,
            Rule<unknown>
          >;
        }
      }

      if (
        !rulesCatalog &&
        typeof targetPluginModule.rules === 'object' &&
        targetPluginModule.rules !== null
      ) {
        rulesCatalog = targetPluginModule.rules;
      }

      if (rulesCatalog) {
        ruleFunction = rulesCatalog[ruleName];
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return [
        false,
        `Error loading plugin package '${packageName}': ${errorMessage}`, // Prefix removed
      ];
    }

    if (typeof ruleFunction !== 'function') {
      return [
        false,
        `Rule '${ruleName}' not found or not a function in package '${packageName}'.`, // Prefix removed
      ];
    }

    const outcome: RuleOutcome = await Promise.resolve(
      ruleFunction(parsed, 'always', ruleValue),
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
