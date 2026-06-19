# Release automation for the Polytomic MCP connector bundle.
#
# manifest.json is the source of truth for the bundle version (what Claude
# Desktop displays and uses for in-place update detection). These targets keep
# package.json / package-lock.json in sync, commit, and tag vX.Y.Z. Pushing the
# tag triggers .github/workflows/release.yml, which packs and publishes the
# .mcpb to a GitHub Release.

MCPB := npx --yes @anthropic-ai/mcpb@2.1.2
VERSION := $(shell node -p "require('./manifest.json').version" 2>/dev/null)

.PHONY: help
help:
	@echo "Current version: $(VERSION)"
	@echo ""
	@echo "Cut a release (bumps versions, commits, tags vX.Y.Z):"
	@echo "  make release BUMP=patch      # x.y.Z+1   bug fixes"
	@echo "  make release BUMP=minor      # x.Y+1.0   features"
	@echo "  make release BUMP=major      # X+1.0.0   breaking changes"
	@echo "  make release TO=1.2.3        # set an explicit version"
	@echo ""
	@echo "Publish (triggers the release build):"
	@echo "  make push                    # push the commit + tag"
	@echo "  (one-shot: make release BUMP=patch push)"
	@echo ""
	@echo "Local build:"
	@echo "  make validate                # validate manifest.json"
	@echo "  make pack                    # build dist/polytomic-connector.mcpb"

.PHONY: validate
validate:
	$(MCPB) validate manifest.json

.PHONY: pack
pack:
	mkdir -p dist
	$(MCPB) pack . dist/polytomic-connector.mcpb

.PHONY: release
release:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "error: working tree is not clean; commit or stash first."; exit 1; fi
	@cur="$(VERSION)"; \
	if [ -n "$(TO)" ]; then new="$(TO)"; \
	elif [ "$(BUMP)" = "patch" ]; then new=$$(echo "$$cur" | awk -F. '{printf "%d.%d.%d", $$1, $$2, $$3+1}'); \
	elif [ "$(BUMP)" = "minor" ]; then new=$$(echo "$$cur" | awk -F. '{printf "%d.%d.0", $$1, $$2+1}'); \
	elif [ "$(BUMP)" = "major" ]; then new=$$(echo "$$cur" | awk -F. '{printf "%d.0.0", $$1+1}'); \
	else echo "usage: make release BUMP=patch|minor|major   (or TO=X.Y.Z)"; exit 2; fi; \
	if ! echo "$$new" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
		echo "error: '$$new' is not a valid X.Y.Z version"; exit 2; fi; \
	if git rev-parse -q --verify "refs/tags/v$$new" >/dev/null; then \
		echo "error: tag v$$new already exists"; exit 1; fi; \
	echo "Releasing $$cur -> $$new"; \
	node -e "const fs=require('fs'),v=process.argv[1],f='manifest.json';const j=JSON.parse(fs.readFileSync(f));j.version=v;fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n');" "$$new"; \
	npm version "$$new" --no-git-tag-version --allow-same-version >/dev/null; \
	$(MCPB) validate manifest.json; \
	git add manifest.json package.json package-lock.json; \
	git commit -q -m "Release v$$new"; \
	git tag -a "v$$new" -m "v$$new"; \
	echo "Committed and tagged v$$new. Run 'make push' to publish."

.PHONY: push
push:
	git push --follow-tags
