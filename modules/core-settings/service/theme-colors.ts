// The rule the theme colours keep that the schema cannot say (M12a sprint 4): every text and background pair passes WCAG AA in
// both themes (`CONTRAST_PAIRS` of `@scorpion/contracts/theme-colors`). The settings service runs it inside the transaction of a
// save, so a set that fails is refused with the pair named and nothing is written.
//
// It is not part of the schema on purpose: a stored value the schema refuses is dropped on read with its whole top-level key
// (`resolveSettings`), and a refinement that measured against the built-in colours could then, after an upgrade that changed them,
// make the instance lose its name, logos and legal texts with its colours.
import type { FieldProblem } from '@scorpion/contracts';
import { contrastFailures, describeFailure, THEME_MODES } from '@scorpion/contracts/theme-colors';
import { isDeepStrictEqual } from 'node:util';
import type { SettingsCheck } from './settings.ts';

const colorsOf = (values: unknown): Record<string, unknown> => {
  const branding = (values as { branding?: { colors?: unknown } } | undefined)?.branding;
  const colors = branding?.colors;
  return typeof colors === 'object' && colors !== null ? (colors as Record<string, unknown>) : {};
};

/**
 * The problems of the theme colours in the settings of core.settings, one per failing pair, on the path of its theme
 * (`values.branding.colors.light`). A save that leaves the colours as they were is not measured again, so a change of the built-in
 * colours in a later version never stops an administrator from saving another setting.
 */
export const themeColorCheck: SettingsCheck = (moduleId, values, before) => {
  if (moduleId !== 'core.settings') return [];
  const colors = colorsOf(values);
  const previous = colorsOf(before);
  return THEME_MODES.flatMap((mode): FieldProblem[] => {
    if (isDeepStrictEqual(colors[mode] ?? {}, previous[mode] ?? {})) return [];
    return contrastFailures(mode, colors[mode]).map((failure) => ({
      in: 'body',
      path: `values.branding.colors.${mode}`,
      message: `In the ${mode} theme, ${describeFailure(failure)} (WCAG AA).`,
    }));
  });
};
