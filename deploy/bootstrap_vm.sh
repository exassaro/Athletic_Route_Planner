#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 VM for the GATHO API (Phase 8a). Idempotent: safe to run again.
# Run as the "ubuntu" user (it uses sudo where it must):   bash deploy/bootstrap_vm.sh
#
# Does: apt upgrade; Docker Engine + compose plugin from Docker's apt repository; ubuntu in the docker group;
# a 4 GB swapfile (vm.swappiness=10); ufw allowing 22, 80, 443 only; unattended security upgrades; git, curl,
# jq, openssl and uv.
set -euo pipefail

[ "$(id -un)" != root ] || {
	echo "Run this as the ubuntu user, not root (it calls sudo itself)." >&2
	exit 1
}
# shellcheck disable=SC1091 # present on every Ubuntu
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "WARNING: written for Ubuntu 24.04, this is ${PRETTY_NAME:-unknown}." >&2

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive
APT=(sudo -E apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

say "System update"
"${APT[@]}" update
"${APT[@]}" upgrade
"${APT[@]}" install ca-certificates curl git jq openssl ufw unattended-upgrades

say "Docker Engine and the compose plugin (Docker's apt repository)"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
	sudo install -m 0755 -d /etc/apt/keyrings
	if [ ! -s /etc/apt/keyrings/docker.asc ]; then
		sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
		sudo chmod a+r /etc/apt/keyrings/docker.asc
	fi
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" |
		sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
	"${APT[@]}" update
	"${APT[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
	echo "Docker $(docker --version | cut -d' ' -f3 | tr -d ,) is installed."
fi
sudo systemctl enable --now docker containerd
NEW_GROUP=0
if ! id -nG ubuntu | tr ' ' '\n' | grep -qx docker; then
	sudo usermod -aG docker ubuntu
	NEW_GROUP=1
fi

say "Swap: 4 GB at /swapfile, swappiness 10"
if ! sudo swapon --show=NAME --noheadings | grep -qx /swapfile; then
	if [ ! -f /swapfile ]; then
		sudo fallocate -l 4G /swapfile
		sudo chmod 600 /swapfile
		sudo mkswap /swapfile
	fi
	sudo swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-gatho-swap.conf >/dev/null
sudo sysctl -q -p /etc/sysctl.d/99-gatho-swap.conf

say "Firewall: ssh, http, https only"
# 22 first, so enabling the firewall cannot cut this SSH session off.
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp # HTTP/3
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw --force enable
# Docker writes its own iptables rules for published ports, ahead of ufw. Only Caddy publishes any (80, 443),
# which are open anyway; never publish another port in deploy/docker-compose.prod.yml.

say "Unattended security upgrades"
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
sudo systemctl enable --now unattended-upgrades

say "uv (Python tool manager) for the data scripts"
if ! command -v uv >/dev/null && [ ! -x "$HOME/.local/bin/uv" ]; then
	curl -LsSf https://astral.sh/uv/install.sh | sh
fi
"$HOME/.local/bin/uv" --version 2>/dev/null || uv --version

say "Done"
free -h | sed -n '1,3p'
df -h / | tail -1
if [ "$NEW_GROUP" = 1 ] || ! id -nG | tr ' ' '\n' | grep -qx docker; then
	cat <<'EOF'

  *** Log out and log in again (exit, then ssh back in) before the next step. ***
  The docker group only applies to new logins: until then `docker ps` says "permission denied".
EOF
fi
if [ -f /var/run/reboot-required ]; then
	echo "  A kernel update wants a reboot: sudo reboot (then ssh back in; the Elastic IP stays)."
fi
