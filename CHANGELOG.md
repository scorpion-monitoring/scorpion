# Changelog

## 0.1.1

### Patch Changes

- d6af528: The development stack and the integration tests now use pinned images (PostgreSQL 16.15 and Mailpit v1.31.3), so local and CI environments are reproducible. Pull requests that change only documentation no longer need a changeset. Nothing changes for running instances.

## 0.1.0

### Minor Changes

- 1bd1b73: M0: repository and toolchain bootstrap. The server answers `GET /healthz` with the active profile, the web app shows a placeholder page, and one container image is built per deployment profile (`full`, `denbi-registry`, `nfdi-onboarding`, `kpi-tracker`).
