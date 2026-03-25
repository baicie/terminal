# Code Review — Common Methodology

Shared across all framework-specific code review skills.

---

## Finding Severity Scale

| Marker | Meaning | Action required |
|--------|---------|----------------|
| 🔴 Critical | Exploitable security flaw, data loss risk, build break | Must fix before merge |
| 🟡 Warning | Logic bug, performance issue, maintainability risk | Fix in current sprint |
| 🟢 Suggestion | Style, readability, minor optimization | Optional, consider later |

## Priority Levels

| Priority | Meaning | Deadline |
|----------|---------|---------|
| **P0** | Blocks release | Before next deploy |
| **P1** | Technical debt or correctness risk | Current sprint |
| **P2** | Non-blocking quality issues | Near-term iteration |
| **P3** | Nice-to-have improvements | Backlog |

## Report Sections

Every review report must include:

1. **Summary Table** — all findings at a glance (ID, Severity, Dimension, Description)
2. **Detailed Findings** — one section per dimension
3. **Quick Wins** — immediately actionable fixes with exact code
4. **Follow-up** — items needing architectural discussion

## Finding Format

```
### N.N Title

**Location**: `path/to/file.ext`

**Severity**: 🟡 Warning

**Description**: Concise problem statement.

**Evidence**:
```lang:L:N:path/to/file.ext
// problematic code
```

**Impact**: What goes wrong.

**Recommendation**:
```lang
// corrected code
```

**Priority**: P1
```

## Dimension Taxonomy

| # | Dimension | Core concerns |
|---|-----------|---------------|
| 1 | Architecture | Modularity, dependencies, patterns |
| 2 | Logic | Correctness, edge cases, async |
| 3 | Security | Injection, secrets, authentication |
| 4 | Performance | Algorithmic complexity, resource usage |
| 5 | Types | Type safety, generics, exports |
| 6 | Config | Linting, tooling, dependencies |

## Review Principles

- Every finding must cite a specific file and line number.
- Distinguish between opinion (style) and fact (bug, security risk).
- Suggest the fix, not just the problem.
- Prioritize by real-world impact, not theoretical elegance.
- Check both "what the code does" and "what the code doesn't handle."
- When unsure about intent, note it as a question rather than a bug.
