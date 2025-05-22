import { jest } from '@jest/globals';
import type { Commit as ParserCommit } from 'conventional-commits-parser';
import type { RuleOutcome, Rule } from '@commitlint/types';
import { ignoreForAuthors } from '../../src/rules/ignore-for-authors.js';
import type {
  IgnoreForAuthorsRuleOptions,
  ExternalRuleToEnforce,
} from '../../src/rules/ignore-for-authors.js';
import '@commitlint/config-conventional';
import '@commitlint/rules';

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
    body: bodyInput,
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

describe('ignoreForAuthors Rule - Basic Functionality & ignoreAuthorPatterns (now signOffPatternsToIgnore)', () => {
  const ignoredSignOffPatternsBase: string[] = [
    // These are now patterns to look for in Signed-off-by lines
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
      signOffPatternsToIgnore: ignoredSignOffPatternsBase, // Corrected
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
      signOffPatternsToIgnore: [], // Corrected
      rulesToEnforce: [],
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'always',
      options,
    );
    expect(valid).toBe(true);
    expect(message).toContain(
      'No rules configured in "rulesToEnforce" for this author/commit, or author was ignored. Rule passes.',
    );
  });

  test('should pass and state no rules configured if options for rulesToEnforce is undefined and author not ignored', async () => {
    const commit = createCommit('feat: Commit with undefined options');
    const options: IgnoreForAuthorsRuleOptions = {
      signOffPatternsToIgnore: [], // Corrected
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'always',
      options,
    );
    expect(valid).toBe(true);
    expect(message).toContain(
      'No rules configured in "rulesToEnforce" for this author/commit, or author was ignored. Rule passes.',
    );
  });

  test('should fail if parsed.raw is not a string (e.g., forced null)', async () => {
    const commitWithInvalidRaw = {
      raw: null,
    } as unknown as ExpectedCommitType;
    const options: IgnoreForAuthorsRuleOptions = {
      signOffPatternsToIgnore: ignoredSignOffPatternsBase, // Corrected
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commitWithInvalidRaw,
      'always',
      options,
    );
    expect(valid).toBe(false);
    expect(message).toContain(
      'Raw commit message is not available or is invalid.',
    );
  });

  test('should fail if signOffPatternsToIgnore contains non-strings', async () => {
    const commit = createCommit('feat: test commit');
    const mixedPatterns: (string | number | null)[] = ['valid', 123, null];
    const options: IgnoreForAuthorsRuleOptions = {
      signOffPatternsToIgnore: mixedPatterns as unknown as string[], // Corrected
    };
    const [valid, message]: RuleOutcome = await ignoreForAuthors(
      commit,
      'always',
      options,
    );
    expect(valid).toBe(false);
    expect(message).toContain(
      "Configuration error: 'signOffPatternsToIgnore' must be an array of strings.",
    );
  });

  test('should pass and state an ignored signOff pattern was found, bypassing rulesToEnforce', async () => {
    const botSignOff = 'dependabot[bot]';
    const commitMessage = `fix(deps): update by bot\n\nSigned-off-by: ${botSignOff} <dev@example.com>`;
    const commit = createCommit(commitMessage, 'some body');
    const options: IgnoreForAuthorsRuleOptions = {
      signOffPatternsToIgnore: [botSignOff], // Corrected
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
      `Commit has a 'Signed-off-by' line matching pattern ('${botSignOff}')`,
    );
    expect(message).toContain("Ruleset defined in 'rulesToEnforce' bypassed.");
    expect(mockCommitlintRulesCatalogue['type-enum']).not.toHaveBeenCalled();
  });
});

describe('ignoreForAuthors Rule - rulesToEnforce Functionality', () => {
  const nonBotCommitRaw =
    'feat(app): new feature by human\n\nSigned-off-by: Human <human@example.com>';
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
      signOffPatternsToIgnore: ['non-matching-bot-pattern'], // Corrected
      rulesToEnforce: [standardTypeEnumConfig, standardHeaderLengthConfig],
    };
    const [valid, message] = await ignoreForAuthors(commit, 'always', options);

    expect(valid).toBe(true);
    expect(message).toContain(
      'All configured "rulesToEnforce" passed for this author.',
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

  // ... (other tests in this describe block should also use signOffPatternsToIgnore if they define options) ...
  // For brevity, I'll show one more example from this block:

  test('should ENFORCE and FAIL body-max-line-length for normal user with long body', async () => {
    const conventionalBodyMaxLength = 100;
    const botSignOffPattern = 'dependabot[bot]';
    const bodyMaxLineLengthRuleConfig: ExternalRuleToEnforce = {
      packageName: '@commitlint/rules',
      ruleName: 'body-max-line-length',
      value: conventionalBodyMaxLength,
    };

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

    const longBody =
      'This is a very long body line from a normal user, designed to be well over the one hundred character limit enforced by the rule.';
    const normalUserLongBodyCommit = createCommit(
      `feat: new amazing feature\n\n${longBody}\n\nSigned-off-by: User <user@example.com>`, // Ensure a non-matching sign-off
      longBody,
    );

    const options: IgnoreForAuthorsRuleOptions = {
      signOffPatternsToIgnore: [botSignOffPattern], // Corrected: Use signOffPatternsToIgnore
      rulesToEnforce: [bodyMaxLineLengthRuleConfig],
    };

    const [valid, message] = await ignoreForAuthors(
      normalUserLongBodyCommit,
      'always',
      options,
    );

    expect(valid).toBe(false);
    expect(message).toContain(
      `[via @commitlint/rules/body-max-line-length] Mocked body-max-line-length: A line exceeds ${conventionalBodyMaxLength} characters.`,
    );
    expect(
      mockCommitlintRulesCatalogue['body-max-line-length'],
    ).toHaveBeenCalledWith(
      normalUserLongBodyCommit,
      'always',
      conventionalBodyMaxLength,
    );
  });

  // ... (ensure all other constructions of IgnoreForAuthorsRuleOptions in this file
  //      use 'signOffPatternsToIgnore' instead of 'ignoreAuthorPatterns')
});
