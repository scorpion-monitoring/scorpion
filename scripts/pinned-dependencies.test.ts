import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkDockerfile, checkRepository, checkWorkflow } from './pinned-dependencies.ts';

const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const digest = 'sha256:' + 'a'.repeat(64);

describe('the repository', () => {
  it('pins every action and base image', () => {
    expect(checkRepository()).toEqual([]);
  });

  it('uses a Node image of the major version in .nvmrc', () => {
    const major = readFileSync('.nvmrc', 'utf8').trim().replace(/^v/, '').split('.')[0];
    const dockerfile = readFileSync('docker/Dockerfile', 'utf8');
    const tags = [...dockerfile.matchAll(/^FROM node:(\d+)\./gim)].map((m) => m[1]);
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set([major]));
  });
});

describe('checkWorkflow', () => {
  it.each([
    [`- uses: actions/checkout@${sha} # v7.0.1`],
    [`        uses: actions/checkout@${sha} # v7.0.1`],
    [`      - uses: ./.github/actions/setup`],
    [`      - uses: docker://alpine@${digest}`],
    [`      # uses: actions/checkout@v7 (a comment)`],
    [`      - run: npx prettier@3.9.9 --check .`],
    [`      - run: pnpm exec playwright install chromium`],
    [`      - run: curl -fsS localhost:3000/healthz && curl -fsS localhost:3000/readyz`],
  ])('accepts %s', (line) => {
    expect(checkWorkflow('w.yml', line)).toEqual([]);
  });

  it.each([
    ['      - uses: actions/checkout@v7', 'not pinned by a full commit SHA'],
    ['      - uses: actions/checkout@main', 'not pinned by a full commit SHA'],
    ['      - uses: actions/checkout', 'not pinned by a full commit SHA'],
    [`      - uses: actions/checkout@${sha.slice(0, 7)}`, 'not pinned by a full commit SHA'],
    [`      - uses: actions/checkout@${sha}`, 'no trailing comment'],
    ['      - uses: "actions/checkout@v7"', 'not pinned by a full commit SHA'],
    ['      - uses: docker://alpine:3.20', 'has no digest'],
    ['      - run: curl -fsSL https://example.org/install.sh | sh', 'piped into a shell'],
    ['      - run: wget -qO- https://example.org/i.sh | sudo bash', 'piped into a shell'],
    ['      - run: npx some-tool --fix', 'unpinned package'],
    ['      - run: npx prettier@latest .', 'unpinned package'],
    ['      - run: pnpm dlx cowsay', 'unpinned package'],
  ])('rejects %s', (line, message) => {
    const findings = checkWorkflow('w.yml', line);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain(message);
  });

  it('reports the line number', () => {
    const text = `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n`;
    expect(checkWorkflow('w.yml', text)[0]).toMatchObject({ file: 'w.yml', line: 4 });
  });
});

describe('checkDockerfile', () => {
  const ok = `FROM node:24.21.0@${digest} AS build\nFROM node:24.21.0-slim@${digest} AS runtime\n`;

  it('accepts digests with a full version, and earlier stages', () => {
    expect(checkDockerfile('Dockerfile', ok + 'FROM build AS again\nFROM scratch\n', '24')).toEqual(
      [],
    );
    expect(checkDockerfile('Dockerfile', ok, 'v24.1.0')).toEqual([]);
  });

  it.each([
    ['FROM node:24', 'not pinned by digest'],
    ['FROM node:24-slim AS runtime', 'not pinned by digest'],
    ['FROM node:${NODE_VERSION}', 'not pinned by digest'],
    [`FROM node@${digest}`, 'must be a full version'],
    [`FROM node:24@${digest}`, 'must be a full version'],
    [`FROM node:lts@${digest}`, 'must be a full version'],
    [`FROM --platform=linux/amd64 node:22.1.0@${digest}`, 'differs from .nvmrc'],
    ['RUN curl -fsSL https://example.org/i.sh | sh', 'piped into a shell'],
  ])('rejects %s', (line, message) => {
    const findings = checkDockerfile('Dockerfile', line, '24');
    expect(findings.map((f) => f.message).join('\n')).toContain(message);
  });

  it('does not exempt a stage name that is declared later', () => {
    const text = `FROM build\nFROM node:24.21.0@${digest} AS build\n`;
    expect(checkDockerfile('Dockerfile', text, '24')).toHaveLength(1);
  });
});
