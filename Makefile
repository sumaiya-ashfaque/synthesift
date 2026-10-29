.PHONY: up down logs status worker-smoke smoke api-test web-test lint typecheck contract schema

up:
	docker compose up --build -d

status:
	docker compose ps

logs:
	docker compose logs --follow --tail=100

down:
	docker compose down

smoke:
	bash scripts/smoke.sh

worker-smoke:
	docker compose exec -T api python manage.py verify_worker --timeout 12

api-test:
	cd apps/api && pytest

web-test:
	cd apps/web && npm test

lint:
	cd apps/api && ruff check .
	cd apps/web && npm run lint

typecheck:
	cd apps/web && npm run typecheck

schema:
	cd apps/api && python manage.py spectacular --file ../../contracts/openapi.generated.yaml --validate

contract: schema
	python scripts/check_contract.py contracts/openapi.yaml contracts/openapi.generated.yaml
