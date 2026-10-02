# Changesets

Changesets records consumer-visible changes to `@signal-kernel/settle` and
drives package versioning, `CHANGELOG.md`, git tags, GitHub releases, and npm
publishing.

## Add a change record

For a releasable change that affects package consumers, run:

```bash
pnpm changeset
```

Commit the generated Markdown file with the change. Describe observable
behavior and migration impact rather than implementation details.

During initial incubation, incomplete behavior slices do not receive individual
package changesets. Phase 0 through Phase 4 are recorded by commits and pull
requests. Add the first `minor` changeset only after the Phase 5 minimum core
proves all four normative validity contracts and the work is intentionally
being prepared for the experimental `0.1.0` release.

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

The first release starts from `0.0.0`; the release-ready minimum core receives a
`minor` changeset that produces the RFC target version `0.1.0`.

Do not edit `package.json` versions or generated changelog release sections by
hand. The release workflow maintains a Version Packages pull request containing
those generated changes.
