ENV_FILE ?= .env.compose
COMPOSE := docker compose --env-file $(ENV_FILE) -f docker-compose.yml

.PHONY: ensure-env up down reset logs health test-prepare compose-config

ensure-env:
	@test -f $(ENV_FILE) || (echo "Missing $(ENV_FILE). Copy .env.compose.example to $(ENV_FILE)." && exit 1)

up: ensure-env
	$(COMPOSE) up -d --build --remove-orphans

down: ensure-env
	$(COMPOSE) down --remove-orphans

reset: ensure-env
	$(COMPOSE) down --volumes --remove-orphans
	$(COMPOSE) up -d --build

logs: ensure-env
	$(COMPOSE) logs -f --tail=200

health: ensure-env
	./scripts/healthcheck.sh $(ENV_FILE)

test-prepare: ensure-env
	./scripts/seed_local_user.sh $(ENV_FILE)

compose-config: ensure-env
	$(COMPOSE) config
