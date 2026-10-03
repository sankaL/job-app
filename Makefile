ENV_FILE ?= .env.compose
COMPOSE := docker compose --env-file $(ENV_FILE) -f docker-compose.yml

.PHONY: dev-frontend ensure-env auto-ports up down reset logs health test-prepare compose-config test-stack test-migrate test-backend test-agents test-frontend test test-build test-browser test-browser-seed test-browser-seed-check test-browser-export test-local-guards test-resume-evals eval-resumes

ensure-env:
	@test -f $(ENV_FILE) || (echo "Missing $(ENV_FILE). Copy .env.compose.example to $(ENV_FILE)." && exit 1)

auto-ports: ensure-env
	./scripts/auto-assign-ports.sh $(ENV_FILE)

dev-frontend: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) up -d --no-deps --build frontend

up: auto-ports
	$(COMPOSE) up -d --build --remove-orphans

down: ensure-env
	$(COMPOSE) down --remove-orphans

reset: ensure-env
	$(COMPOSE) down --volumes --remove-orphans
	$(MAKE) up

logs: ensure-env
	$(COMPOSE) logs -f --tail=200

health: ensure-env
	./scripts/healthcheck.sh $(ENV_FILE)

test-prepare: ensure-env
	./scripts/seed_local_user.sh $(ENV_FILE)

compose-config: ensure-env
	$(COMPOSE) config

# Regression checks use the local Docker network and never real provider keys.
test-stack: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) up -d postgres redis migration-runner
	$(COMPOSE) build backend agents frontend

test-migrate: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) run --rm migration-runner

test-backend: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) run --rm --no-deps -v "$(CURDIR)/agents:/agents:ro" -v "$(CURDIR)/supabase:/supabase:ro" -e APP_DEV_MODE=true -e ADMIN_EMAILS= -e OPENROUTER_API_KEY=test-only -e LANGSMITH_TRACING=false -e LANGSMITH_API_KEY= backend sh -c 'pip install --quiet -e ".[dev]" && python -m pytest $(TEST_ARGS)'

test-agents: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) run --rm --no-deps -v "$(CURDIR)/docker-compose.yml:/docker-compose.yml:ro" -v "$(CURDIR)/.env.compose.example:/.env.compose.example:ro" -e APP_DEV_MODE=true -e OPENROUTER_API_KEY=test-only -e LANGSMITH_TRACING=false -e LANGSMITH_API_KEY= agents sh -c 'pip install --quiet -e ".[dev]" && python -m pytest $(TEST_ARGS)'

test-frontend: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) run --rm --no-deps frontend npm test -- $(TEST_ARGS)

test-build: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) run --rm --no-deps frontend npm run build

test-browser: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE) --browser
	@running_agents="$$( $(COMPOSE) ps --status running -q agents )" || { echo "Unable to verify the local agents worker state; browser testing was not started."; exit 1; }; \
	if [ -n "$$running_agents" ]; then echo "Browser testing requires the local agents worker to be stopped explicitly before retrying. No services were stopped."; exit 1; fi
	APP_DEV_MODE=true OPENROUTER_API_KEY=test-only LANGSMITH_TRACING=false LANGSMITH_API_KEY= EMAIL_NOTIFICATIONS_ENABLED=false ADMIN_EMAILS= $(COMPOSE) up -d backend frontend

test-browser-seed: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) exec -T backend python - < scripts/seed_section_walkthrough.py

test-browser-seed-check: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) exec -T backend python - --verify-atomic < scripts/seed_section_walkthrough.py

test-browser-export: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE) --browser
	$(COMPOSE) exec -T backend python - --verify-exports < scripts/seed_section_walkthrough.py

test-local-guards:
	python3 -m unittest discover -s scripts/tests -p 'test_test_environment.py'

test-resume-evals: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) run --rm --no-deps -e OPENROUTER_API_KEY=test-only -e LANGSMITH_TRACING=false -e LANGSMITH_API_KEY= agents python evals/run_sections.py $(EVAL_ARGS)

eval-resumes: ensure-env
	@python3 scripts/check-test-env.py $(ENV_FILE)
	$(COMPOSE) run --rm --no-deps -e LANGSMITH_TRACING=false -e LANGSMITH_API_KEY= agents python evals/run_sections.py --live $(EVAL_ARGS)

test: test-backend test-agents test-frontend test-build
