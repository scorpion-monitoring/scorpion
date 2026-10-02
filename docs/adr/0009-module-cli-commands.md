# ADR-0009: CLI commands contributed by modules

- Status: Accepted
- Date: 2026-10-02

## Context

M2 needs `scorpion create-admin` (implementation.md, M2; architecture "Operations": `scorpion migrate | seed |
create-admin | rotate-secrets | backup | restore`). The M2 sprint plan says it is "contributed by the module
through the CLI registry, not a hard-coded one". The CLI (`apps/server/src/cli.ts`) had a fixed `switch`, and the
kernel had no way for a module to add a command. Later milestones need the same (`seed`, `rotate-secrets`,
`backup`, `restore`), and a profile without the module must not have the command.

## Decision

- **A manifest field, not a registry.** `commands: CommandDef[]`, next to `jobs`:
  `{ name, description, usage?, run(args, io, ctx) }`. A registry is for entries that the owner reads at run
  time (`ctx.registry()`); a command is read by the CLI before any module is built, from the manifests that
  the generated profile file already imports. A manifest field needs no second mechanism and is validated
  with the rest of the manifest.
- **Names** are lower-case kebab case (`create-admin`), unique across the profile (start-up fails if two
  modules declare one), and cannot be `start`, `worker`, `migrate`, `profile:generate` or `help`. The usage
  text lists the commands of the modules in the build, so a profile without the module has neither the
  command nor the line.
- **What a command gets.** `kernel.runCommand(name, args, io)` applies pending migrations and builds the
  services of every module (loader steps 2 and 5), then runs the command with the module's own `ctx`. It
  registers no routes, starts no workers, and does **not** emit `system.ready`, so a command never triggers
  start-up behaviour such as the first-run token. The process then closes the pool and exits with the
  command's code.
- **`io`** is `{ out, err, readSecret }`. `readSecret(prompt)` asks on the terminal without echo, or reads one
  line of standard input when there is no terminal (a pipe, `docker run -i`). **A secret never comes from
  `argv`**, where the process list and the shell history keep it; `create-admin` refuses `--password` for that
  reason. Output goes through `io` so tests can read it and so no command writes to a logger by accident.
- Commands call the module's services like any other entry point (CLAUDE.md rule 5): no command has its own
  logic for data changes.

## Consequences

- `create-admin` and later commands are contributions of the module that owns the data.
- A command that needs the database pays for migrations and service construction on every run, as `start`
  does.
- The CLI decides "is this a module command" from the manifests (static), and only then opens the database.
