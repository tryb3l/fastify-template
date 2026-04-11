DOCKER_COMPOSE = docker compose -f docker-compose.yml
APP_NAME = fastify-app
ENV_FILE ?= .env
DEV_MONGO_CONTAINER ?= fastify-mongo
DEV_MAILPIT_CONTAINER ?= fastify-mailpit
DEV_MONGO_URL ?= mongodb://localhost:27017/note
DEV_NODE_ENV ?= development
DEV_LOG_LEVEL ?= info
DEV_FRONTEND_URL ?= http://localhost:5173
DEV_MAIL_FROM ?= no-reply@notes.local
DEV_MAILPIT_SMTP_PORT ?= 1025
DEV_MAILPIT_UI_PORT ?= 8025
REQUIRED_ENV_VARS = JWT_SECRET COOKIE_SECRET
REQUIRE_ENV_FILE = if [ ! -f "$(ENV_FILE)" ]; then \
		echo "$(ENV_FILE) is missing. Run 'make init-env' to create it before using this target."; \
		exit 1; \
	fi;
LOAD_ENV = set -a; \
	. "$(ENV_FILE)"; \
	set +a;
VALIDATE_REQUIRED_ENV = missing_vars=""; \
	$(LOAD_ENV) \
	for var in $(REQUIRED_ENV_VARS); do \
		eval "value=\$${$$var:-}"; \
		if [ -z "$$value" ]; then \
			missing_vars="$$missing_vars $$var"; \
		fi; \
	done; \
	if [ -n "$$missing_vars" ]; then \
		echo "Missing required variables in $(ENV_FILE):$$missing_vars"; \
		echo "Update $(ENV_FILE) and rerun this target."; \
		exit 1; \
	fi;
DEV_ENV = env NODE_ENV="$${NODE_ENV:-$(DEV_NODE_ENV)}"

.PHONY: check-env
check-env:
	@$(REQUIRE_ENV_FILE)
	@$(VALIDATE_REQUIRED_ENV)

.PHONY: init-env
init-env:
	@if [ -f "$(ENV_FILE)" ]; then \
		echo "$(ENV_FILE) already exists; leaving it unchanged."; \
		echo "Review the current values or rotate secrets manually if needed."; \
		exit 0; \
	fi; \
	jwt_secret="$$(openssl rand -hex 32 2>/dev/null || true)"; \
	cookie_secret="$$(openssl rand -hex 32 2>/dev/null || true)"; \
	if [ -z "$$jwt_secret" ]; then \
		jwt_secret=replace-with-local-jwt-secret; \
	fi; \
	if [ -z "$$cookie_secret" ]; then \
		cookie_secret=replace-with-local-cookie-secret; \
	fi; \
	printf '%s\n' \
		"JWT_SECRET=$$jwt_secret" \
		"COOKIE_SECRET=$$cookie_secret" \
		"MONGO_URL=$(DEV_MONGO_URL)" \
		"FRONTEND_URL=$(DEV_FRONTEND_URL)" \
		"LOG_LEVEL=$(DEV_LOG_LEVEL)" \
		"MAIL_FROM=$(DEV_MAIL_FROM)" \
		"" \
		"# Optional real SMTP delivery testing" \
		"# SMTP_HOST=smtp.example.com" \
		"# SMTP_PORT=587" \
		"# SMTP_SECURE=false" \
		"# SMTP_USER=your-smtp-user" \
		"# SMTP_PASS=your-smtp-password" > "$(ENV_FILE)"
	@echo "Created $(ENV_FILE) for local development."
	@echo "Review the generated values and rotate secrets if you reuse this setup elsewhere."

.PHONY: dev
dev: check-env
	@echo "Cleaning up old containers..."
	docker rm -f $(DEV_MONGO_CONTAINER) $(DEV_MAILPIT_CONTAINER) 2>/dev/null || true
	@echo "Starting MongoDB for local development..."
	docker run -d -p 27017:27017 --rm --name $(DEV_MONGO_CONTAINER) mongo:8
	@echo "Starting Mailpit for local email testing..."
	docker run -d -p $(DEV_MAILPIT_SMTP_PORT):1025 -p $(DEV_MAILPIT_UI_PORT):8025 --rm --name $(DEV_MAILPIT_CONTAINER) axllent/mailpit:latest
	@echo "Waiting for MongoDB to initialize..."
	sleep 3
	@echo "Running local database migrations..."
	@$(LOAD_ENV) npm run migrate
	@echo "Starting Fastify in dev mode..."
	@echo "Mailpit UI: http://localhost:$(DEV_MAILPIT_UI_PORT)"
	@$(LOAD_ENV) $(DEV_ENV) npm run dev

.PHONY: dev-stop
dev-stop:
	@echo "Stopping local MongoDB and Mailpit"
	docker container stop $(DEV_MONGO_CONTAINER) $(DEV_MAILPIT_CONTAINER) 2>/dev/null || true

.PHONY: test
test:
	npm run test

.PHONY: test-cov
test-cov:
	npm run test:coverage

.PHONY: migrate
migrate: check-env
	@$(LOAD_ENV) npm run migrate

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