# Legacy source

For using Smerp, see the [workshop guide](../README.md). To build the current application, see [Build Smerp](../docs/building.md).

The commands below are for working on the source in this directory. Run them from `legacy-node.js/` with Node.js 24 or newer:

```sh
npm ci
npm run check
npm test
npm run build
```

To run this version, use `npm start`. It reads `config.json` and serves the files in `public/`; relative paths are resolved from this directory. A different configuration can be selected with `npm start -- --config PATH`. Use an unused listen port and a separate data file when running it alongside the current app.

The Docker setup is also contained here. Configure `config.docker.json` and the local tunnel token before running Compose from this directory. Local configuration, tokens, dependencies, build outputs and workshop data are excluded from Git.
