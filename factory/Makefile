# The factory gate. Runs on the host — bun is a host tool.

.PHONY: help ci ci-fix biome check test
.DEFAULT: help

help: ## Outputs this help screen
	@grep -E '(^[a-zA-Z0-9_-]+:.*?##.*$$)|(^##)' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}{printf "\033[32m%-20s\033[0m %s\n", $$1, $$2}' | sed -e 's/\[32m##/[33m/'

ci: biome check test ## Run the full gate, check-only: never rewrites files

ci-fix: ## Format and fix in place, then run the gate
	bunx biome check --write .
	$(MAKE) ci

biome: ## Format check + lint (Biome)
	bunx biome ci .

check: ## Type-check — `bun test` transpiles but does NOT type-check, so this is the only thing that does
	bunx tsc --noEmit

test: ## All tests (unit, application, adapter, architecture, e2e)
	bun test
