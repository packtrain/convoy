#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

# The CLI writes hostnames only; never source a user-writable shell file as root.
add_convoy_domains() {
    local file="${CODEX_HOME:-}/convoy-domains" domain
    [ -r "$file" ] || return 0
    while IFS= read -r domain; do
        if [[ "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]; then
            ALLOWED_DOMAINS+=("$domain")
        fi
    done < "$file"
}

resolve_ipv4_records() {
    local domain="$1"

    dig +time=5 +tries=2 +short A "$domain" | awk '/^[0-9]+\./ { print $1 }'
}

fetch_github_meta() {
    local response http_status body

    response=$(curl -sS \
        --connect-timeout 10 \
        --max-time 20 \
        -H "Accept: application/vnd.github+json" \
        -H "User-Agent: agent-sandbox-devcontainer" \
        -w $'\n%{http_code}' \
        https://api.github.com/meta) || return 1

    http_status=$(printf "%s\n" "$response" | tail -n 1)
    body=$(printf "%s\n" "$response" | sed '$d')

    if [ -z "$body" ]; then
        echo "WARN: GitHub meta endpoint returned an empty response" >&2
        return 1
    fi

    if [ "$http_status" != "200" ]; then
        echo "WARN: GitHub meta endpoint returned HTTP $http_status" >&2
        echo "WARN: GitHub meta response preview: $(printf "%s" "$body" | tr '\n' ' ' | head -c 200)" >&2
        return 1
    fi

    if ! printf "%s" "$body" | jq -e '.web and .api and .git' >/dev/null 2>&1; then
        echo "WARN: GitHub meta endpoint returned invalid or incomplete JSON" >&2
        echo "WARN: GitHub meta response preview: $(printf "%s" "$body" | tr '\n' ' ' | head -c 200)" >&2
        return 1
    fi

    printf "%s" "$body"
}

resolve_github_fallback_ips() {
    local domain ips

    for domain in \
        "github.com" \
        "api.github.com" \
        "codeload.github.com" \
        "objects.githubusercontent.com" \
        "raw.githubusercontent.com"; do
        echo "Resolving GitHub fallback host $domain..." >&2
        ips=$(resolve_ipv4_records "$domain")
        if [ -z "$ips" ]; then
            echo "ERROR: Failed to resolve GitHub fallback host $domain"
            return 1
        fi
        printf "%s\n" "$ips"
    done | sort -u
}

# ==============================================================================
# Phase 1: Gather all external data BEFORE touching iptables
# (Network may already be restricted from a previous run of this script)
# ==============================================================================

# 1a. Save Docker DNS NAT rules so we can restore them after flush
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# 1b. Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3 || true)
HOST_NETWORK=""
if [ -z "$HOST_IP" ]; then
    echo "WARN: Failed to detect host IP - the host network will NOT be allowed" >&2
else
    HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
    echo "Host network detected as: $HOST_NETWORK"
fi

# 1c. Temporarily allow all outbound HTTPS so we can fetch GitHub IP ranges and resolve domains
# (needed when re-running the script after firewall is already locked down)
iptables -I OUTPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
iptables -I OUTPUT -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -I OUTPUT -p udp --dport 53 -j ACCEPT 2>/dev/null || true

# 1d. Fetch GitHub meta information
echo "Fetching GitHub IP ranges..."
GITHUB_ALLOWLIST_KIND="cidr"
if gh_ranges=$(fetch_github_meta); then
    GITHUB_ALLOWLIST=$(printf "%s" "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)
else
    echo "WARN: Falling back to DNS-derived GitHub IP allowlist"
    GITHUB_ALLOWLIST_KIND="ip"
    GITHUB_ALLOWLIST=$(resolve_github_fallback_ips)
fi

if [ -z "${GITHUB_ALLOWLIST:-}" ]; then
    echo "WARN: Failed to build GitHub allowlist - GitHub will NOT be reachable" >&2
fi

# 1e. Build the allowed-domain list
AWS_REGION_VALUE="${AWS_REGION:-us-east-1}"

ALLOWED_DOMAINS=(
    "registry.npmjs.org"
    "api.anthropic.com"
    "claude.ai"
    "claude.com"
    "platform.claude.com"
    "api.openai.com"
    "auth.openai.com"
    "auth.api.openai.org"
    "chatgpt.com"
    "chat.openai.com"
    "ab.chatgpt.com"
    "persistent.oaistatic.com"
    "opencode.ai"
    "api.opencode.ai"
    "models.dev"
    "cursor.com"
    "api2.cursor.sh"
    "api3.cursor.sh"
    "api4.cursor.sh"
    "downloads.cursor.com"
    "sentry.io"
    "statsig.com"
    "marketplace.visualstudio.com"
    "vscode.blob.core.windows.net"
    "update.code.visualstudio.com"
    "bedrock-runtime.${AWS_REGION_VALUE}.amazonaws.com"
    "bedrock-mantle.${AWS_REGION_VALUE}.api.aws"
)

# Optional: Convoy/Convex backend (set CONVEX_DEPLOYMENT on the host to enable)
add_convoy_domains

if [ -n "${CONVEX_DEPLOYMENT:-}" ]; then
    ALLOWED_DOMAINS+=(
        "${CONVEX_DEPLOYMENT}.convex.site"
        "${CONVEX_DEPLOYMENT}.convex.cloud"
    )
else
    echo "CONVEX_DEPLOYMENT not set; skipping Convex allowlist entries"
fi

# Optional: extra project-specific domains (comma or space separated)
if [ -n "${DEVCONTAINER_EXTRA_ALLOWED_DOMAINS:-}" ]; then
    while read -r extra_domain; do
        if [ -n "$extra_domain" ]; then
            echo "Adding extra allowed domain: $extra_domain"
            ALLOWED_DOMAINS+=("$extra_domain")
        fi
    done < <(printf "%s\n" "$DEVCONTAINER_EXTRA_ALLOWED_DOMAINS" | tr ', ' '\n\n')
fi

# 1f. Resolve all allowed domains to IPs.
# Nothing from here to the DROP policy in 2f may exit: this phase runs while the
# container is still unrestricted (1c even opens 443 outright), so aborting leaves
# it with no firewall at all while `strict` mode claims otherwise. Skip what fails
# and report it at the end instead.
declare -A DOMAIN_IPS
UNRESOLVED_DOMAINS=()
for domain in "${ALLOWED_DOMAINS[@]}"; do
    echo "Resolving $domain..."
    ips=$(resolve_ipv4_records "$domain" || true)
    if [ -z "$ips" ]; then
        echo "WARN: Failed to resolve $domain - it will NOT be reachable" >&2
        UNRESOLVED_DOMAINS+=("$domain")
        continue
    fi
    DOMAIN_IPS["$domain"]="$ips"
done

echo "External data gathered"

# ==============================================================================
# Phase 2: Flush all rules and rebuild firewall from cached data
# ==============================================================================

# 2a. Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2b. Restore Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# 2c. Allow DNS and localhost before any restrictions
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# 2d. Create ipset and populate from cached data
ipset create allowed-domains hash:net

echo "Processing GitHub allowlist..."
while read -r entry; do
    if [ -z "$entry" ]; then
        continue
    fi

    if [ "$GITHUB_ALLOWLIST_KIND" = "cidr" ]; then
        if [[ ! "$entry" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
            echo "WARN: Skipping invalid CIDR range from GitHub meta: $entry" >&2
            continue
        fi
        echo "Adding GitHub range $entry"
    else
        if [[ ! "$entry" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "WARN: Skipping invalid fallback GitHub IP: $entry" >&2
            continue
        fi
        echo "Adding GitHub fallback IP $entry"
    fi

    ipset add allowed-domains "$entry"
done < <(printf "%s\n" "${GITHUB_ALLOWLIST:-}")

for domain in "${!DOMAIN_IPS[@]}"; do
    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "WARN: Skipping invalid IP from DNS for $domain: $ip" >&2
            continue
        fi
        echo "Adding $ip for $domain"
        ipset add allowed-domains "$ip" 2>/dev/null || true
    done < <(echo "${DOMAIN_IPS[$domain]}")
done

# 2e. Allow host network
if [ -n "$HOST_NETWORK" ]; then
    echo "Allowing host network: $HOST_NETWORK"
    iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
    iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT
fi

# 2f. Set default policies to DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# 2g. Allow established connections and ipset-matched traffic
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# 2h. Reject everything else with immediate feedback
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

# ==============================================================================
# Phase 3: Verify
# ==============================================================================

echo "Firewall configuration complete"
if [ ${#UNRESOLVED_DOMAINS[@]} -gt 0 ]; then
    echo "WARN: firewall applied WITHOUT these unresolvable domains:" >&2
    printf '  - %s\n' "${UNRESOLVED_DOMAINS[@]}" >&2
fi
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi
