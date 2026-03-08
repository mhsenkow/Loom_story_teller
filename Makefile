# =================================================================
#  🧵 LOOM — Command Loom (run `make` to see all commands)
# =================================================================
#  Every command is a weaving metaphor because we're extra like that.
#
#  Quick ref:
#    make spin      — dev mode (Tauri + Next.js + Ollama, hot reload)
#    make weave     — production build (.app bundle)
#    make thread    — frontend-only dev (no Rust)
#    make spool     — generate sample data for testing
#    make shuttle   — run inside Docker
#    make unspool   — clean everything
# =================================================================

.DEFAULT_GOAL := help
SHELL := /bin/zsh

# --- Colors for pretty output ---
PURPLE := \033[0;35m
CYAN   := \033[0;36m
GREEN  := \033[0;32m
DIM    := \033[2m
RESET  := \033[0m
BOLD   := \033[1m

# =================================================================
#  HELP
# =================================================================

.PHONY: help
help: ## 🧵 Show all Loom commands
	@echo ""
	@echo "  $(PURPLE)$(BOLD)🧵 LOOM$(RESET) — Data Storyteller"
	@echo "  $(DIM)Local-first data storytelling for macOS$(RESET)"
	@echo ""
	@echo "  $(BOLD)DEVELOP$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## 🔧' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "  $(BOLD)BUILD$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## 📦' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "  $(BOLD)DATA$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## 📊' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "  $(BOLD)DOCKER$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## 🐳' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "  $(BOLD)QUALITY$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## ✅' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "  $(BOLD)CLEANUP$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## 🧹' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# =================================================================
#  DEVELOP — Day-to-day dev commands
# =================================================================

.PHONY: spin
spin: ## 🔧 Start full dev mode (Tauri + Next.js + Ollama + hot reload)
	@echo "$(PURPLE)🧵 Spinning up the loom...$(RESET)"
	@if command -v ollama >/dev/null 2>&1; then \
		if ! curl -sf http://localhost:11434/api/version >/dev/null 2>&1; then \
			echo "$(DIM)  Starting Ollama in background (Suggest with AI)...$(RESET)"; \
			(ollama serve &); \
			sleep 2; \
		else \
			echo "$(DIM)  Ollama already running$(RESET)"; \
		fi; \
	fi
	npm run tauri dev

.PHONY: thread
thread: ## 🔧 Frontend-only dev server (no Rust, faster startup)
	@echo "$(PURPLE)🧵 Threading the frontend...$(RESET)"
	npm run dev

.PHONY: warp
warp: ## 🔧 Rust backend check (type-check without full build)
	@echo "$(PURPLE)🧵 Warping the backend...$(RESET)"
	cd src-tauri && cargo check

.PHONY: setup
setup: node_modules src-tauri/target ## 🔧 Install all dependencies (first-time setup)
	@echo "$(GREEN)✓ Loom is ready. Run 'make spin' to start.$(RESET)"

node_modules: package.json
	@echo "$(CYAN)Installing JS dependencies...$(RESET)"
	npm install
	@touch node_modules

src-tauri/target: src-tauri/Cargo.toml
	@echo "$(CYAN)Fetching Rust dependencies...$(RESET)"
	cd src-tauri && cargo fetch
	@mkdir -p src-tauri/target

# =================================================================
#  BUILD — Production artifacts
# =================================================================

.PHONY: weave
weave: ## 📦 Production build → .app bundle
	@echo "$(PURPLE)🧵 Weaving the final fabric...$(RESET)"
	npm run tauri build
	@echo "$(GREEN)✓ Bundle at src-tauri/target/release/bundle/$(RESET)"

.PHONY: weave-web
weave-web: ## 📦 Static web export only (no Tauri shell)
	@echo "$(PURPLE)🧵 Weaving web export...$(RESET)"
	npm run build
	@echo "$(GREEN)✓ Static site at ./out/$(RESET)"

.PHONY: weave-rust
weave-rust: ## 📦 Rust release build only
	@echo "$(PURPLE)🧵 Weaving the rust core...$(RESET)"
	cd src-tauri && cargo build --release

# =================================================================
#  DATA — Sample data generation for testing
# =================================================================

.PHONY: spool
spool: ## 📊 Generate sample datasets (10K, 100K, 1M rows)
	@echo "$(PURPLE)🧵 Spooling sample data...$(RESET)"
	@mkdir -p .loom-data
	python3 scripts/generate_data.py
	@echo "$(GREEN)✓ Sample data at .loom-data/$(RESET)"
	@echo "  Mount this folder in Loom to explore."

.PHONY: spool-small
spool-small: ## 📊 Generate small test dataset (1K rows)
	@echo "$(PURPLE)🧵 Spooling small dataset...$(RESET)"
	@mkdir -p .loom-data
	python3 scripts/generate_data.py --size small
	@echo "$(GREEN)✓ Done$(RESET)"

.PHONY: spool-mega
spool-mega: ## 📊 Generate stress-test dataset (5M rows, ~500MB)
	@echo "$(PURPLE)🧵 Spooling mega dataset... (this takes a minute)$(RESET)"
	@mkdir -p .loom-data
	python3 scripts/generate_data.py --size mega
	@echo "$(GREEN)✓ Done$(RESET)"

# =================================================================
#  DOCKER — Containerized workflows
# =================================================================

.PHONY: shuttle
shuttle: ## 🐳 Build and run the web UI in Docker
	@echo "$(PURPLE)🧵 Loading the shuttle...$(RESET)"
	docker compose up --build
	@echo "$(GREEN)✓ Loom web running at http://localhost:3000$(RESET)"

.PHONY: shuttle-build
shuttle-build: ## 🐳 Build Docker image only
	@echo "$(PURPLE)🧵 Building shuttle image...$(RESET)"
	docker compose build

.PHONY: shuttle-down
shuttle-down: ## 🐳 Stop Docker containers
	@echo "$(PURPLE)🧵 Docking the shuttle...$(RESET)"
	docker compose down

.PHONY: shuttle-shell
shuttle-shell: ## 🐳 Shell into running container
	docker compose exec loom-web /bin/sh

# =================================================================
#  QUALITY — Linting, type-checking, formatting
# =================================================================

.PHONY: check
check: check-ts check-rust ## ✅ Run all checks (TS + Rust)
	@echo "$(GREEN)✓ All checks passed$(RESET)"

.PHONY: test
test: ## ✅ Run unit tests (Vitest)
	@echo "$(CYAN)Running tests...$(RESET)"
	npm run test:run

.PHONY: check-ts
check-ts: ## ✅ TypeScript type-check + lint
	@echo "$(CYAN)Checking TypeScript...$(RESET)"
	npx tsc --noEmit
	npm run lint 2>/dev/null || true

.PHONY: check-rust
check-rust: ## ✅ Rust type-check + clippy
	@echo "$(CYAN)Checking Rust...$(RESET)"
	cd src-tauri && cargo check
	cd src-tauri && cargo clippy --all-targets 2>/dev/null || true

.PHONY: fmt
fmt: ## ✅ Format all code (Prettier + rustfmt)
	@echo "$(CYAN)Formatting...$(RESET)"
	npx prettier --write 'src/**/*.{ts,tsx,css}' 2>/dev/null || true
	cd src-tauri && cargo fmt

# =================================================================
#  CLEANUP — Tear it all down
# =================================================================

.PHONY: unspool
unspool: ## 🧹 Remove generated data
	@echo "$(PURPLE)🧵 Unspooling data...$(RESET)"
	rm -rf .loom-data
	@echo "$(GREEN)✓ Clean$(RESET)"

.PHONY: unravel
unravel: ## 🧹 Deep clean (node_modules, build artifacts, data)
	@echo "$(PURPLE)🧵 Unraveling everything...$(RESET)"
	rm -rf node_modules .next out .loom-data
	cd src-tauri && cargo clean
	@echo "$(GREEN)✓ Fully unwoven$(RESET)"

.PHONY: tidy
tidy: ## 🧹 Light clean (build caches only)
	@echo "$(PURPLE)🧵 Tidying up...$(RESET)"
	rm -rf .next out
	@echo "$(GREEN)✓ Tidy$(RESET)"
