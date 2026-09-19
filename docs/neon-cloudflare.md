# CYVRA Mobile — Neon + Cloudflare Architecture

**Status:** ACTIVE INFRASTRUCTURE REFERENCE
**Date:** 2026-09-19

## Boundary

Browser/Desktop clients do not receive raw Neon credentials.

Architecture:

```text
Web/Desktop client
      ↓ HTTPS
Cloudflare Worker API
      ↓
Hyperdrive / controlled database connection
      ↓
Neon PostgreSQL
```

## Pages/web

Static/web frontend receives only public application configuration such as the API base URL.

Do not place `DATABASE_URL` or database passwords in browser-visible build variables.

## Worker

The Worker owns:

- authentication;
- entitlement/control-plane APIs;
- evidence/report registry APIs;
- administrative APIs;
- database access.

## Hyperdrive

When Hyperdrive is used with Neon, use the appropriate direct/unpooled Neon origin rather than stacking an external pooler behind Hyperdrive unless a separately tested design requires it.

## Migrations

Database migrations use a protected direct database connection from an authorized engineering environment.

Never put migration credentials in Pages or the customer application.

## Product separation

CYVRA Mobile infrastructure must remain separated from CYVRA Erase infrastructure unless an explicit shared service is architected and approved.

Do not reuse another product's:

```text
database
worker
session
admin token
email secret
evidence state
```

merely because both are CYVRA-branded.

## Verification

Health checks may prove Worker-to-database connectivity, but they do not prove:

- customer auth correctness;
- evidence integrity;
- report integrity;
- entitlement correctness;
- production release readiness.
