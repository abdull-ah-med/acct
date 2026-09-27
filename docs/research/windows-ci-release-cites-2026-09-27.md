# Windows CI and release verification — 2026-09-27

The failed Windows Node 20/22 jobs at commit `425d203` expose two independent
problems: native binding paths contain backslashes rejected by field validation,
and shell-based test doubles do not represent executable Windows gh/git tools.

Confirmed sources:

- [Git configuration](https://git-scm.com/docs/git-config) and
  [conditional-include source](https://github.com/git/git/blob/master/Documentation/config.adoc):
  include patterns use Git's slash representation; quoted subsection contents
  still require rejecting controls, quotes and glob metacharacters.
- [Git ignore patterns](https://git-scm.com/docs/gitignore): wildcard characters
  retain their pattern meaning. Supporting Windows separators must not allow
  wildcard bindings or configuration-section injection.
- [Git rev-parse](https://git-scm.com/docs/git-rev-parse): repository toplevel and
  Git directory are different concepts. This patch does not change resolution.
- [direnv discovery](https://github.com/direnv/direnv/blob/master/README.md): nearest
  directory configuration remains the existing discovery policy.
- [Node child processes](https://nodejs.org/api/child_process.html): Windows
  `.cmd` files require a command interpreter; `execFileSync` executes a binary
  directly. Native executable test doubles avoid enabling a production shell.
- [Node CLI options](https://nodejs.org/api/cli.html#node_optionsoptions): a
  `--require` preload can bootstrap a copied Node executable before its main
  script. This mechanism is confined to disposable test environments.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): the
  existing GitHub workflow can publish through OIDC on supported hosted runners.
- [GitHub npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry):
  workflow publication uses its repository token; local package API access
  separately requires the appropriate package permission.

Threat mapping: bind-path validation concerns T4/T9/T15; retain unsafe-character
rejection after translating only recognized absolute Windows paths. Test-double
changes are N/A for production auth: no real tokens/accounts are introduced,
and no shell execution or production gh lookup behavior is changed.

Limits: macOS cannot validate the complete Windows runtime. A successful fresh
GitHub CI gate on Node 20/22 across all three operating systems is required
before declaring cross-platform verification complete. This focused release
does not resolve the separate findings in the project-wide review.
