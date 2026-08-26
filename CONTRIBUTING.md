# Contributing

Thanks for your interest in contributing! This project is still small and
informal, so the process is deliberately lightweight.

## Getting set up

See [SETUP.md](./SETUP.md) for installing the required tools and running
the project locally.

## Code style

- **Use a class when an object holds state across multiple calls and
  exposes lifecycle methods** (e.g. something with its own `update()` /
  `destroy()` called repeatedly over its lifetime) — see `PhysicsWorld`,
  `MovingPlatform`, or `PhysicsObject` for examples.
- **Use a plain factory function when there's no ongoing state to
  manage** — a one-shot "build this and hand it back" helper, like
  `createStairs.js` or `createPhysicsBox.js`. Don't reach for a class
  just because a function has several options; only do so once there's
  real state and repeated method calls to justify it.
- If you do add a class, keep a thin factory wrapper alongside it (e.g.
  `export function createFoo(...) { return new Foo(...); }`) so existing
  call sites that expect a function-style constructor keep working.
- **Private fields/methods use a leading underscore** (`this._world`,
  `_parseGravity()`), not JavaScript's native `#private` syntax. This is
  a project-specific convention (not enforced by the language), chosen
  for broader compatibility with in-browser tooling this project has
  been tested against. Please follow it in any new class rather than
  using `#`.

## Making a change

1. Fork the repository and create a branch off `main`:
   ```
   git checkout -b my-feature
   ```
2. Make your changes. Try to follow the existing code style — in
   particular, this project favors small, well-commented modules with a
   consistent factory-function pattern (see any file under `src/` for an
   example).
3. Test your change by running the project locally (`npm run dev`) and
   confirming it behaves as expected. There's no automated test suite yet,
   so manual verification is the current standard.
4. Commit your changes with a clear message describing *what* changed and
   *why*.
5. Push your branch and open a pull request against `main`.

## Pull request guidelines

- Keep PRs focused on a single change where possible — smaller PRs are
  easier to review and merge.
- Describe what the change does and, if it fixes a bug, how to reproduce
  the original issue.
- If your change affects behavior a user would notice (new controls, a
  new object type, a changed default), mention it in the PR description
  even if it seems minor.
- It's fine to open a PR before it's finished if you want early feedback —
  just mark it as a draft.

## Reporting bugs / suggesting features

Please open an issue using the appropriate template. Include as much
detail as you can — for bugs, steps to reproduce and what you expected to
happen; for features, what problem it solves.

## License

By contributing, you agree that your contributions will be licensed under
the project's [MIT License](./LICENSE).
