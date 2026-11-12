# Bundled Loom typefaces

These WOFF2 fonts are distributed under the SIL Open Font License. Each family directory contains its original LICENSE; retain it when redistributing the fonts. Fontsource packages provide the source assets: https://fontsource.org/docs/getting-started/install.

`manifest.json` records each upstream package, exact version, download URL, SHA-512 archive integrity, supported styles/weights, and included files. Archives were checked against registry integrity before extraction. Variable weight fonts are preferred; IBM Plex Mono and IBM Plex Serif use static faces. WOFF fallbacks are omitted because supported Loom runtimes support WOFF2. All supplied unicode subsets are retained.

`src/styles/fonts.css` contains the corresponding font-face declarations, with the family names used by Loom (without Fontsource's “Variable” suffix). Files are served from this directory and bundled into native shells. Browsers request only used faces/subsets; the service worker caches used WOFF2 files per application build. No third-party runtime font requests or build-time downloads are required.

When updating fonts, verify the archive integrity, preserve licenses, update the manifest and declarations together, and run `src/lib/__tests__/fontCatalog.test.ts`. New deployments have a fresh static cache through the build ID.
