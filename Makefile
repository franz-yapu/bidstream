.PHONY: up down reset ps logs topics psql verify

COMPOSE := docker compose
KAFKA_BIN := /opt/kafka/bin
TOPICS := bidstream.commands.bid bidstream.events.lot bidstream.events.lot.dlq

up: ## Levanta Kafka y PostgreSQL y crea los topics
	$(COMPOSE) up -d --wait kafka postgres
	$(COMPOSE) up kafka-init
	@$(MAKE) --no-print-directory topics

down: ## Detiene los servicios (conserva los datos)
	$(COMPOSE) down

reset: ## Borra los datos y vuelve a levantar todo
	$(COMPOSE) down -v
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
