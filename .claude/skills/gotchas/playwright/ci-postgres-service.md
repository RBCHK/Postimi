# CI: Use Postgres service container, not remote Supabase

## Problem

Remote Supabase direct connections (`db.*.supabase.co:5432`) are blocked from GitHub Actions IPs. Using `secrets.TEST_DIRECT_URL` with Supabase direct URL causes `P1001: Can't reach database server`.

## Solution

Use GitHub Actions `services: postgres` — a local Postgres container per CI run:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: xreba_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U test -d xreba_test"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Then set both `DATABASE_URL` and `DIRECT_URL` to `postgresql://test:test@localhost:5432/xreba_test`.

## Why this is correct

- Free, no external dependencies
- Full isolation per CI run (clean DB every time)
- Faster than remote DB
- No network/firewall issues
- Production DB never touched by tests
