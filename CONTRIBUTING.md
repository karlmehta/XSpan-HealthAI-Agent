# Contributing to XSpan Agent

Thank you for your interest in contributing to XSpan Agent! We welcome contributions from developers, healthcare technologists, and health enthusiasts.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Swift (macOS only, for Apple Health bridge)
- Git

### Development Setup

```bash
# Clone the repo
git clone https://github.com/xspanai/xspan-agent.git
cd xspan-agent

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env — set XSPAN_API_KEY and XSPAN_USER_ID

# Run in development mode
npm run dev

# Run tests
npm test

# Type check
npm run type-check
```

---

## Branching Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable releases |
| `develop` | Next version (target for PRs) |
| `feature/*` | New features |
| `fix/*` | Bug fixes |
| `docs/*` | Documentation only |

**Always open PRs against `develop`, not `main`.**

---

## Areas Where Help Is Needed

### High Priority
- 🪟 **Windows Health** — Samsung Health, Garmin Connect, Fitbit integrations
- 🧬 **Genomics Parser** — Parse 23andMe / AncestryDNA VCF files for health-relevant variants
- ⌚ **Wearables** — Oura Ring, WHOOP, Garmin, Polar API connectors
- 🏥 **More EHR Connectors** — Athena, eClinicalWorks, Allscripts

### Medium Priority
- 🧪 **Test Coverage** — Help us reach 90% coverage
- 📚 **Documentation** — Better guides for non-technical users
- 🌍 **Internationalization** — Support for non-US FHIR endpoints and units

### Good First Issues
Look for issues labeled [`good first issue`](https://github.com/xspanai/xspan-agent/labels/good%20first%20issue).

---

## Code Style

- TypeScript strict mode — no `any` unless absolutely unavoidable
- Prettier for formatting (`npm run format`)
- ESLint for linting (`npm run lint`)
- Functions should be small and single-purpose
- Use descriptive variable names
- Add JSDoc comments for public APIs

---

## Testing

All new features must include tests:

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/sync/data-pipeline.test.ts

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Coverage requirements:
- New utility functions: 100%
- New connector code: ≥ 80%
- New API client code: ≥ 80%

---

## Pull Request Process

1. Fork the repo and create your branch from `develop`
2. Make your changes with tests
3. Ensure all tests pass and linting is clean
4. Update docs if you changed behavior
5. Open a PR against `develop` with a clear description
6. Link any related issues

---

## Reporting Issues

Use our issue templates:
- 🐛 [Bug Report](https://github.com/xspanai/xspan-agent/issues/new?template=bug-report.md)
- 💡 [Feature Request](https://github.com/xspanai/xspan-agent/issues/new?template=feature-request.md)
- 🏥 [EHR Connector Request](https://github.com/xspanai/xspan-agent/issues/new?template=ehr-connector-request.md)

---

## Code of Conduct

Be kind, constructive, and inclusive. We're all working toward better health for everyone.

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
