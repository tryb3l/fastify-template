DOCKER_COMPOSE = docker compose -f docker-compose.yml
APP_NAME = fastify-app

.PHONY: dev
dev:
	@echo "Cleaning up old containers..."
	docker rm -f fastify-mongo || true
	@echo "Starting MongoDB for local development..."
	docker run -d -p 27017:27017 --rm --name fastify-mongo mongo:8
	@echo "Waiting for MongoDB to initialize..."
	sleep 3
	@echo "Running local database migrations..."
	npm run migrate
	@echo "Starting Fastify in dev mode..."
	npm run dev

.PHONY: dev-stop
dev-stop:
	@echo "Stopping local MongoDB"
	docker container stop fastify-mongo || true

.PHONY: test
test:
	npm run test

.PHONY: test-cov
test-cov:
	npm run test:coverage

.PHONY: migrate
migrate:
	npm run migrate

.PHONY: lint
lint:
	npm run lint

# --- Prod VPS ---
.PHONY: up
up:
	@echo "Starting production stack..."
	$(DOCKER_COMPOSE) up -d --build

.PHONY: down
down:
	@echo "Stopping production stack..."
	$(DOCKER_COMPOSE) down

.PHONY: logs
logs:
	$(DOCKER_COMPOSE) logs -f app

.PHONY: shell
shell:
	docker exec -it $(APP_NAME) sh

# --- Help ---
.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help