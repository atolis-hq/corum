# Host font assets

These files are served only by the explicit `/vendor/:name` allowlist in
`src/web/vendor.ts`. They ship in the npm package, including the licenses here.

- `fonts.css` and `text-*.woff2`: Google Fonts CSS2 response for Inter
  (400, 500, 600, 700) and JetBrains Mono (400, 500, 600), normal style,
  `display=swap`, retrieved 2026-11-21 using a Chrome user agent. The upstream
  URL is `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap`.
  The CSS preserves every supplied Unicode range, deduplicating identical
  variable WOFF2 URLs across the requested weights. Inter is Google Fonts v20;
  JetBrains Mono is v24. Licenses: `LICENSE-inter.txt` and
  `LICENSE-jetbrains-mono.txt` (SIL Open Font License).
- `fontawesome.css`, `solid.css`, `fa-solid-900.woff2`: Font Awesome Free 6.7.2,
  from `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/` under
  `css/fontawesome.min.css`, `css/solid.min.css`, and
  `webfonts/fa-solid-900.woff2`. Only solid styling and the WOFF2 source are
  included; regular, brands, and legacy TTF files are omitted. The complete
  free-solid glyph/name/alias set is retained because plugin manifests accept
  arbitrary solid icon names. License: `LICENSE-fontawesome.txt` (OFL font,
  MIT CSS, CC BY 4.0 icons).

When updating, preserve upstream CSS Unicode ranges and icon aliases, replace
font URLs with allowlisted same-origin URLs, update the licenses, and run
`npm run test:web`. Do not subset icons against only the built-in UI's names.
