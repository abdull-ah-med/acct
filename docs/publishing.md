# Publishing

`acct-sh` is published to:

- **npmjs.org** as `acct-sh` (primary install path)
- **GitHub Packages** as `@abdull-ah-med/acct-sh` (scoped; GitHub requires `@owner/...`)

CLI bins remain `acct` and `git-credential-acct` on both. Releases are cut from git tags.

Auth for npmjs is **Trusted Publishing (OIDC)**. Auth for GitHub Packages is `GITHUB_TOKEN` (`packages: write`). Classic npm write tokens were revoked by npm (2025-12-09).

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
   | Organization or user | `abdull-ah-med` |
   | Repository | `acct` |
   | Workflow filename | `release.yml` |
   | Environment name | *(leave empty)* |
   | Allowed actions | `npm publish` |

3. Optional: delete the repo secret `NPM_TOKEN` — the release workflow no longer uses it.

## Release checklist (after Trusted Publisher is configured)

1. Ensure `main` is green on CI (lint + format check, test matrix, package, **security**, e2e)
2. Bump `version` in `package.json`, update `CHANGELOG.md`, and write `docs/releases/vX.Y.Z.md`
3. Commit: `chore: release vX.Y.Z`
4. Tag and push:

```bash
git tag -a "vX.Y.Z" -m "vX.Y.Z"
git push origin main "vX.Y.Z"
```

5. The [Release](../.github/workflows/release.yml) workflow:
   - **build** (read-only): verifies the tag matches `package.json` and that release notes exist,
     runs lint, tests, security regression and e2e, then packs both tarballs
     (`acct-sh-X.Y.Z.tgz`, `abdull-ah-med-acct-sh-X.Y.Z.tgz`) plus `SHA256SUMS` and the notes into
     the `release-packages` artifact
   - **publish** (`release` environment; `id-token` + `packages` write only): checks the checksums,
     publishes exactly those tarballs with `--ignore-scripts` to npmjs.org (OIDC, provenance) and
     GitHub Packages, then confirms both registries serve the version
6. Create the GitHub Release from the maintainer account, attaching the verified artifacts:

```bash
run_id=$(gh run list --workflow release.yml --branch vX.Y.Z --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$run_id" --name release-packages --dir /tmp/acct-release
(cd /tmp/acct-release && shasum -a 256 -c SHA256SUMS)
gh release create vX.Y.Z --verify-tag --title "acct-sh vX.Y.Z" \
  --notes-file /tmp/acct-release/release.md \
  /tmp/acct-release/*.tgz /tmp/acct-release/SHA256SUMS
```

The workflow does not create the release itself, so releases are authored by the maintainer
and the publish job does not need `contents: write`.

To publish an existing tag again (for example after a registry hiccup), run **Actions → Release →
Run workflow** with `tag` set to `vX.Y.Z`; already-published versions are skipped.

After the first GitHub Packages publish, open the package → **Package settings** → set visibility to
**Public** if it is still private (GitHub defaults new packages to private).

## Local dry run

```bash
npm run lint
npm run format:check
npm test
npm run build
npm run pack:check
npm run pack:smoke
```

## Provenance

Trusted Publishing from GitHub Actions generates provenance automatically. Requires `permissions.id-token: write` and a matching Trusted Publisher on the package. Do not set `NODE_AUTH_TOKEN` on the publish step.
