# Pull Request Template

Thanks for contributing to PNGCut! Please fill in the sections below.

## Summary
Briefly describe what this PR does.

## Motivation
What problem does this solve? Link to the related issue, if any.

## Changes
List the changes made, file by file where helpful.

## Testing performed
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run check:patches`
- [ ] Manual check in the dev server (browser and version)

## Checklist
- [ ] No user-selected media is uploaded or sent to a server
- [ ] New features are client-side and free
- [ ] Docs updated (README, public pages) if user-facing behavior changed
- [ ] Tests added or updated for new behavior
- [ ] CSP-safe: no `new Function('...')` introduced in the inference bundle

## Additional notes
Anything else the reviewer should know (browsers tested, file sizes, edge cases).
