# Releasing `@truefoundry/utils`

Interim setup for the fast development phase: the library in
`packages/harness` is published **publicly** to npm as `@truefoundry/utils`
so the gateway can consume it like any normal dependency. The real
open-source release happens later — every deferred item carries a
`TODO(oss):` comment in code so we can grep for them when that day comes.

> **Reality check we've accepted:** a public npm package is discoverable
> regardless of its name (npm's public change feed is scraped, and the
> package is listed on npmjs.com/org/truefoundry). Anything that must NOT be
> effectively public should not ship in the tarball. Note: sourcemaps are
> currently **enabled** (`sourcemap: true` in tsup, `declarationMap` in
> tsconfig.build.json), which embeds/references original TypeScript source in
> the published tarball — this is a deliberate, accepted trade-off for now.

## Per-release flow

1. **Bump the version via PR** (direct pushes to `main` are blocked by org
   ruleset):

   ```bash
   git checkout -b release/v0.x.y
   cd packages/harness
   npm version 0.x.y --no-git-tag-version   # edits packages/harness/package.json only
   git commit -am "chore: release v0.x.y"
   git push -u origin release/v0.x.y
   ```

   Open the PR, get 1 approval, squash-merge.

2. **Tag the merged commit** (tags trigger the publish):

   ```bash
   git checkout main && git pull
   git tag v0.x.y
   git push origin v0.x.y
   ```

3. **CI publishes automatically.** `.github/workflows/release.yml` installs,
   builds, tests, verifies the tag matches `packages/harness/package.json`,
   and runs `npm publish` via trusted publishing (OIDC — no NPM_TOKEN
   anywhere). Watch it under the repo's Actions tab.

4. **Bump the pinned version in the gateway.** Pin exact versions (no `^`)
   during the fast 0.x churn:

   ```json
   "@truefoundry/utils": "0.x.y"
   ```

## Local iteration without publishing

For tight loops, skip the publish round-trip:

```bash
cd packages/harness && pnpm build && pnpm pack
```

Point the gateway at the tarball via a `file:` dependency (or use `yalc`).
Publish a real version when CI or teammates need it.

## Troubleshooting

- **Publish fails with 403/E403**: version already published (npm versions
  are immutable — bump and re-tag), or the trusted publisher config doesn't
  match the workflow filename/repo exactly.
- **Tag/version mismatch failure**: the guard step caught a tag that doesn't
  match `packages/harness/package.json`. Delete the tag
  (`git push origin :refs/tags/vX.Y.Z`), fix the version via PR, re-tag.
- **OIDC/auth error in the publish step**: trusted publishing requires
  npm >= 11.5.1; the workflow upgrades npm globally before publishing —
  check that step ran.

## Deferred to the real OSS release — grep for `TODO(oss)`

| Item                                                                            | Where                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| License: UNLICENSED → Apache-2.0 + LICENSE file                                 | both package.jsons, repo root                           |
| Ship README / remove prepack guard / npmignore md-strip                         | packages/harness                                        |
| Add repository/homepage/bugs/keywords metadata                                  | packages/harness/package.json                           |
| Add `--provenance` to publish                                                   | .github/workflows/release.yml                           |
| Replace `internal.devtest.truefoundry.tech` URLs                                | packages/server/src/config                              |
| Private-repo links in shipped sandbox scripts                                   | packages/harness/src/core/sandbox/scripts/mcp_client.py |
| Sourcemaps/declarationMap decision                                              | packages/harness/tsup.config.ts, tsconfig.build.json    |
| CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / CODEOWNERS / CI for external PRs    | .github/                                                |
| Secret-scan history, enable secret scanning + push protection, flip repo public | GitHub settings                                         |
