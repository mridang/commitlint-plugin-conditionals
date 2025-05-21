import type { Rule, RuleConfigCondition, RuleOutcome } from '@commitlint/types';
import type { Commit as ParserCommit } from 'conventional-commits-parser';

/**
 * Defines the minimal expected structure of a dynamically imported
 * commitlint plugin module for rule access. This helps in typing the module
 * after dynamic import and guides how we try to access its rules.
 */
interface LoadedCommitlintPluginModule {
  /**
   * The default export of the plugin module. This could be an object
   * containing a 'rules' property, or it could be the rules map itself.
   */
  default?:
    | { rules?: Record<string, Rule<unknown> | undefined> }
    | Record<string, Rule<unknown> | undefined>;
  /**
   * A named 'rules' export from the plugin module.
   */
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
  ignoreAuthorPatterns?: string[];
  /**
   * An array of external rule configurations to apply if the commit is
   * not from an ignored author (as per `ignoreAuthorPatterns`). If this
   * array is empty or not provided, and the author is not ignored, this
   * main rule will pass (as there are no specific rules to enforce).
   */
  rulesToEnforce?: ExternalRuleToEnforce[];
}

/**
 * The commit object type that `commitlint` rules actually receive at runtime.
 * It extends the `Commit` type from `conventional-commits-parser`
 * and ensures the `raw` property (the full commit message string)
 * is present.
 */
// @ts-expect-error becuase dodod
interface LintCommit extends ParserCommit {
  raw: string;
}

/**
 * A `commitlint` rule named `ignoreForAuthors`.
 *
 * **Behavior:**
 * 1. If `ignoreAuthorPatterns` are provided and a pattern matches the raw
 * commit message, this rule passes, and `rulesToEnforce` are bypassed.
 * 2. If no `ignoreAuthorPatterns` match (or none are provided), this rule
 * will then attempt to enforce each rule listed in `rulesToEnforce`.
 * - Each rule in `rulesToEnforce` is dynamically imported from its
 * specified `packageName`.
 * - If any enforced rule fails, this `ignoreForAuthors` rule fails with
 * the message from the underlying rule.
 * - If all enforced rules pass (or if `rulesToEnforce` is empty/undefined),
 * this rule passes.
 *
 * This rule is asynchronous due to its use of dynamic `import()`.
 *
 * @param parsedCommitData - The parsed commit object, typed as `Commit` from
 * `conventional-commits-parser`. It's expected that `commitlint` provides
 * this object augmented with a `raw: string` property at runtime.
 * @param when - Rule applicability, typically 'always' or 'never'.
 * @param value - Options for this rule, conforming to
 * `IgnoreForAuthorsRuleOptions`.
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
  const { ignoreAuthorPatterns, rulesToEnforce } = options;

  const rawCommitMessage = parsed.raw;

  if (typeof rawCommitMessage !== 'string') {
    return [
      false,
      `[@mridang/commitlint-plugin-conditionals ignoreForAuthors] Raw commit message is not available or is invalid.`,
    ];
  }

  if (ignoreAuthorPatterns && Array.isArray(ignoreAuthorPatterns)) {
    if (
      !ignoreAuthorPatterns.every(
        (pattern): pattern is string => typeof pattern === 'string',
      )
    ) {
      return [
        false,
        `[@mridang/commitlint-plugin-conditionals ignoreForAuthors] Configuration error: 'ignoreAuthorPatterns' must be an array of strings.`,
      ];
    }
    const matchedIgnoredPattern: string | undefined = ignoreAuthorPatterns.find(
      (pattern: string): boolean => rawCommitMessage.includes(pattern),
    );

    if (matchedIgnoredPattern) {
      return [
        true,
        `[@mridang/commitlint-plugin-conditionals ignoreForAuthors] Commit by ignored author pattern ('${matchedIgnoredPattern}'). Ruleset defined in 'rulesToEnforce' bypassed.`,
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
      '[@mridang/commitlint-plugin-conditionals ignoreForAuthors] No rules configured in "rulesToEnforce" for this author, or author was ignored. Rule passes.',
    ];
  }

  for (const ruleConfig of rulesToEnforce) {
    if (
      !ruleConfig ||
      typeof ruleConfig.packageName !== 'string' ||
      typeof ruleConfig.ruleName !== 'string'
    ) {
      return [
        false,
        `[@mridang/commitlint-plugin-conditionals ignoreForAuthors] Invalid rule configuration in 'rulesToEnforce': 'packageName' and 'ruleName' must be strings.`,
      ];
    }

    const { packageName, ruleName, value: ruleValue } = ruleConfig;
    let ruleFunction: Rule<unknown> | undefined;

    try {
      // eslint-disable-next-line
      const targetPluginModule = (await import(
        packageName
      )) as LoadedCommitlintPluginModule;

      let rulesCatalog: Record<string, Rule<unknown> | undefined> | undefined;

      /**
       * Attempt to find the rules object in the imported module.
       * Priority:
       * 1. module.default.rules (common for plugins wrapping rules)
       * 2. module.default (if default export IS the rules map, e.g., @commitlint/rules)
       * 3. module.rules (named 'rules' export)
       */
      if (targetPluginModule.default) {
        if (
          typeof targetPluginModule.default.rules === 'object' &&
          targetPluginModule.default.rules !== null
        ) {
          rulesCatalog = targetPluginModule.default.rules;
        } else if (
          typeof targetPluginModule.default === 'object' &&
          targetPluginModule.default !== null
        ) {
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
        `[@mridang/commitlint-plugin-conditionals ignoreForAuthors] Error loading plugin package '${packageName}': ${errorMessage}`,
      ];
    }

    if (typeof ruleFunction !== 'function') {
      return [
        false,
        `[@mridang/commitlint-plugin-conditionals ignoreForAuthors] Rule '${ruleName}' not found or not a function in package '${packageName}'.`,
      ];
    }

    const outcome: RuleOutcome = await Promise.resolve(
      ruleFunction(parsed, 'always', ruleValue),
    );
    const [isValid, message] = outcome;

    if (!isValid) {
      return [
        false,
        `[@mridang/commitlint-plugin-conditionals via ${packageName}/${ruleName}] ${message}`,
      ];
    }
  }

  return [
    true,
    '[@mridang/commitlint-plugin-conditionals ignoreForAuthors] All configured "rulesToEnforce" passed for this author.',
  ];
};
