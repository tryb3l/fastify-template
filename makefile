DOCKER_COMPOSE = docker compose -f docker-compose.yml
LOCAL_DOCKER_COMPOSE = docker compose -f docker-compose.yml -f docker-compose.local.yml
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
DOCKER_BIN ?= docker
DOCKER_WAIT_TIMEOUT ?= 60
DOCKER_POLL_INTERVAL ?= 1
REQUIRED_ENV_VARS = JWT_SECRET COOKIE_SECRET
ENSURE_DOCKER = if ! command -v "$(DOCKER_BIN)" >/dev/null 2>&1; then \
		echo ""; \
		echo "======================================================================"; \
		echo " ERROR: Docker is not installed!"; \
		echo "----------------------------------------------------------------------"; \
		echo " Docker is a must for this app to run (it powers local MongoDB,"; \
		echo " Mailpit, and container services)."; \
		echo " Please install Docker Desktop (macOS / Windows / Linux) or Docker"; \
		echo " Engine (Linux) and try again:"; \
		echo "   https://docs.docker.com/get-docker/"; \
		echo "======================================================================"; \
		echo ""; \
		exit 1; \
	fi; \
	if ! "$(DOCKER_BIN)" info >/dev/null 2>&1; then \
		os_name="$${DOCKER_OS:-$$(uname -s 2>/dev/null || echo Unknown)}"; \
		echo "Docker is not running. Attempting to start Docker service ($$os_name)..."; \
		case "$$os_name" in \
			Darwin*) \
				if command -v open >/dev/null 2>&1 && open -a Docker >/dev/null 2>&1; then \
					true; \
				elif command -v orbctl >/dev/null 2>&1 && orbctl start >/dev/null 2>&1; then \
					true; \
				elif command -v colima >/dev/null 2>&1 && colima start >/dev/null 2>&1; then \
					true; \
				else \
					echo "Could not start Docker automatically on macOS. Please launch Docker Desktop manually and try again."; \
					exit 1; \
				fi \
				;; \
			Linux*) \
				if command -v systemctl >/dev/null 2>&1 && (systemctl start docker >/dev/null 2>&1 || systemctl --user start docker-desktop >/dev/null 2>&1 || sudo systemctl start docker >/dev/null 2>&1); then \
					true; \
				elif command -v service >/dev/null 2>&1 && (service docker start >/dev/null 2>&1 || sudo service docker start >/dev/null 2>&1); then \
					true; \
				elif command -v powershell.exe >/dev/null 2>&1 && powershell.exe -NoProfile -NonInteractive -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'" >/dev/null 2>&1; then \
					true; \
				else \
					echo "Could not start Docker service automatically on Linux. Please run 'sudo systemctl start docker' (or start Docker Desktop) and try again."; \
					exit 1; \
				fi \
				;; \
			MINGW*|MSYS*|CYGWIN*|Windows_NT*) \
				if [ -x "/c/Program Files/Docker/Docker/Docker Desktop.exe" ]; then \
					"/c/Program Files/Docker/Docker/Docker Desktop.exe" >/dev/null 2>&1 & \
				elif command -v powershell.exe >/dev/null 2>&1 && powershell.exe -NoProfile -NonInteractive -Command "if (Test-Path 'C:\Program Files\Docker\Docker\Docker Desktop.exe') { Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' } else { Start-Service *docker* }" >/dev/null 2>&1; then \
					true; \
				elif command -v cmd.exe >/dev/null 2>&1 && cmd.exe /c "start \"\" \"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe\"" >/dev/null 2>&1; then \
					true; \
				elif command -v net >/dev/null 2>&1 && (net start com.docker.service >/dev/null 2>&1 || net start docker >/dev/null 2>&1); then \
					true; \
				else \
					echo "Could not start Docker automatically on Windows. Please launch Docker Desktop manually and try again."; \
					exit 1; \
				fi \
				;; \
			*) \
				echo "Unsupported OS ($$os_name) for automatic Docker startup. Please start Docker manually and try again."; \
				exit 1 \
				;; \
		esac; \
		echo "Waiting for Docker engine to be ready..."; \
		elapsed=0; \
		while ! "$(DOCKER_BIN)" info >/dev/null 2>&1; do \
			if [ "$$elapsed" -ge "$(DOCKER_WAIT_TIMEOUT)" ]; then \
				echo "Timed out after $(DOCKER_WAIT_TIMEOUT)s waiting for Docker engine to become ready. Please ensure Docker is running and try again."; \
				exit 1; \
			fi; \
			sleep $(DOCKER_POLL_INTERVAL); \
			elapsed=$$((elapsed + 1)); \
		done; \
		echo "Docker is ready."; \
	fi;
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

.PHONY: start-docker
start-docker: ## Ensure Docker is installed and start the Docker service if stopped
	@$(ENSURE_DOCKER)

.PHONY: dev
dev: check-env start-docker ## Start the managed local backend runtime
	@echo "Starting managed Fastify development runtime..."
	@echo "Mailpit UI: http://localhost:$(DEV_MAILPIT_UI_PORT)"
	@$(LOAD_ENV) $(DEV_ENV) npm run dev

.PHONY: dev-app
dev-app: check-env start-docker ## Start both backend and frontend in dev mode
	@echo "Starting backend and frontend..."
	@echo "Mailpit UI: http://localhost:$(DEV_MAILPIT_UI_PORT)"
	@$(LOAD_ENV) $(DEV_ENV) npm run dev & \
	npm --prefix ../note-explorer run dev & \
	wait

.PHONY: dev-compose
dev-compose: start-docker ## Start the local Docker app stack with Mailpit (no real SMTP required)
	$(LOCAL_DOCKER_COMPOSE) up -d --build

.PHONY: dev-trace
dev-trace: check-env start-docker ## Start the managed local backend runtime with trace warnings
	@echo "Starting managed Fastify trace runtime..."
	@echo "Mailpit UI: http://localhost:$(DEV_MAILPIT_UI_PORT)"
	@$(LOAD_ENV) $(DEV_ENV) npm run dev:trace

.PHONY: test
test: start-docker ## Run the managed local test suite
	npm run test

.PHONY: test-ci
test-ci: ## Run tests in CI mode (no Docker, no managed runtime)
	npm run test:ci

.PHONY: test-cov
test-cov: start-docker ## Run the managed local test suite with coverage
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
verify: start-docker ## Run the main local verification checks
	npm run lint
	npm run test

# --- Prod VPS ---
.PHONY: up
up: start-docker
	@echo "Starting production stack..."
	$(DOCKER_COMPOSE) up -d --build

.PHONY: down
down: start-docker
	@echo "Stopping production stack..."
	$(DOCKER_COMPOSE) down

.PHONY: logs
logs: start-docker
	$(DOCKER_COMPOSE) logs -f app

.PHONY: shell
shell: start-docker
	docker exec -it $(APP_NAME) sh

# --- Help ---
.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-20s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help