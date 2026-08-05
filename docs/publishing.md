# Publishing

`acct` is published to npm as a public SemVer package. Releases are cut from git tags.

## Versioning

- Follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`
- While `0.y.z`, breaking changes may land in minor bumps; document them in `CHANGELOG.md`
- `package.json` `version` is the source of truth; git tags must be `v` + that version (example: `0.1.0` → `v0.1.0`)
- Update `CHANGELOG.md` in the same commit that bumps the version

## Release checklist

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
   - Publishes with `npm publish --access public --provenance`

## Local dry run

```bash
npm run lint
npm test
npm run build
npm run pack:check
```

If the name `acct` is taken on npm, publish as `@acct-sh/cli` while keeping bins `acct` and `git-credential-acct`.

## Provenance

GitHub Actions OIDC + `npm publish --provenance` from the release workflow. Requires `id-token: write` and `NPM_TOKEN` repository secret.
