# Private AI Note Keeper — common workflows (targets list: `make help`)
# Docker Compose reads `.env` automatically when present.

COMPOSE ?= docker compose
BASE   := -f docker-compose.yml
CF     := -f docker-compose.cloudflare.yml
MERGED := $(BASE) $(CF)

APP_PORT ?= 8743

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show available targets
	@grep -E '^[a-zA-Z0-9_.-]+:.*?##' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

.PHONY: up
up: ## Start core stack (detached)
	$(COMPOSE) $(BASE) up -d

.PHONY: up-build
up-build: ## Build images and start core stack (first boot / after Dockerfile changes)
	$(COMPOSE) $(BASE) up --build -d

.PHONY: down
down: ## Stop core stack + optional Cloudflare sidecars if they were running
	$(COMPOSE) $(MERGED) down --remove-orphans

.PHONY: down-volumes
down-volumes: ## Stop stack and DELETE volumes (notes, models, uploads — destructive)
	$(COMPOSE) $(MERGED) down -v --remove-orphans

.PHONY: ps
ps: ## List containers for this project
	$(COMPOSE) $(MERGED) ps -a

.PHONY: logs logs-app logs-whisper logs-ollama
logs-app: ## Follow app logs
	$(COMPOSE) $(BASE) logs -f app

logs: logs-app ## Alias — follow app logs
logs-whisper: ## Follow whisper logs
	$(COMPOSE) $(BASE) logs -f whisper
logs-ollama: ## Follow ollama logs
	$(COMPOSE) $(BASE) logs -f ollama

.PHONY: tunnel-up tunnel-quick logs-tunnel-quick
tunnel-up: ## Start stack + Cloudflare named tunnel (`CLOUDFLARE_TUNNEL_TOKEN` in `.env`)
	$(COMPOSE) $(MERGED) --profile tunnel up -d
tunnel-quick: ## Start stack + Cloudflare Quick Tunnel (URL in logs)
	$(COMPOSE) $(MERGED) --profile tunnel-quick up -d
logs-tunnel-quick: ## Show Quick Tunnel URL (look for *.trycloudflare.com)
	$(COMPOSE) $(MERGED) logs cloudflared-quick

.PHONY: health
health: ## Curl `/api/health` on APP_PORT (default 8743; override `make health APP_PORT=9000`)
	@curl -sSf http://127.0.0.1:$(APP_PORT)/api/health | cat

.PHONY: rebuild-app
rebuild-app: ## Rebuild and restart only the app service
	$(COMPOSE) $(BASE) build app && $(COMPOSE) $(BASE) up -d app

.PHONY: frontend-install
frontend-install: ## `npm ci` fallback `npm install` in frontend/
	cd frontend && (npm ci 2>/dev/null || npm install)

.PHONY: frontend-dev
frontend-dev: ## Vite dev server (proxies `/api` to localhost:APP_PORT)
	cd frontend && npm run dev

.PHONY: compose-check
compose-check: ## Validate merged compose files resolve
	$(COMPOSE) $(BASE) config -q && $(COMPOSE) $(MERGED) config -q && echo OK
