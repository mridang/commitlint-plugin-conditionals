import { jest } from '@jest/globals';
import type { Commit as ParserCommit } from 'conventional-commits-parser';
import type { RuleOutcome, Rule } from '@commitlint/types';
import { ignoreForAuthors } from '../../src/rules/ignore-for-authors.js';
import type {
  IgnoreForAuthorsRuleOptions,
  ExternalRuleToEnforce,
} from '../../src/rules/ignore-for-authors.js';
import '@commitlint/rules';
import '@commitlint/config-conventional';

/**
 * The type for the commit object expected by the ignoreForAuthors rule.
 */
type ExpectedCommitType = ParserCommit & { raw: string };

/**
 * Helper function to create a mock Commit object for testing.
 * @param rawInput - The raw commit message string.
 * @param bodyInput - Optional body for the commit.
 * @returns A mock object cast to ExpectedCommitType.
 */
const createCommit = (
  rawInput: string,
  bodyInput: string | null = null,
): ExpectedCommitType => {
  const headerString =
    typeof rawInput === 'string' ? rawInput.split('\n')[0] : null;
  const mock = {
    raw: rawInput,
    header: headerString,
    body: bodyInput, // Set body from parameter
    footer: null,
    type: null,
    scope: null,
    subject: null,
    mentions: [],
    notes: [],
    references: [],
    revert: null,
    merge: null,
    action: null,
    owner: null,
    name: null,
  };
  return mock as unknown as ExpectedCommitType;
};

/**
 * Mocks for rule functions from @commitlint/rules.
 */
const mockCommitlintRulesCatalogue: Record<string, jest.Mock<Rule<unknown>>> = {
  'type-enum': jest.fn<Rule<unknown>>(),
  'header-max-length': jest.fn<Rule<unknown>>(),
  'body-max-line-length': jest.fn<Rule<unknown>>(),
  'rule-to-malform': jest.fn<Rule<unknown>>(),
};

/**
 * Mocking the dynamic import for '@commitlint/rules'.
 */
jest.unstable_mockModule('@commitlint/rules', () => ({
  __esModule: true,
  default: {
    rules: mockCommitlintRulesCatalogue,
  },
}));

describe('ignoreForAuthors Rule - Basic Functionality & ignoreAuthorPatterns', () => {
  const ignoredPatternsBase: string[] = [
    'dependabot[bot]',
    'github-actions[bot]',
    'renovate-bot',
  ];

  beforeEach(() => {
    for (const key in mockCommitlintRulesCatalogue) {
      if (
        Object.prototype.hasOwnProperty.call(mockCommitlintRulesCatalogue, key)
      ) {
        mockCommitlintRulesCatalogue[key] = jest
          .fn<Rule<unknown>>()
          .mockReturnValue([true, '']);
      }
    }
  });

  test('should pass and return an empty message if "when" is "never"', async () => {
    const commit = createCommit('feat: A normal commit by a human');
    const options: IgnoreForAuthorsRuleOptions = {
      ignoreAuthorPatterns: ignoredPatternsBase,
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'never',
      options,
    );
    expect(valid).toBe(true);
    expect(message).toBe('');
  });

  test('should pass and state no rules configured if rulesToEnforce is empty and author not ignored', async () => {
    const commit = createCommit('feat: Another commit');
    const options: IgnoreForAuthorsRuleOptions = {
      ignoreAuthorPatterns: [],
      rulesToEnforce: [],
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'always',
      options,
    );
    expect(valid).toBe(true);
    expect(message).toContain(
      'ignoreForAuthors] No rules configured in "rulesToEnforce" for this author, or author was ignored. Rule passes.',
    );
  });

  test('should pass and state no rules configured if options for rulesToEnforce is undefined and author not ignored', async () => {
    const commit = createCommit('feat: Commit with undefined options');
    const options: IgnoreForAuthorsRuleOptions = {
      ignoreAuthorPatterns: [],
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'always',
      options,
    );
    expect(valid).toBe(true);
    expect(message).toContain(
      'ignoreForAuthors] No rules configured in "rulesToEnforce" for this author, or author was ignored. Rule passes.',
    );
  });

  test('should fail if parsed.raw is not a string (e.g., forced null)', async () => {
    const commitWithInvalidRaw = {
      raw: null, // Intentionally malformed for test
    } as unknown as ExpectedCommitType;
    const options: IgnoreForAuthorsRuleOptions = {
      ignoreAuthorPatterns: ignoredPatternsBase,
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commitWithInvalidRaw,
      'always',
      options,
    );
    expect(valid).toBe(false);
    expect(message).toContain(
      'ignoreForAuthors] Raw commit message is not available or is invalid.',
    );
  });

  test('should fail if ignoreAuthorPatterns contains non-strings', async () => {
    const commit = createCommit('feat: test commit');
    const mixedPatterns: (string | number | null)[] = ['valid', 123, null];
    const options: IgnoreForAuthorsRuleOptions = {
      ignoreAuthorPatterns: mixedPatterns as unknown as string[],
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'always',
      options,
    );
    expect(valid).toBe(false);
    expect(message).toContain(
      "ignoreForAuthors] Configuration error: 'ignoreAuthorPatterns' must be an array of strings.",
    );
  });

  test('should pass and state an ignored pattern was found, bypassing rulesToEnforce', async () => {
    const commitMessage = 'fix(deps): update by dependabot[bot]';
    const commit = createCommit(commitMessage);
    const options: IgnoreForAuthorsRuleOptions = {
      ignoreAuthorPatterns: ignoredPatternsBase,
      rulesToEnforce: [
        {
          packageName: '@commitlint/rules',
          ruleName: 'type-enum',
          value: ['feat'],
        },
      ],
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'always',
      options,
    );
    expect(valid).toBe(true);
    expect(message).toContain(
      "ignoreForAuthors] Commit by ignored author pattern ('dependabot[bot]')",
    );
    expect(message).toContain("Ruleset defined in 'rulesToEnforce' bypassed.");
    expect(mockCommitlintRulesCatalogue['type-enum']).not.toHaveBeenCalled();
  });
});

describe('ignoreForAuthors Rule - rulesToEnforce Functionality', () => {
  const nonBotCommitRaw = 'feat(app): new feature by human';
  const standardTypeEnumConfig: ExternalRuleToEnforce = {
    packageName: '@commitlint/rules',
    ruleName: 'type-enum',
    value: ['feat', 'fix', 'chore'],
  };
  const standardHeaderLengthConfig: ExternalRuleToEnforce = {
    packageName: '@commitlint/rules',
    ruleName: 'header-max-length',
    value: 50,
  };

  beforeEach(() => {
    for (const key in mockCommitlintRulesCatalogue) {
      if (
        Object.prototype.hasOwnProperty.call(mockCommitlintRulesCatalogue, key)
      ) {
        mockCommitlintRulesCatalogue[key] = jest
          .fn<Rule<unknown>>()
          .mockReturnValue([true, '']);
      }
    }
  });

  test('should pass if author not ignored and all enforced rules pass', async () => {
    const commit = createCommit(nonBotCommitRaw);
    const options: IgnoreForAuthorsRuleOptions = {
      ignoreAuthorPatterns: ['non-matching-bot'],
      rulesToEnforce: [standardTypeEnumConfig, standardHeaderLengthConfig],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);

    expect(valid).toBe(true);
    expect(message).toContain(
      '[@mridang/commitlint-plugin-conditionals ignoreForAuthors] All configured "rulesToEnforce" passed for this author.',
    );
    expect(mockCommitlintRulesCatalogue['type-enum']).toHaveBeenCalledWith(
      commit,
      'always',
      standardTypeEnumConfig.value,
    );
    expect(
      mockCommitlintRulesCatalogue['header-max-length'],
    ).toHaveBeenCalledWith(commit, 'always', standardHeaderLengthConfig.value);
  });

  test('should fail if author not ignored and an enforced rule fails', async () => {
    const commit = createCommit(nonBotCommitRaw);
    mockCommitlintRulesCatalogue['header-max-length'].mockReturnValue([
      false,
      'header too long',
    ]);
    const options: IgnoreForAuthorsRuleOptions = {
      rulesToEnforce: [standardTypeEnumConfig, standardHeaderLengthConfig],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);
    expect(valid).toBe(false);
    expect(message).toContain(
      '[@mridang/commitlint-plugin-conditionals via @commitlint/rules/header-max-length] header too long',
    );
  });

  test('should fail on first failing rule and not process subsequent rules', async () => {
    const commit = createCommit(nonBotCommitRaw);
    mockCommitlintRulesCatalogue['type-enum'].mockReturnValue([
      false,
      'type invalid',
    ]);
    const options: IgnoreForAuthorsRuleOptions = {
      rulesToEnforce: [standardTypeEnumConfig, standardHeaderLengthConfig],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);
    expect(valid).toBe(false);
    expect(message).toContain(
      '[@mridang/commitlint-plugin-conditionals via @commitlint/rules/type-enum] type invalid',
    );
    expect(
      mockCommitlintRulesCatalogue['header-max-length'],
    ).not.toHaveBeenCalled();
  });

  test('should fail if rulesToEnforce has invalid config (missing packageName)', async () => {
    const commit = createCommit(nonBotCommitRaw);
    const invalidRuleEntry = {
      ruleName: 'type-enum',
      value: [],
    };
    const options: IgnoreForAuthorsRuleOptions = {
      rulesToEnforce: [invalidRuleEntry as unknown as ExternalRuleToEnforce],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);
    expect(valid).toBe(false);
    expect(message).toContain(
      "Invalid rule configuration in 'rulesToEnforce': 'packageName' and 'ruleName' must be strings.",
    );
  });

  test('should fail if specified packageName cannot be loaded', async () => {
    const commit = createCommit(nonBotCommitRaw);
    const options: IgnoreForAuthorsRuleOptions = {
      rulesToEnforce: [
        {
          packageName: 'truly-non-existent-package-for-import-failure',
          ruleName: 'any-rule',
          value: null,
        },
      ],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);
    expect(valid).toBe(false);
    expect(message).toContain(
      "Error loading plugin package 'truly-non-existent-package-for-import-failure'",
    );
  });

  test('should fail if ruleName is not found in mocked @commitlint/rules', async () => {
    const commit = createCommit(nonBotCommitRaw);
    const optionsMissingRule: IgnoreForAuthorsRuleOptions = {
      rulesToEnforce: [
        {
          packageName: '@commitlint/rules',
          ruleName: 'this-rule-is-not-in-our-mock-catalogue',
          value: null,
        },
      ],
    };
    const [valid, message] = await ignoreForAuthors(
      commit,
      'always',
      optionsMissingRule,
    );
    expect(valid).toBe(false);
    expect(message).toContain(
      "Rule 'this-rule-is-not-in-our-mock-catalogue' not found or not a function in package '@commitlint/rules'",
    );
  });

  test('should fail if loaded rule from @commitlint/rules is not a function', async () => {
    const commit = createCommit(nonBotCommitRaw);
    (mockCommitlintRulesCatalogue as Record<string, unknown>)[
      'rule-to-malform'
    ] = 'not-a-function-string';

    const options: IgnoreForAuthorsRuleOptions = {
      rulesToEnforce: [
        {
          packageName: '@commitlint/rules',
          ruleName: 'rule-to-malform',
          value: null,
        },
      ],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);
    expect(valid).toBe(false);
    expect(message).toContain(
      "Rule 'rule-to-malform' not found or not a function in package '@commitlint/rules'",
    );
  });

  test('should pass if rulesToEnforce is present but empty array and author not ignored', async () => {
    const commit = createCommit(nonBotCommitRaw);
    const options: IgnoreForAuthorsRuleOptions = {
      rulesToEnforce: [],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);
    expect(valid).toBe(true);
    expect(message).toContain(
      'No rules configured in "rulesToEnforce" for this author, or author was ignored. Rule passes.',
    );
  });

  /**
   * Granular tests for body-max-line-length scenarios.
   */
  describe('with body-max-line-length configured in rulesToEnforce (like config-conventional)', () => {
    const conventionalBodyMaxLength = 100;
    const botAuthorPattern = 'dependabot[bot]';
    const bodyMaxLineLengthRuleConfig: ExternalRuleToEnforce = {
      packageName: '@commitlint/rules',
      ruleName: 'body-max-line-length',
      value: conventionalBodyMaxLength,
    };

    beforeEach(() => {
      /**
       * Set up the specific mock implementation for body-max-line-length.
       * This is re-applied before each test in this describe block,
       * overriding the generic pass from the outer beforeEach if needed.
       */
      mockCommitlintRulesCatalogue['body-max-line-length'].mockImplementation(
        (parsedComm, _when, maxLength?: unknown) => {
          const parsed = parsedComm as ExpectedCommitType;
          if (
            !parsed ||
            typeof parsed.body !== 'string' ||
            typeof maxLength !== 'number' ||
            maxLength <= 0
          ) {
            return [
              true,
              'Mocked body-max-line-length: no body or invalid max length.',
            ];
          }
          const lines = parsed.body.split('\n');
          if (lines.some((line) => line.length > maxLength)) {
            return [
              false,
              `Mocked body-max-line-length: A line exceeds ${maxLength} characters.`,
            ];
          }
          return [true, 'Mocked body-max-line-length: OK.'];
        },
      );
    });

    test('should BYPASS body-max-line-length for dependabot with long body', async () => {
      const longBody =
        'This line is very long, over one hundred characters, specifically for testing dependabot bypass for body-max-line-length.';
      const dependabotCommit = createCommit(
        `fix(deps): ${botAuthorPattern} updates many things\n\n${longBody}`,
        longBody, // Pass body to createCommit
      );

      const options: IgnoreForAuthorsRuleOptions = {
        ignoreAuthorPatterns: [botAuthorPattern],
        rulesToEnforce: [bodyMaxLineLengthRuleConfig],
      };

      const [valid, message] = await ignoreForAuthors(
        dependabotCommit,
        'always',
        options,
      );

      expect(valid).toBe(true);
      expect(message).toContain(
        `Commit by ignored author pattern ('${botAuthorPattern}')`,
      );
      expect(message).toContain(
        "Ruleset defined in 'rulesToEnforce' bypassed.",
      );
      expect(
        mockCommitlintRulesCatalogue['body-max-line-length'],
      ).not.toHaveBeenCalled();
    });

    test('should ENFORCE and FAIL body-max-line-length for normal user with long body', async () => {
      const longBody =
        'This is a very long body line from a normal user, designed to be well over the one hundred character limit enforced by the rule.';
      const normalUserLongBodyCommit = createCommit(
        `feat: new amazing feature\n\n${longBody}`,
        longBody, // Pass body to createCommit
      );

      const options: IgnoreForAuthorsRuleOptions = {
        ignoreAuthorPatterns: [botAuthorPattern], // dependabot is ignored, not this user
        rulesToEnforce: [bodyMaxLineLengthRuleConfig],
      };

      const [valid, message] = await ignoreForAuthors(
        normalUserLongBodyCommit,
        'always',
        options,
      );

      expect(valid).toBe(false);
      expect(message).toContain(
        `[@mridang/commitlint-plugin-conditionals via @commitlint/rules/body-max-line-length] Mocked body-max-line-length: A line exceeds ${conventionalBodyMaxLength} characters.`,
      );
      expect(
        mockCommitlintRulesCatalogue['body-max-line-length'],
      ).toHaveBeenCalledWith(
        normalUserLongBodyCommit,
        'always',
        conventionalBodyMaxLength,
      );
    });

    test('should ENFORCE and PASS body-max-line-length for normal user with short body', async () => {
      const shortBody =
        'This body is perfectly fine and respects the length limits.';
      const normalUserShortBodyCommit = createCommit(
        `docs: update documentation\n\n${shortBody}`,
        shortBody, // Pass body to createCommit
      );

      const options: IgnoreForAuthorsRuleOptions = {
        ignoreAuthorPatterns: [botAuthorPattern],
        rulesToEnforce: [bodyMaxLineLengthRuleConfig],
      };

      const [valid, message] = await ignoreForAuthors(
        normalUserShortBodyCommit,
        'always',
        options,
      );

      expect(valid).toBe(true);
      expect(message).toContain(
        'All configured "rulesToEnforce" passed for this author.',
      );
      expect(
        mockCommitlintRulesCatalogue['body-max-line-length'],
      ).toHaveBeenCalledWith(
        normalUserShortBodyCommit,
        'always',
        conventionalBodyMaxLength,
      );
    });
  });
});
