# Max's Paseo plugins

[Paseo](https://paseo.sh) plugins, one per folder. Each folder is a self-contained plugin with its
own `package.json`, tests and README.

| Plugin | What it does |
| --- | --- |
| [beam](beam/) | Mirrors a workspace's working tree onto your main checkout, so a running dev environment shows its changes. |

While a beam is active the workspace is also marked in Paseo's workspace list: its title gains a
⚡ prefix, and beam-out restores the title it had before. The original title is stored in the beam
state alongside main's branch and `HEAD`, so a beam-out after a daemon restart still puts it back.

## Install

Append the plugin's folder to the repo URL:

```bash
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:<folder>
```
