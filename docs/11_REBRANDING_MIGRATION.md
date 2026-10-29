# SyntheSift — M0 Rebranding and Local Data Migration

## Scope

This change updates the product name, browser title, service metadata, Docker Compose project name, Celery identity, developer docs, tests, API titles and diagrams. It does **not** change API routes or introduce dataset features. The live Docker environment on a developer workstation is not modified by extracting this archive.

## Choose a transition method

### A. Fresh M0 workspace

For a clean environment without existing data to retain:

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose up --build -d
docker compose ps -a
```

This creates new `synthesift_db_data` and `synthesift_redis_data` Docker volumes. Previous volumes remain untouched. Change the local sample credentials as needed, but never commit `.env`.

### B. Preserve existing M0 database and Redis data

Use this if there is any persistent data you want to keep. Do **not** delete old volumes. Stop the original application from its original directory:

```powershell
# Open PowerShell in the original datasentinel-ai-m0 folder
docker compose ps -a
docker compose down
docker volume ls --filter name=datasentinel-ai
```

Copy the original `.env` from the old project to the new `synthesift` folder, using File Explorer or `Copy-Item` with your exact directory paths. This is important: the PostgreSQL username, database name and password are properties of the **existing persisted database**, not of the product brand. Do not replace the old `POSTGRES_DB`, `POSTGRES_USER` or `POSTGRES_PASSWORD` values when reusing the old database volume.

Then, from the new `synthesift` folder:

```powershell
docker compose -f compose.yaml -f compose.legacy-data.yaml config --quiet
docker compose -f compose.yaml -f compose.legacy-data.yaml up --build -d
docker compose -f compose.yaml -f compose.legacy-data.yaml ps -a
docker compose -f compose.yaml -f compose.legacy-data.yaml exec -T api python manage.py check
docker compose -f compose.yaml -f compose.legacy-data.yaml exec -T api python manage.py verify_worker --timeout 12
Invoke-RestMethod http://localhost:3000/api/v1/health/ready
Invoke-RestMethod http://localhost:3000/api/v1/meta
```

The optional overlay declares legacy volume names as *external* so Compose neither recreates them nor owns their lifecycle. Confirm the actual volume names from `docker volume ls` before using the overlay; names can vary if the original Compose project name was overridden. If they differ, edit the overlay to match.

**Do not run `docker compose down --volumes`, `docker volume prune`, or `docker system prune --volumes` on the original stack.** They can delete data. For additional safety, back up any important PostgreSQL data before migration.

### Returning to the old instance

Stop the SyntheSift stack without volume removal, using the same Compose files that started it. Reopen the old directory and run its original `docker compose up -d`. Avoid running both instances simultaneously because they bind the same local ports.

## M0 verification

Expected: web, API, PostgreSQL, Redis and worker healthy; migration exits with 0; the Django system check and worker probe pass; health endpoints work. The `/api/v1/meta` endpoint should identify `SyntheSift`.

## Release controls

Run backend and frontend test suites, update dependency lockfiles, and obtain green GitHub Actions results before final M0 acceptance. The previous user-reported local runtime verification applies to the original branded build; it is not proof that this renamed archive has run successfully on the developer machine.
