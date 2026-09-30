// Enforces the module boundary rule from CLAUDE.md (module rules 1 and 2):
//
// - No relative import may reach into another module's directory.
// - A module is imported only as `@scorpion/<name>/public`; any other subpath is internal.
// - The importing package must list the module in its package.json dependencies.
//
// "Module" means a package directory directly below one of the `moduleRoots` (default:
// `modules/`). pnpm's strict node_modules layout and the modules' `exports` maps enforce the same
// rules at resolution time; this rule reports them in the editor and in `pnpm check`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const SCOPE = '@scorpion/';
const PUBLIC_ENTRY = '/public';

/**
 * @typedef {{ dir: string, name: string }} ModuleInfo
 * @typedef {{ name?: string, dependencies?: Record<string, string>, devDependencies?: Record<string, string>,
 *   peerDependencies?: Record<string, string>, optionalDependencies?: Record<string, string> }} PackageJson
 */

/** @param {string} file */
function readPackageJson(file) {
  return /** @type {PackageJson} */ (JSON.parse(readFileSync(file, 'utf8')));
}

/** @param {string[]} roots */
function scanModules(roots) {
  /** @type {ModuleInfo[]} */
  const modules = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const pkgFile = join(root, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(pkgFile)) continue;
      const { name } = readPackageJson(pkgFile);
      if (name) modules.push({ dir: join(root, entry.name), name });
    }
  }
  return modules;
}

/** @param {ModuleInfo[]} modules @param {string} path */
function moduleContaining(modules, path) {
  return modules.find((m) => path === m.dir || path.startsWith(m.dir + sep));
}

/** Nearest package.json at or above `dir`, not above `stop`. @param {string} dir @param {string} stop */
function nearestPackageJson(dir, stop) {
  for (let current = dir; ; current = dirname(current)) {
    const file = join(current, 'package.json');
    if (existsSync(file)) return readPackageJson(file);
    if (
      current === stop ||
      dirname(current) === current ||
      relative(stop, current).startsWith('..')
    ) {
      return undefined;
    }
  }
}

/** @param {PackageJson} pkg @param {string} name */
function declares(pkg, name) {
  return [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ].some((deps) => deps !== undefined && name in deps);
}

/** @type {import('eslint').Rule.RuleModule} */
export const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Allow importing another module only through its public entry, and only if it is a declared dependency',
    },
    schema: [
      {
        type: 'object',
        properties: { moduleRoots: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      relative: "Relative import into module '{{target}}'. Import '{{target}}/public' instead.",
      deep: "'{{specifier}}' reaches into the internals of '{{target}}'. Import '{{target}}/public' instead.",
      undeclared:
        "'{{target}}' is not a dependency of '{{importer}}'. Declare it in package.json before importing it.",
    },
  },

  create(context) {
    const options = /** @type {{ moduleRoots?: string[] } | undefined} */ (context.options[0]);
    const roots = (options?.moduleRoots ?? ['modules']).map((root) => resolve(context.cwd, root));
    const modules = scanModules(roots);
    const filename = resolve(context.filename);
    const own = moduleContaining(modules, filename);
    const ownPackage = nearestPackageJson(dirname(filename), context.cwd);

    /** @param {import('estree').Node} node @param {string} specifier */
    function check(node, specifier) {
      if (specifier.startsWith('.') || isAbsolute(specifier)) {
        const target = moduleContaining(modules, resolve(dirname(filename), specifier));
        if (target && target !== own) {
          context.report({ node, messageId: 'relative', data: { target: target.name } });
        }
        return;
      }

      if (!specifier.startsWith(SCOPE)) return;
      const name = specifier.split('/').slice(0, 2).join('/');
      const target = modules.find((m) => m.name === name);
      if (!target) return;

      if (specifier.slice(name.length) !== PUBLIC_ENTRY) {
        context.report({ node, messageId: 'deep', data: { specifier, target: name } });
      }
      if (target !== own && ownPackage && !declares(ownPackage, name)) {
        context.report({
          node,
          messageId: 'undeclared',
          data: { target: name, importer: ownPackage.name ?? 'this package' },
        });
      }
    }

    /** @param {import('estree').ImportDeclaration | import('estree').ExportAllDeclaration | import('estree').ExportNamedDeclaration | import('estree').ImportExpression} node */
    function fromSource(node) {
      const source = node.source;
      if (source?.type === 'Literal' && typeof source.value === 'string') {
        check(source, source.value);
      }
    }

    return {
      ImportDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ImportExpression: fromSource,
    };
  },
};
