# Publishing Pageway

Pageway publishes three public packages together from `ForXd/pageway`, in dependency order:

1. `@zllling/pageway-protocol`
2. `@zllling/pageway-agent`
3. `@zllling/pageway-react`

The root package and all three packages share a fixed version. Internal dependencies remain `workspace:*` in source; `pnpm pack` replaces them with that exact release version. Applications are private and are never published.

## What is automated

Every pull request and push to `main` runs lint, formatting, type checks, unit tests with coverage thresholds, builds, isolated packed-package consumer checks, and browser end-to-end tests. Quality checks run on Node.js 24 and 26. Browser tests use the real HTTP agent with a deterministic local model provider, so required CI does not need an API key or a third-party model service.

Pushing a `v*` tag triggers `.github/workflows/release.yml`. A manual **Release npm packages** run accepts an existing version tag, making interrupted releases repeatable. Both paths:

- Require the tag to match every package version and point to a commit on `main`.
- Run the same complete validation workflow before publishing.
- Publish the exact tarballs tested by the Node.js 24 consumer job. The release job verifies the commit, package names, versions, exported files, and SHA-512 integrity again.
- Publish protocol → agent → React and wait up to five minutes for each version to become visible with matching integrity. npm may acknowledge an upload before asynchronous registry processing finishes; that acknowledgement alone does not complete the release.
- Skip an already published version only if the registry's integrity matches the tested tarball. A different tarball for the same version fails. Network failures, permission errors, and registry responses other than `404` are errors, not evidence of an unpublished package.
- Serialize release runs. The publisher alone receives `id-token: write`; PR jobs receive only `contents: read`. Checkout credentials are not persisted. Actions are pinned to commit SHAs, and Dependabot proposes updates.

Stable versions use the `latest` dist-tag; versions such as `0.2.0-beta.1` use `next`. npm versions are immutable. Fix a published release by increasing all package versions.

## One-time npm setup

The initial `0.1.0` packages were published on October 17, 2026. The steps below document bootstrap for maintainers and forks; committing the workflow alone does not configure npm trust. An owner of the target namespace must complete the npm-side steps. No npm token is stored in this repository or required by the release workflow.

Use Node.js 24+ and a current npm CLI. The workflow pins npm 12.2.0; npm's minimum for trusted publishing is npm 11.5.1 with Node.js 22.14.0. [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)

1. Run the local checks below and inspect the three generated archives.
2. If the package names do not yet exist, authenticate locally as an account with publishing access to `@zllling`: `npm login`, then `npm whoami`. Complete npm's browser sign-in and 2FA yourself. The project cannot perform this step without your account session.
3. Create the initial packages from the reviewed archives. Direct initial publication is shown below. Since October 2, 2026, `npm stage publish <archive> --access public` can also create a new package; its first version remains unavailable until the maintainer approves it. Stage protocol first and approve it before proceeding to its dependents. [npm's first-package staged publishing announcement](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/)

   ```sh
   npm publish artifacts/npm/zllling-pageway-protocol-0.1.0.tgz --access public
   npm publish artifacts/npm/zllling-pageway-agent-0.1.0.tgz --access public
   npm publish artifacts/npm/zllling-pageway-react-0.1.0.tgz --access public
   ```

4. For **each of the three packages**, open npm → Package settings → Trusted publishing → GitHub Actions and configure:

   | Field                | Value                    |
   | -------------------- | ------------------------ |
   | Organization or user | `ForXd`                  |
   | Repository           | `pageway`                |
   | Workflow filename    | `release.yml`            |
   | Environment name     | `npm`                    |
   | Allowed actions      | Enable **`npm publish`** |

   New trusted publishers now allow staged publishing by default; direct `npm publish` must be explicitly enabled for this workflow. Complete the first successful OIDC publish within two days of adding trust; npm otherwise expires an unvalidated configuration. If `0.1.0` was bootstrapped manually, the first OIDC release needs a new version such as `0.1.1`. [npm trusted publishing setup and expiry rules](https://docs.npmjs.com/trusted-publishers/)

   With npm 12, the equivalent CLI command is available for each package (npm may request browser 2FA):

   ```sh
   npm trust github @zllling/pageway-protocol --file release.yml --repository ForXd/pageway --environment npm --allow-publish
   npm trust github @zllling/pageway-agent --file release.yml --repository ForXd/pageway --environment npm --allow-publish
   npm trust github @zllling/pageway-react --file release.yml --repository ForXd/pageway --environment npm --allow-publish
   ```

5. In GitHub, create the `npm` environment. Restrict deployment tags to `v*`, and protect the default branch and release tags from unauthorized updates. An environment reviewer is optional; adding one means each release waits for that reviewer. The environment name must exactly match npm's configuration.
6. Release the next version using the procedure below. Confirm all three packages show the expected version and provenance on npm. OIDC from a public repository generates provenance automatically; the workflow also explicitly requests it. Local bootstrap publications do not carry GitHub build provenance. [npm provenance documentation](https://docs.npmjs.com/generating-provenance-statements/)

If your npm package policy requires staged publishing only, the direct-publish workflow will fail rather than bypass that policy. Adapt the publisher to `npm stage publish` and add a maintainer approval step before adopting that policy.

## Local preflight and dry run

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install
pnpm test:e2e
pnpm release:preflight
pnpm release:dry-run
```

`release:preflight` checks version alignment, package names, public access, internal dependency declarations, license metadata, and repository metadata. `release:dry-run` builds the SDK, creates the tarballs, installs all three into a fresh consumer directory, verifies runtime imports even with the `development` condition enabled, loads CSS, renders React on the server, calls the HTTP agent, compiles a strict TypeScript consumer, and runs `npm publish --dry-run`. It uploads nothing and does not require npm sign-in. Third-party dependencies still need normal registry access.

The reviewed outputs are `artifacts/npm/*.tgz` and `artifacts/npm/manifest.json`. That manifest records the source commit and archive integrities. Temporary consumers are removed after verification. `pnpm check:pack` runs the same package verification without the npm publication dry run.

## Cut a release

1. Update the root and all three public package versions together, update the changelog, and run `pnpm install` to refresh workspace resolution in the lockfile. Keep prerelease versions consistent too.
2. Run the checks above, open a pull request, and merge after CI passes.
3. From the merged `main` commit, create and push the matching tag:

   ```sh
   git switch main
   git pull --ff-only
   git tag -a v0.1.1 -m "Pageway 0.1.1"
   git push origin v0.1.1
   ```

4. Inspect the **Release npm packages** workflow. If it failed after one package published, rerun the workflow for the same tag. Matching archives are skipped; missing packages continue in order. An artifact mismatch requires investigation and a new version, not a forced overwrite.

To retry an existing tag explicitly:

```sh
gh workflow run release.yml --ref v0.1.1 -f tag=v0.1.1
```

For a manual run in GitHub's UI, select the same tag in **Run workflow → Use workflow from** and in the `tag` input. A run dispatched from `main` is rejected: its event commit would otherwise make provenance point to a different commit than the requested release.

The workflow deliberately does not publish on every branch push, accept arbitrary package names or registry URLs, use long-lived publishing tokens, or change npm ownership. `npm` environment protection and npm trusted publisher settings remain account-side configuration.
