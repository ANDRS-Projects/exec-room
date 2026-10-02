# Contributing to Exec Room

Thank you for your interest in contributing! This document outlines how to report issues, propose features, and submit pull requests.

## Code of Conduct

Be respectful and constructive. We're building a tool for thoughtful collaboration.

## Bug Reports

Use GitHub Issues to report bugs. Please include:

1. A clear title and description
2. Steps to reproduce (if applicable)
3. Expected behavior and actual behavior
4. Your environment (Node version, Python version, OS, `claude` version)
5. Relevant logs or error messages

## Feature Requests

Open an issue with:

1. A clear title and description of the feature
2. Why it would be useful
3. Any relevant examples or mockups

## Development Workflow

### Setup

```bash
git clone https://github.com/ANDRS-Projects/exec-room.git
cd exec-room
./setup.sh
```

### Branch Naming

Create a feature branch from `main`:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-name
```

### Making Changes

- Keep changes focused and atomic (one feature or fix per PR)
- Follow the code style of the existing codebase
- Add or update tests if your change affects behavior

### Testing

Before submitting a PR, run the full test suite:

```bash
npm test
```

All tests must pass. If you're making a change to intended behavior, update `tests/expected.txt` and document why in your PR:

```bash
python3 tests/room_suite.py --update   # Accept the new behavior as the snapshot
```

Then include the full `npm test` output in your PR description so reviewers can see the changes.

### Submitting a Pull Request

1. **Push your branch** to your fork
2. **Open a pull request** against `main`
3. **Include in the description:**
   - What your change does (1–2 sentences)
   - Why it's needed
   - Full output of `npm test` (paste the final lines showing test results)
   - If you updated `tests/expected.txt`, explain the intended behavior change
4. **Link any related issues** (e.g., "Closes #123")

A maintainer will review your PR. We may ask for changes before merging.

### Code Style

- **JavaScript:** Use the existing style (see `room-server.js` and `public/room.js`)
- **Python:** Follow PEP 8 (tests use standard Python conventions)
- **Markdown:** Wrap lines at ~100 characters; use clear headers and code blocks

## Security

**Do not:**

- Commit credentials, API keys, or tokens (even example values)
- Add dependencies without considering the security implications
- Loosen or remove any security checks in `room-server.js`

Read [SECURITY.md](SECURITY.md) for the full security model. The room's protection depends on:

- **Approval-first design:** agents propose; the owner approves
- **Localhost-only:** no remote access
- **Restricted tools:** no Bash, no API calls (agents propose instead)
- **Blocked secrets:** `.env`, `.key`, `.git`, credentials, etc. are never readable
- **Draft-only writes:** agents can only write to `drafts/`

Any PR that weakens these safeguards will not be merged.

### CI Checks

Pushes and pull requests to `main` run:

- **Gitleaks** — scans for secrets in commit history
- **Trivy** — checks for unfixed critical CVEs in dependencies (also weekly)
- **Pin actions** — on pull requests that change `.github/workflows/`, checks that actions are pinned to commit SHAs

The test suite doesn't run in CI yet, which is why the PR description needs the `npm test` output.

If a check fails, review the error and fix it before requesting review.

## Reporting a Security Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, use GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/ANDRS-Projects/exec-room/security/advisories) of this repository. This ensures your report goes to maintainers privately.

Include:

1. A description of the vulnerability
2. Steps to reproduce (if applicable)
3. Potential impact
4. Any suggested fixes

A maintainer will respond as quickly as possible.

## Questions?

- Check [CLAUDE.md](CLAUDE.md) for architecture and commands
- Read [SECURITY.md](SECURITY.md) for the security model
- Open a discussion issue if you have questions before coding

## Using Claude Code to Contribute

Claude Code can help you understand the codebase and make changes:

```bash
claude   # Starts Claude Code with full project context from CLAUDE.md
```

You can ask Claude Code to:

- Explain how a part of the code works
- Write tests for a feature
- Help you fix a bug
- Refactor code to be clearer

Just describe what you'd like to do, and Claude Code will help you write and test the code.

---

Thank you for contributing! We appreciate your help in making Exec Room better.
