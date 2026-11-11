# Contributing

Thanks for taking a look at Super Artifact Manager!

## Quick start

1. Fork and clone the repo.
2. `cd artifact-manager && npm install` (only needed for the Playwright tests).
3. Run the tests before opening a PR:
   - `npm test`: unit and gate tests
   - `npx playwright test --config playwright.config.cjs`: end-to-end tests

No build step: `control-panel.js` runs as-is in the browser, `bin/*.js` under Node.

## Before you dive in

- Read [artifact-manager/SKILL.md](./artifact-manager/SKILL.md) first. It's the spec.
- Keep it light: one `<script>` tag, one config file, no npm dependencies. The one
  dependency is Super Annotator (comments), vendored in `annotate/`.
- `annotate/annotator.js` is vendored from
  [Super Annotator](https://github.com/SupermodularAI/super-annotator). Send changes there.
- Examples are mock products with fictional data. Never add real customer names or data.

## Development workflow

- Create a feature branch from `main`.
- Keep PRs focused: one fix or behaviour change per PR.
- Add or update tests when behaviour changes.
