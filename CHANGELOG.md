# Changelog

## 0.1.0

### Minor Changes

- 1bd1b73: M0: repository and toolchain bootstrap. The server answers `GET /healthz` with the active profile, the web app shows a placeholder page, and one container image is built per deployment profile (`full`, `denbi-registry`, `nfdi-onboarding`, `kpi-tracker`).
