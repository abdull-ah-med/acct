# Publishing

`acct-sh` is published to npm as a public SemVer package (CLI bins remain `acct` and `git-credential-acct`). Releases are cut from git tags.

Auth is **npm Trusted Publishing (OIDC)** from GitHub Actions — not a long-lived `NPM_TOKEN`. Classic write tokens were revoked by npm (2025-12-09).

## Versioning

- Follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`
- While `0.y.z`, breaking changes may land in minor bumps; document them in `CHANGELOG.md`
- `package.json` `version` is the source of truth; git tags must be `v` + that version (example: `0.1.0` → `v0.1.0`)
- Update `CHANGELOG.md` in the same commit that bumps the version

## One-time setup (new package name)

npm requires the package to exist before you can attach a Trusted Publisher.

1. On your machine (interactive 2FA):

```bash
npm login
npm run lint && npm test && npm run build
# Do not pass --provenance locally; it only works in CI (OIDC).
npm publish --access public
```

2. On [npmjs.com/package/acct-sh](https://www.npmjs.com/package/acct-sh) → **Settings** → **Trusted Publisher** → **GitHub Actions**:

   | Field | Value |
   | --- | --- |
   | Organization or user | `acct-sh` |
   | Repository | `acct` |
   | Workflow filename | `release.yml` |
   | Environment name | *(leave empty)* |
   | Allowed actions | `npm publish` |

3. Optional: delete the repo secret `NPM_TOKEN` — the release workflow no longer uses it.

## Release checklist (after Trusted Publisher is configured)

1. Ensure `main` is green on CI (lint, test matrix, package, e2e)
2. Bump `version` in `package.json` and update `CHANGELOG.md`
3. Commit: `chore: release vX.Y.Z`
4. Tag and push:

```bash
git tag -a "vX.Y.Z" -m "vX.Y.Z"
git push origin main --tags
```

5. The [Release](../.github/workflows/release.yml) workflow:
   - Runs lint, tests, build, and `pack:check`
   - Verifies the tag matches `package.json`
   - Publishes via OIDC (`id-token: write`); provenance is automatic
   - Creates a GitHub Release for the tag

To cut a GitHub Release for an existing tag (e.g. after a local first publish), run **Actions → Release → Run workflow** and set `tag` to `v0.1.0`.

## Local dry run

```bash
npm run lint
npm test
npm run build
npm run pack:check
```

## Provenance

Trusted Publishing from GitHub Actions generates provenance automatically. Requires `permissions.id-token: write` and a matching Trusted Publisher on the package. Do not set `NODE_AUTH_TOKEN` on the publish step.
