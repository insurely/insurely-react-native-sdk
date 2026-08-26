Prepared by the `Release — prepare` workflow.

**Merging this PR publishes `@insurely/react-native-sdk@__VERSION__` to the public npm registry.**

That cannot be undone: `npm unpublish` only works within 72 hours, and only while nothing depends on the package. After that the tarball stays downloadable forever.

Before merging:

- [ ] The changelog reads correctly for this release
- [ ] The version bump matches what actually changed
- [ ] CI is green, including both native builds and the tarball check

The publish job re-runs the full CI suite before publishing, and waits on the `npm-publish` environment's reviewers.

See `CHANGELOG.md` for what is in this release.
