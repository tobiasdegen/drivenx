# Contributing to DriveNX

Contributions to DriveNX are welcome. The original application code is licensed under [MIT](LICENSE.md); third-party code and data keep their respective licenses.

## Getting started

1. Read [the architecture](docs/ARCHITECTURE.md) and open an issue before starting substantial changes.
2. Install Node.js 24 and run `npm ci` followed by `npm run dev`.
3. Implement one focused change at a time. Prefer explicit code and existing modules over additional frameworks or compatibility layers.
4. Add or update meaningful tests for functionality, parsing, security boundaries and behavior; avoid tests that only pin file organization or formatting details.
5. Run `npm run release:check`. State which platforms and real devices (if any) were tested in the pull request.

Use `.js` for Electron, Node scripts and tests; use `.mjs` for the existing shared ESM modules, and `.ts`/`.tsx` for the React renderer. Do not introduce additional transpilers or file extensions just to reorganize code. Run `npm run typecheck` for the combined type checks and `npm run lint` for the JavaScript/ESM lint checks.

## Where changes belong

- Renderer and interaction: `src/`.
- SMART collection and self-tests: `electron/devices/`.
- Health rules: `electron/diagnostics/` and shared measurement helpers.
- OS-specific operations: `electron/platform/`, with privileged Linux actions in `linux/privileged/`.
- IPC contracts: `src/ipc-contract.ts`; runtime validation and authorization: `electron/ipc/`.
- Translations: `locales/en-US.json` and `locales/de-DE.json`. See [the translator guide](docs/TRANSLATORS.md).

See [DEVICE-DETECTION.md](docs/DEVICE-DETECTION.md) for protocol and identity rules, [DIAGNOSTICS.md](docs/DIAGNOSTICS.md) for risk assessment, and [TESTING.md](docs/TESTING.md) for test coverage and native verification.

## Safety and data

Do not access device nodes from the renderer, bypass the Electron sandbox, broaden privileged helper commands without review, or infer hardware capabilities from a vendor/product ID. Implement protocol-generic solutions and test both known and unknown inputs.

Keep fixtures sanitized: remove serial numbers, WWNs, personally identifying paths, private keys, tokens and customer data. Contribute only code, assets and data that you have the right to distribute under the applicable licenses. Preserve original third-party copyright and license notices.

Use GitHub private vulnerability reporting when available for security issues. Contributors retain copyright in their original work and submit it under the project's MIT license.
