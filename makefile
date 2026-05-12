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
check-env: ## Validate required local secrets before running managed targets
	@$(REQUIRE_ENV_FILE)
	@$(VALIDATE_REQUIRED_ENV)

.PHONY: init-env
init-env: ## Create a local .env file with safe development defaults
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
dev: check-env ## Start the managed local backend runtime
	@echo "Starting managed Fastify development runtime..."
	@echo "Mailpit UI: http://localhost:$(DEV_MAILPIT_UI_PORT)"
	@$(LOAD_ENV) $(DEV_ENV) npm run dev

.PHONY: dev-trace
dev-trace: check-env ## Start the managed local backend runtime with trace warnings
	@echo "Starting managed Fastify trace runtime..."
	@echo "Mailpit UI: http://localhost:$(DEV_MAILPIT_UI_PORT)"
	@$(LOAD_ENV) $(DEV_ENV) npm run dev:trace

.PHONY: test
test:
	npm run test

.PHONY: test-ci
test-ci:
	npm run test:ci

.PHONY: test-cov
test-cov:
	npm run test:coverage

.PHONY: migrate
migrate: check-env ## Apply db migrations with the selected env file loaded
	@$(LOAD_ENV) npm run migrate

.PHONY: lint
lint:
	npm run lint

.PHONY: runtime-status
runtime-status: ## Show human-readable status for managed local runtimes
	npm run runtime:status

.PHONY: runtime-status-json
runtime-status-json: ## Emit machine-readable managed runtime status JSON
	npm run runtime:status -- --json

.PHONY: runtime-cleanup
runtime-cleanup: ## Clean managed runtime state and owned stale processes
	npm run runtime:cleanup

.PHONY: verify
verify: ## Run the main local verification checks
	npm run lint
	npm run test

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
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-20s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help