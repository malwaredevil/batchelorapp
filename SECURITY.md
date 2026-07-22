# Security Policy

## Supported Versions

Only the latest deployed version of this application is supported.

## Reporting a Vulnerability

If you discover a security vulnerability, please do **not** open a public GitHub issue.

Instead, report it privately by emailing the project maintainer directly. You can find contact information via the GitHub profile associated with this repository.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any relevant logs or screenshots (with sensitive data redacted)

You can expect an acknowledgement within 48 hours. Security issues are treated as high priority.

## Scope

This is a private household application. The attack surface includes:

- The Express API server (`/api/**`)
- Authentication flows (email/password, Google OAuth)
- AI-powered endpoints (Elaine assistant, image analysis)
- Webhook endpoints (AgentPhone, Resend inbound email)

Third-party services (Supabase, Google, OpenRouter, Resend, AgentPhone) have their own security programs and should be reported to them directly.
