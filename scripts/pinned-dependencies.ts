// Pinned dependencies (OpenSSF Scorecard: Pinned-Dependencies; CLAUDE.md, "Security assurance").
//
// - Every `uses: owner/repo@ref` in `.github/workflows/` and `.github/actions/` pins a full 40-character
//   commit SHA. A trailing comment names the release (`# v7.0.1`), so Dependabot and readers see it.
//   Local actions (`./...`) are exempt; `docker://` actions must carry a digest.
// - Every `FROM` of a Dockerfile pins a digest (`@sha256:...`), unless it names an earlier build stage.
//   The tag in front of the digest is a full version, and its major matches `.nvmrc` for `node` images.
// - No `curl | sh`, `wget | sh` or `npx`/`pnpm dlx` of a package without an exact version in workflows
//   and Dockerfiles: a download that is executed unseen is not pinned either.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding {
  file: string;
  line: number;
  message: string;
}

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /@sha256:[0-9a-f]{64}$/;

/** Findings for one workflow or composite action file. */
export function checkWorkflow(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const code = raw.replace(/^\s*#.*$/, '');
    const uses = /^\s*(?:-\s+)?uses:\s*([^\s#]+)(\s*#\s*(\S.*))?$/.exec(code);
    if (uses) {
      const target = uses[1]!.replace(/^['"]|['"]$/g, '');
      const comment = uses[3];
      if (target.startsWith('./')) return;
      if (target.startsWith('docker://')) {
        if (!DIGEST.test(target)) findings.push({ file, line, message: `${target} has no digest` });
        return;
      }
      const ref = target.split('@')[1];
      if (!ref || !SHA.test(ref)) {
        findings.push({ file, line, message: `${target} is not pinned by a full commit SHA` });
      } else if (!comment) {
        findings.push({
          file,
          line,
          message: `${target} has no trailing comment with the release tag`,
        });
      }
    }
    if (/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(code)) {
      findings.push({ file, line, message: 'a download is piped into a shell' });
    }
    const runner = /\b(npx|pnpm dlx)\s+(?:-\S+\s+)*([^\s]+)/.exec(code);
    if (runner && !/^[^@\s]+@\d+\.\d+\.\d+/.test(runner[2]!.replace(/^@/, 'x@'))) {
      // `pnpm exec <bin>` runs a locally installed (locked) binary and is not matched here.
      findings.push({ file, line, message: `${runner[1]} ${runner[2]} runs an unpinned package` });
    }
  });
  return findings;
}

/** Findings for one Dockerfile. `nvmrc` is the content of `.nvmrc` (`24`). */
export function checkDockerfile(file: string, text: string, nvmrc: string): Finding[] {
  const findings: Finding[] = [];
  const stages = new Set<string>();
  const nodeMajor = nvmrc.trim().replace(/^v/, '').split('.')[0];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(raw);
    if (from) {
      const image = from[1]!;
      if (from[2]) stages.add(from[2].toLowerCase());
      if (stages.has(image.toLowerCase()) || image === 'scratch') return;
      if (!DIGEST.test(image)) {
        findings.push({ file, line, message: `FROM ${image} is not pinned by digest` });
        return;
      }
      const [name, tag = ''] = image.replace(DIGEST, '').split(':');
      if (!/^\d+\.\d+\.\d+/.test(tag)) {
        findings.push({
          file,
          line,
          message: `FROM ${image}: the tag must be a full version, not '${tag}'`,
        });
      }
      if (name === 'node' && tag.split('.')[0] !== nodeMajor) {
        findings.push({
          file,
          line,
          message: `FROM ${image}: node major ${tag.split('.')[0]} differs from .nvmrc (${nodeMajor})`,
        });
      }
    }
    if (/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(raw)) {
      findings.push({ file, line, message: 'a download is piped into a shell' });
    }
  });
  return findings;
}

function walk(dir: string, accept: (name: string) => boolean): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === 'node_modules' || name === '.git') return [];
      return statSync(path).isDirectory() ? walk(path, accept) : accept(name) ? [path] : [];
    });
  } catch {
    return [];
  }
}

/** Every finding in the repository at `root`. */
export function checkRepository(root = '.'): Finding[] {
  const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8');
  const workflows = [
    ...walk(join(root, '.github/workflows'), (n) => /\.ya?ml$/.test(n)),
    ...walk(join(root, '.github/actions'), (n) => /^action\.ya?ml$/.test(n)),
  ];
  const dockerfiles = [
    ...walk(join(root, 'docker'), (n) => /^Dockerfile/.test(n) || /\.Dockerfile$/.test(n)),
    ...(statSync(join(root, 'Dockerfile'), { throwIfNoEntry: false })
      ? [join(root, 'Dockerfile')]
      : []),
  ];
  return [
    ...workflows.flatMap((f) => checkWorkflow(f, readFileSync(f, 'utf8'))),
    ...dockerfiles.flatMap((f) => checkDockerfile(f, readFileSync(f, 'utf8'), nvmrc)),
  ];
}

if (import.meta.main) {
  const findings = checkRepository();
  for (const f of findings) console.error(`${f.file}:${f.line}: ${f.message}`);
  if (findings.length > 0) process.exit(1);
  console.log('All actions and base images are pinned.');
}
