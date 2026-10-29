# M1.1 — Identity, Workspaces, and Project Foundations

## Scope and architecture

- Django sessions are the authentication authority. Cookies are HttpOnly for sessions; CSRF cookies are readable by the same-origin browser client for unsafe HTTP methods. The Next.js rewrite proxies `/api/v1` to Django, avoiding cross-origin bearer tokens.
- Local self-registration is enabled by default; production self-registration defaults to disabled until email verification, abuse prevention and account recovery are designed. Password policy uses Django validators. The login and registration endpoints are rate-limited using the shared Redis cache.
- A workspace has exactly one owner. `WorkspaceMembership` grants existing users `editor` or `viewer` access. Ownership is not modeled as a membership row. Only owners can manage membership and workspace metadata. Project mutation allows owner/editor; deletion is owner-only. Views resolve workspace access before querying any project ID.
- Workspace and project UUIDs are opaque identifiers, not authorization credentials. Cross-workspace references return 404. No raw dataset data is stored in M1.1.
- PostgreSQL enforces case-insensitive workspace-name uniqueness per owner, project-name uniqueness per workspace, and membership uniqueness.

## API routes

| Route | Methods | Policy |
|---|---|---|
| `/api/v1/auth/csrf` | GET | Public CSRF bootstrap |
| `/api/v1/auth/register` | POST | CSRF, throttled, enabled only where configured |
| `/api/v1/auth/login` | POST | CSRF, throttled |
| `/api/v1/auth/logout` | POST | Session + CSRF |
| `/api/v1/auth/me` | GET | Session |
| `/api/v1/workspaces` | GET, POST | Authenticated, own or shared listing; creation is owner-scoped |
| `/api/v1/workspaces/{id}` | GET, PATCH, DELETE | Visible; owner-only mutation |
| `/api/v1/workspaces/{id}/members` | GET, POST | Owner-only membership administration |
| `/api/v1/workspaces/{id}/members/{user_id}` | DELETE | Owner-only revocation |
| `/api/v1/workspaces/{id}/projects` | GET, POST | Visible; owner/editor creates |
| `/api/v1/workspaces/{id}/projects/{project_id}` | GET, PATCH, DELETE | Visible; owner/editor edits, owner deletes |

## Verification gates

Run Django system checks and migration drift check, backend pytest, Ruff, OpenAPI generation and route-surface comparison, frontend ESLint/TypeScript/Vitest/build, then the Docker integration suite. The CI workflow executes on feature branches and PRs. The original M0 service probes remain unchanged.

## Deferred work and release risks

- Email verification, invitation acceptance, password-reset flows, account deletion/export, audit-grade membership change events, configurable workspace policies and SSO are not implemented. Shared membership currently assumes an already existing account; do not expose self-service membership management to the public without consent/invite workflow and abuse review.
- Workspaces and projects are not paginated at this stage. Add pagination and query-cost controls before exposing large multi-tenant workloads.
- Production must provide HTTPS, secure cookies, trusted origins, private secrets, log review, shared throttling cache and an explicit registration policy. This milestone is an increment, not an independently security-audited SaaS release.
- M1.2 implements bounded CSV admission and immutable file storage only after M1.1 tests and CI pass.
