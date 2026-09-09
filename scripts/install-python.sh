#!/usr/bin/env bash
#
# Install latest stable CPython (3.14) beside Ubuntu's python3 (3.12).
# Never replace /usr/bin/python3 — apt and system tools depend on it.
set -euo pipefail

WANT="${CYVRA_PYTHON_VERSION:-3.14}"
BIN="python${WANT}"

if command -v "$BIN" >/dev/null 2>&1; then
  echo "[python] $BIN already installed ($("$BIN" --version))"
  exit 0
fi

echo "[python] installing Python ${WANT} from deadsnakes (system python3 stays Ubuntu's)"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq software-properties-common gnupg
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  "python${WANT}" "python${WANT}-venv" "python${WANT}-dev"
echo "[python] $(command -v "$BIN") ($("$BIN" --version))"
