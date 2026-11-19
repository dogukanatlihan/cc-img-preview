#!/usr/bin/env bash
#
# One SonarQube scan of the whole mod: the TypeScript in hooks/, and the C#
# painter in helpers/sixel.cs.
#
#   tools/sonar/scan.sh
#
# Needs: bun, the .NET SDK, `dotnet tool install --global dotnet-sonarscanner`,
# a SonarQube server (SONAR_HOST_URL, http://localhost:9000 when unset), and a
# token for it in SONAR_TOKEN or SONARQUBE_TOKEN.
#
# The scanner for .NET is used, not the plain sonar-scanner: only it analyses
# C#, and it takes the TypeScript beside the C# project in the same run.
set -euo pipefail
cd "$(dirname "$0")/../.."

host="${SONAR_HOST_URL:-http://localhost:9000}"
token="${SONAR_TOKEN:-${SONARQUBE_TOKEN:?Set SONAR_TOKEN or SONARQUBE_TOKEN to a token of the SonarQube server.}}"
version="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' .claude-plugin/plugin.json)"

# Coverage. `claude plugin test` is the mod's test runner and reports none, so
# the test files that need no engine are run again under bun. hooks/register.tsx
# runs only inside the engine: its 51 tests are real, and cannot be counted.
bun --config=tools/sonar/bunfig.toml test --preload ./tools/sonar/testing-shim.ts \
  --coverage --coverage-reporter=lcov --coverage-dir=tools/sonar/coverage \
  hooks/*.test.ts

dotnet sonarscanner begin \
  /k:cc-img /n:cc-img /v:"$version" \
  /d:sonar.host.url="$host" /d:sonar.token="$token" \
  /d:sonar.projectBaseDir="$PWD" \
  /d:sonar.exclusions='tools/**,docs/**,.claude-plugin/**,.superpowers/**' \
  /d:sonar.test.inclusions='hooks/**/*.test.ts,hooks/**/*.test.tsx' \
  /d:sonar.javascript.lcov.reportPaths=tools/sonar/coverage/lcov.info \
  /d:sonar.coverage.exclusions='hooks/register.tsx,helpers/**' \
  /d:sonar.qualitygate.wait=true

dotnet build tools/sonar/CcImg.csproj --no-incremental -nologo -v quiet

dotnet sonarscanner end /d:sonar.token="$token"
