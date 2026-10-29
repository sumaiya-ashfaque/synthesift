# Security policy

## Reporting

Do not publish exploits, private datasets, authentication secrets or credential material in issues. Contact the repository owner through a private channel described in the hosting repository's security settings. A public vulnerability disclosure inbox will be added before external release.

## Supported scope

M0 is a local-development foundation, not a publicly hosted data-processing service. The health and metadata endpoints are intentionally anonymous; no dataset upload, authentication flows, Gemini integration, or transformation execution exists yet. The local database credential is for local isolated Compose use only.

## Deployment requirements

Do not expose the M0 deployment to the public internet without a deployment review, unique secrets, TLS, network policy, authentication, production-specific settings, dependency lock files, security scanning and backup/restore evidence. Never reuse `.env.example` values in hosted deployments.

See `docs/04_SECURITY_PRIVACY.md` for the full threat model.
