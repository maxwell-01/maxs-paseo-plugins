# Agent notes

## Paseo Cafe listings

[Paseo Cafe](https://paseo.cafe) lists a plugin from its entry in
[paseo-cafe/paseo-cafe](https://github.com/paseo-cafe/paseo-cafe), file `registry/<id>.json`. The
entry's `repo` and `path` tell Cafe where the plugin is. This repo holds several plugins, so every
entry must set `path` to the plugin's folder, for example `"path": "beam"`. Without `path`, Cafe
reads the repo root, which has no `paseo-plugin.json`. The listing then fails its security scan and
shows the root README's description and an install command that does not work.

Cafe reads these files from the plugin's folder:

- `paseo-plugin.json`: its `id` must equal the registry file name.
- `package.json`: `description` and `version` for the listing, and `scripts.test` and
  `scripts.typecheck` for the health checks.
- `README.md` and `LICENSE`. The repo-root licence also satisfies the licence check.

Cafe rescans an entry by itself on its next scheduled scan after its `repo`, `path` or `package`
changes. When the entry has a `package`, Cafe lists the npm release and installs with
`paseo plugin add npm:<package>@<version>`. Without one, it uses
`paseo plugin add <repo> --ref <commit> --path <folder>`.

To change an entry, open a PR on paseo-cafe that edits `registry/<id>.json`. Get Max's approval
first.
