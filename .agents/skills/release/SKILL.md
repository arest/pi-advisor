---
name: release
description: Prepare and validate a minor pi-advisor release.
disable-model-invocation: true
---

- require a clean tree
- bump `package.json` (by patch or minor, to be specificed by the user) and move dated Unreleased notes in `CHANGELOG.md`.
- Before committing, pass `bun test`, `bun run test:node-loader`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run check:boundaries`, `bun audit --audit-level=high`, `bun run build`, verify `dist/index.js` unchanged and clean, `bun run package:check` (`scripts/check-package.mjs`), verify dist unchanged/clean again,`bun run audit`, `bun scripts/audit.mjs`, and `git diff --check`.
- commit with `chore(release): prepare release v{versionNumber}`

Do not push any tags.
