import { describe, expect, it } from 'vitest';
import { renderProfileModule } from './codegen.ts';

describe('renderProfileModule', () => {
  it('writes static imports of each manifest and package.json', () => {
    const source = renderProfileModule({
      profileName: 'kpi-tracker',
      moduleIds: ['kpi.framework', 'core.ui-shell'],
      packageNames: ['@scorpion/kpi-framework', '@scorpion/core-ui-shell'],
    });
    expect(source).toContain("import module0 from '@scorpion/kpi-framework/module';");
    expect(source).toContain(
      "import package0 from '@scorpion/kpi-framework/package.json' with { type: 'json' };",
    );
    expect(source).toContain("import module1 from '@scorpion/core-ui-shell/module';");
    expect(source).toContain('{ manifest: module1, packageJson: package1 },');
    expect(source).toContain('export const profileName = "kpi-tracker";');
    expect(source).toContain(
      'export const moduleIds = ["kpi.framework","core.ui-shell"] as const;',
    );
  });

  it('writes a valid file for a profile without modules', () => {
    const source = renderProfileModule({ profileName: 'full', moduleIds: [], packageNames: [] });
    expect(source).not.toContain('import ');
    expect(source).toContain('export const sources: never[] = [];');
  });
});
