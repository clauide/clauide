# Clauide

Isolated Claude Code sessions, each running in its own Docker container, in a native macOS app.

## Install

```sh
brew install --cask --no-quarantine clauide/tap/clauide
```

Clauide is signed with a self-signed certificate rather than a paid Apple Developer ID, so macOS
refuses to open it while the quarantine flag is set. Homebrew applies that flag by default;
`--no-quarantine` skips it and the app opens normally.

Installing without the flag leaves the app quarantined. Clearing it afterwards has the same effect:

```sh
xattr -dr com.apple.quarantine /Applications/Clauide.app
```

Requirements:

- Apple Silicon Mac, macOS 12 or newer
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [OrbStack](https://orbstack.dev), running

## Updates

Clauide checks for new releases on launch and every ten minutes. A new version downloads in the
background and installs when you hit **Restart** in the toast that appears — no manual download.

If automatic installation is unavailable, the toast links to the release page instead.

## Development

```sh
git clone https://github.com/clauide/clauide.git
cd clauide
npm install
npm start
```

## Releasing

Releases are built and published by `.github/workflows/release.yml` when a `v*` tag is pushed.

One-time setup:

1. Create the signing certificate — run `./scripts/create-signing-cert.sh` and follow its output.
   Every release must be signed with this same certificate, otherwise installed copies reject the
   update. Back up the generated `.p12`.
2. Add the repository secrets it prints: `MAC_CERT_P12` and `MAC_CERT_PASSWORD`.
3. Create the `clauide/homebrew-tap` repository (public) and add a `TAP_TOKEN` secret — a personal
   access token with `contents: write` on that repository.

Then, for each release:

```sh
npm version patch
git push --follow-tags
```
