# Changesets

Changesets records consumer-visible changes to `@signal-kernel/settle` and
drives package versioning, `CHANGELOG.md`, git tags, GitHub releases, and npm
publishing.

## Add a change record

For a change that affects package consumers, run:

```bash
pnpm changeset
```

Commit the generated Markdown file with the change. Describe observable
behavior and migration impact rather than implementation details.

For documentation, tests, or repository infrastructure that does not change the
published package, no release changeset is required. If repository policy later
requires every pull request to carry a record, use:

```bash
pnpm changeset --empty
```

## Pre-1.0 bump policy

- `patch`: backward-compatible fixes and internal improvements.
- `minor`: new public capability or a breaking public-interface change before
  `1.0.0`.
- `major`: reserved for the deliberate `1.0.0` stability release.

The first implementation release starts from `0.0.0`; a `minor` changeset will
produce the RFC target version `0.1.0`.

Do not edit `package.json` versions or generated changelog release sections by
hand. The release workflow maintains a Version Packages pull request containing
those generated changes.
