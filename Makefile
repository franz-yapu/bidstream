.PHONY: up down reset ps logs topics psql verify migrate images demo demo-down demo-reprocess

COMPOSE := docker compose
KAFKA_BIN := /opt/kafka/bin
TOPICS := bidstream.commands.bid bidstream.events.lot bidstream.events.lot.dlq

up: ## Levanta Kafka y PostgreSQL y crea los topics
	$(COMPOSE) up -d --wait kafka postgres
	$(COMPOSE) up kafka-init
	@$(MAKE) --no-print-directory topics

down: ## Detiene los servicios (conserva los datos)
	$(COMPOSE) --profile app down

reset: ## Borra los datos y vuelve a levantar todo
	$(COMPOSE) --profile app down -v
	@$(MAKE) --no-print-directory up

ps:
	$(COMPOSE) ps -a

logs:
	$(COMPOSE) logs -f --tail=100

topics: ## Describe los topics (particiones y retención)
	@for t in $(TOPICS); do \
	  $(COMPOSE) exec -T kafka $(KAFKA_BIN)/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic $$t | head -1; \
	done

psql: ## Consola de PostgreSQL
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

verify: ## Comprobaciones del entorno local (ver docs/sdd/0.2)
	@sh scripts/local/verify.sh

DATABASE_URL ?= postgresql://bidstream:bidstream@localhost:5432/bidstream

images: ## Construye las imágenes de los seis procesos (H2)
	@for app in api relay projector auditor notifier graphql; do \
	  docker build -q --build-arg APP=$$app -t bidstream-$$app:test . || exit 1; \
	done

demo: ## Todo el sistema en un comando: infraestructura, migraciones y los seis procesos (requiere `npm ci`)
	@$(MAKE) --no-print-directory up
	@$(MAKE) --no-print-directory migrate
	$(COMPOSE) --profile app up -d --build --wait
	@echo ""
	@echo "bidstream en marcha:"
	@echo "  API REST   http://localhost:$${API_PORT:-3000}/v1/docs   (cabecera X-Tenant-Id obligatoria)"
	@echo "  GraphQL    http://localhost:$${GRAPHQL_PORT:-4000}/graphql"
	@echo "  Prueba     scripts/demo-smoke.sh"
	@echo "  Detener    make demo-down"

demo-down: ## Detiene el sistema de `make demo` (conserva los datos)
	$(COMPOSE) --profile app down

demo-reprocess: ## Demostración del reproceso con entorno propio (H5; requiere `make up`)
	@scripts/demo-reprocess.sh

migrate: ## Aplica las migraciones de PostgreSQL (requiere `make up`)
	DATABASE_URL=$(DATABASE_URL) npm run db:migrate -w @bidstream/db
