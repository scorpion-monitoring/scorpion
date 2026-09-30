// Build stage of docker/Dockerfile: `node scripts/image-tree.ts <outDir>`.
//
// Copies exactly what the server needs at run time into <outDir>, keeping the repository layout:
// the root node_modules (pnpm's virtual store, which a filtered install filled with only the
// server's closure), and every workspace project in that closure with its own node_modules
// (symlinks are kept as they are, and stay valid because the layout is the same). Nothing else is
// copied, so a module that is not in the profile is not in the image.
//
// The closure follows `dependencies` from apps/server, which `scorpion profile:generate` set to the
// profile's modules; it ignores dev dependencies and optional peer dependencies, which is how
// the loader sees a module's dependencies too (ADR 0002).
//
// Workspace packages stay real directories with symlinks to them rather than being copied into
// node_modules by `pnpm deploy`: Node runs the TypeScript sources by type stripping, which it
// refuses for files inside node_modules.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export interface Project {
  name: string;
  path: string;
  dependencies: string[];
}

/** The projects reachable from `start` through `dependencies`, `start` included. */
export function closureOf(start: string, projects: readonly Project[]): Project[] {
  const byName = new Map(projects.map((project) => [project.name, project]));
  const seen = new Set<string>();
  const order: Project[] = [];
  const visit = (name: string) => {
    const project = byName.get(name);
    if (!project || seen.has(name)) return;
    seen.add(name);
    order.push(project);
    for (const dependency of project.dependencies) visit(dependency);
  };
  visit(start);
  return order;
}

/** What a project keeps in the image: no tests, no fixtures, no test-runner config. */
export function keep(projectDir: string, file: string): boolean {
  const rel = relative(projectDir, file);
  if (rel === '') return true;
  const parts = rel.split(sep);
  if (parts[0] === 'test' || parts[0] === 'e2e') return false;
  const base = parts[parts.length - 1] ?? '';
  return !base.endsWith('.test.ts') && !base.startsWith('vitest.config.');
}

function workspaceProjects(root: string): Project[] {
  const json = execFileSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return (JSON.parse(json) as { name: string; path: string }[]).map(({ name, path }) => {
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return { name, path, dependencies: Object.keys(manifest.dependencies ?? {}) };
  });
}

/** Removes `node_modules/@scorpion/<name>` links to projects that are not in the image. */
function dropForeignLinks(dir: string, allowed: ReadonlySet<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.name === '@scorpion' && dir.endsWith(`${sep}node_modules`)) {
      for (const link of readdirSync(path)) {
        if (!allowed.has(`@scorpion/${link}`))
          rmSync(join(path, link), { recursive: true, force: true });
      }
    } else if (entry.isDirectory() && !lstatSync(path).isSymbolicLink() && entry.name !== '.pnpm') {
      dropForeignLinks(path, allowed);
    } else if (entry.isDirectory() && entry.name === '.pnpm') {
      const hoisted = join(path, 'node_modules');
      if (existsSync(hoisted)) dropForeignLinks(hoisted, allowed);
    }
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  if (!process.argv[2]) {
    console.error('Usage: node scripts/image-tree.ts <outDir>');
    process.exit(2);
  }
  const out = resolve(process.argv[2]);
  mkdirSync(out, { recursive: true });

  const closure = closureOf('@scorpion/server', workspaceProjects(root));
  cpSync(join(root, 'package.json'), join(out, 'package.json'));
  cpSync(join(root, 'node_modules'), join(out, 'node_modules'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  for (const project of closure) {
    cpSync(project.path, join(out, relative(root, project.path)), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => keep(project.path, source),
    });
    console.log(`image: ${project.name} → ${relative(root, project.path)}`);
  }
  dropForeignLinks(out, new Set(closure.map((project) => project.name)));
}
