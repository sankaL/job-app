ENV_FILE ?= .env.compose
COMPOSE := docker compose --env-file $(ENV_FILE) -f docker-compose.yml

.PHONY: ensure-env auto-ports up down reset logs health test-prepare compose-config

ensure-env:
	@test -f $(ENV_FILE) || (echo "Missing $(ENV_FILE). Copy .env.compose.example to $(ENV_FILE)." && exit 1)

auto-ports: ensure-env
	./scripts/auto-assign-ports.sh $(ENV_FILE)

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
