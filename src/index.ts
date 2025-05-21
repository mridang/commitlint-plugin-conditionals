import type { Rule, Plugin as CommitlintPluginType } from '@commitlint/types';
import { ignoreForAuthors } from './rules/ignore-for-authors.js';
import type { IgnoreForAuthorsRuleOptions } from './rules/ignore-for-authors.js';

/**
 * Defines the structure of the commitlint plugin being exported.
 * It primarily contains a `rules` object that maps rule names to their
 * respective rule implementation functions.
 * This structure aligns with the `Plugin` type from `@commitlint/types`.
 */
interface PluginDefinition extends CommitlintPluginType {
  /**
   * An object where keys are rule names (strings) and values are the
   * corresponding rule functions. Each rule function must adhere to the
   * `Rule` type defined in `@commitlint/types`.
   */
  rules: {
    [name: string]: Rule;
  };
}

/**
 * The main plugin object for `@mridang/commitlint-conditionals`.
 * This object is what `commitlint` will load and use. It exports the rules
 * provided by this plugin.
 *
 * Initially, it offers a single rule:
 * - `ignore-for-authors`: Identifies commits by specified author patterns.
 * As implemented, this rule itself always passes but provides informative
 * messages. Achieving a true "ignore all other linting" effect for these
 * authors requires dynamic configuration in the user's
 * `commitlint.config.js` or `commitlint.config.ts`.
 */
const plugin: PluginDefinition = {
  rules: {
    'ignore-for-authors': ignoreForAuthors as Rule<IgnoreForAuthorsRuleOptions>,
  },
};

// noinspection JSUnusedGlobalSymbols
export default plugin;

/**
 * Re-exporting type definitions for the plugin's rule options.
 * This allows users of the plugin to import these types if they are
 * creating a typed `commitlint.config.ts`. This ensures that their rule
 * configurations are type-checked against the options expected by this
 * plugin's rules, enhancing configuration safety and developer experience.
 */
export type { IgnoreForAuthorsRuleOptions };
