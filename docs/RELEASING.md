# Release Process

Settle uses pnpm, Changesets, GitHub Actions, and npm to maintain package change
records and publish `@signal-kernel/settle`.

The package remains at `0.0.0` until the RFC release gates are satisfied. The
repository variable `ENABLE_NPM_PUBLISH` prevents an unpublished package from
being released merely because the release workflow runs.

## Pull request workflow

1. Implement and verify one behavior slice.
2. If the published package behavior changes, run `pnpm changeset`.
3. Choose the pre-1.0 bump according to `.changeset/README.md`.
4. Commit the generated `.changeset/*.md` file with the implementation.
5. Open a pull request and wait for CI on Node 22 and Node 24.

Documentation, tests, and repository-only infrastructure do not require a
release changeset. `pnpm changeset --empty` remains available if the repository
later adopts a record-for-every-PR policy.

## Automated versioning

When a changeset reaches `main`, `.github/workflows/release.yml` selects
`version` mode and creates or updates a `chore: version packages` pull request.
That pull request:

- consumes pending changeset files;
- updates the version in `package.json`;
- updates `CHANGELOG.md` with PR and contributor links.

Review and merge this pull request like any other release change.

## Publish gate

Publishing is disabled unless the GitHub repository variable below is exactly
`true`:

```text
ENABLE_NPM_PUBLISH=true
```

Do not enable it before the experimental `0.1.0` release gates in the RFC pass.
Once enabled, merging the Version Packages pull request makes the next release
workflow enter `publish` mode, verify the package, publish it, push the git tag,
and create a GitHub release.

## One-time GitHub configuration

In repository settings:

1. Under **Actions → General**, allow GitHub Actions to create pull requests.
2. Create an environment named `npm` and add required reviewers if desired.
3. Keep `ENABLE_NPM_PUBLISH` unset or false until release approval.

The workflow uses the built-in `GITHUB_TOKEN`; no personal GitHub token is
required.

## First npm publish and trusted publishing

npm trusted publishing can only be configured after the package exists on npm.
Bootstrap the first approved release with a granular automation token stored as
the GitHub Actions secret `NPM_TOKEN`.

After the first publish:

1. Open the `@signal-kernel/settle` package settings on npmjs.com.
2. Add a GitHub Actions trusted publisher with:
   - owner: `Luciano0322`
   - repository: `settle`
   - workflow filename: `release.yml`
   - environment: `npm`
   - allowed action: `npm publish`
3. Run one release through OIDC and verify its provenance.
4. Remove `NPM_TOKEN` from GitHub after OIDC publishing succeeds.
5. Configure npm publishing access to disallow traditional tokens when the
   trusted-publisher path is proven.

The publish job uses Node 24, grants `id-token: write` only to that job, and
disables dependency caching in the release workflow. pnpm remains on the 10.x
line because it aligns with the signal-kernel repositories and supports the npm
trusted-publishing path used by Changesets.

## Local commands

```bash
pnpm install
pnpm check
pnpm changeset
pnpm version-packages
```

`pnpm release` performs a real npm publish. Do not run it merely to test the
pipeline. Use CI and `pnpm package:check` for non-publishing validation.
