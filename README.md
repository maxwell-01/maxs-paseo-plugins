# Max's Paseo plugins

[Paseo](https://paseo.sh) plugins, one per folder. Each folder is a self-contained plugin with its
own `package.json`, tests and README.

| Plugin | What it does |
| --- | --- |
| [beam](beam/) | Mirrors a workspace's working tree onto your main checkout, so a running dev environment shows its changes. |
| [cross-daemon](cross-daemon/) | Lets agents on different Paseo daemons list and message each other, without interrupting a working agent. |
| [repo-notes](repo-notes/) | Gives every agent your own notes for its repo, kept out of the repo and synced across daemons. |

## Install

Append the plugin's folder to the repo URL:

```bash
paseo plugin install https://github.com/maxwell-01/maxs-paseo-plugins.git:<folder>
```

## License

MIT. See [LICENSE](LICENSE).
