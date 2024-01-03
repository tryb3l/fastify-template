build:
		@echo "Building..."
		@npm install
		@echo "Build complete"
run_database:
		@echo "Running database..."
		@npm run mongo:start
		@echo "Database is up & running"
run_server:
		@echo "Running server..."
		@npm run start
		@echo "Server is up & running"
run_test:
		@echo "Running tests..."
		@npm run test
		@echo "Tests are done"
stop_database:
		@echo "Stopping database..."
		@npm run mongo:stop
		@echo "Database is stopped"
all: build run_database run_server
		@echo "All is done"

