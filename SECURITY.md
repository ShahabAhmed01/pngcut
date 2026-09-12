# Security Policy

## Reporting a vulnerability

If you believe you have found a security issue in PNGCut, please report it
responsibly instead of opening a public issue or publishing a working exploit.

- **Private disclosure:** use GitHub's private vulnerability reporting via the
  **Security** tab of the repository (https://github.com/ShahabAhmed01/pngcut),
  or email the project maintainer if a private channel is listed in the repo.
- **Do not** publish a working exploit or a proof-of-concept in a public issue
  before a fix is available.
- Include enough detail to reproduce the issue: affected component, browser and
  version, and a description of the impact. You do not need to share private
  media files.

## Supported versions

Only the latest deployed version of the application and the latest commit on the
`main` branch are supported for security fixes.

## Disclosure process

1. Acknowledgment of the report.
2. Assessment of impact.
3. A fix is prepared in a private or unannounced branch where possible.
4. A public fix is released, and the reporter is credited unless they prefer to
   remain anonymous.

## Security model assumptions

PNGCut is a client-side application. It processes user-selected media locally in
the browser and does not upload that media for background removal. The security
boundaries of interest are:

- no user-selected media may leave the browser through the background-removal
  pipeline;
- malicious or malformed media must not exhaust memory/CPU or otherwise crash
  the tab;
- user-controlled strings (filenames, metadata) must never be injected into the
  DOM unsafely;
- cross-origin isolation and content-security-policy headers must remain
  effective;
- no unexpected third-party requests should be introduced.

Bug reports in these areas are especially welcome.