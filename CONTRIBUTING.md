# Contributing

Mudlark is a solo project by [R. Michael Thomas](https://rmichaelthomas.com).
Contributions are welcome — here's how to get involved:

**Found a bug?** Open an issue describing what you expected, what happened, and
the subject repo you were using (or a minimal reproduction).

**Have an idea?** Open an issue first. Mudlark has a specific architectural
direction — discussing before building saves everyone time.

**Want to send a PR?** Fork, branch, and open against `main`. Keep changes
focused. Run the verification suites before submitting:

```bash
npm run typecheck       # TypeScript
npm run verify          # record verification (launches a browser, re-captures)
npm run verify:player   # player verification (starts its own dev server)
npm run verify:grammar  # grammar/ files against the code they describe
```

**Code style:** TypeScript, strict mode, no runtime dependencies beyond
Playwright. The five-layer grammar and the record rule (smoothing is permitted
in presentation, forbidden in the record) are architectural invariants — changes
that violate either will be declined.

If you change the routing table in `src/layers/routing.ts`, update
`grammar/output.json` to match. `npm run verify:grammar` will fail until you do,
and will name the exact property that diverged.
