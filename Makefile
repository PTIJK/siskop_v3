.PHONY: install setup dev dev-fe dev-be db-start db-stop migrate seed studio db-reset test test-fe test-be build lint

install:
	npm install

setup: install db-start migrate seed
	@echo "✅ SISKOP setup complete!"
	@echo "Run 'make dev' to start development servers"

dev:
	npm run dev

dev-fe:
	npm run dev --workspace=apps/frontend

dev-be:
	npm run dev --workspace=apps/backend

db-start:
	docker-compose up -d
	@echo "Waiting for PostgreSQL..."
	@sleep 3

db-stop:
	docker-compose down

migrate:
	npx prisma migrate dev

migrate-prod:
	npx prisma migrate deploy

seed:
	npx prisma db seed

studio:
	npx prisma studio

db-reset:
	npx prisma migrate reset --force
	$(MAKE) seed

test:
	npm run test --workspaces --if-present

test-fe:
	npm run test --workspace=apps/frontend

test-be:
	npm run test --workspace=apps/backend

build:
	npm run build --workspaces

lint:
	npm run lint --workspaces --if-present

clean:
	rm -rf apps/frontend/dist apps/backend/dist node_modules/.cache
