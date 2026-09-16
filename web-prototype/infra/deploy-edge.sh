#!/usr/bin/env bash
set -euo pipefail

# Auth: a scoped API token (CLOUDFLARE_API_TOKEN) or the account's Global API
# Key (CLOUDFLARE_API_KEY, the value pipeline/.env carries) plus the account
# email (CLOUDFLARE_EMAIL). The Global Key is not a bearer token; sending it
# as one fails with "Invalid API Token".
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  CF_AUTH=("${CF_AUTH[@]}")
elif [[ -n "${CLOUDFLARE_API_KEY:-}" && -n "${CLOUDFLARE_EMAIL:-}" ]]; then
  CF_AUTH=(-H "X-Auth-Email: ${CLOUDFLARE_EMAIL}" -H "X-Auth-Key: ${CLOUDFLARE_API_KEY}")
else
  echo "CLOUDFLARE_API_TOKEN, or CLOUDFLARE_API_KEY with CLOUDFLARE_EMAIL, is required" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${DOMAIN:-smash.fun}"

zone_response="$(curl -fsS -G "https://api.cloudflare.com/client/v4/zones" \
  "${CF_AUTH[@]}" \
  --data-urlencode "name=${DOMAIN}" --data-urlencode "status=active")"
zone_id="$(printf '%s' "$zone_response" | jq -r '.result[0].id // ""')"
if [[ -z "$zone_id" ]]; then
  echo "Cloudflare zone not found for $DOMAIN" >&2
  exit 2
fi

# upsert_cache_rule DESCRIPTION EXPRESSION ACTION_PARAMETERS_JSON
upsert_cache_rule() {
  local description="$1"
  local expression="$2"
  local action_parameters="$3"
  local rulesets_response ruleset_id rule_payload ruleset_response rule_id response
  rule_payload="$(jq -nc --arg description "$description" --arg expression "$expression" --argjson action_parameters "$action_parameters" \
    '{action:"set_cache_settings", action_parameters:$action_parameters, description:$description, enabled:true, expression:$expression}')"
  rulesets_response="$(curl -fsS \
    "https://api.cloudflare.com/client/v4/zones/${zone_id}/rulesets" \
    "${CF_AUTH[@]}")"
  ruleset_id="$(printf '%s' "$rulesets_response" | jq -r \
    '.result[] | select(.kind == "zone" and .phase == "http_request_cache_settings") | .id' | head -n 1)"

  if [[ -z "$ruleset_id" ]]; then
    response="$(jq -nc --argjson rule "$rule_payload" \
      '{name:"OpenSmash cache rules", kind:"zone", phase:"http_request_cache_settings", rules:[$rule]}' | \
      curl -fsS -X POST \
        "https://api.cloudflare.com/client/v4/zones/${zone_id}/rulesets" \
        "${CF_AUTH[@]}" \
        -H "Content-Type: application/json" --data @-)"
  else
    ruleset_response="$(curl -fsS \
      "https://api.cloudflare.com/client/v4/zones/${zone_id}/rulesets/${ruleset_id}" \
      "${CF_AUTH[@]}")"
    rule_id="$(printf '%s' "$ruleset_response" | jq -r --arg description "$description" \
      '.result.rules[] | select(.description == $description) | .id' | head -n 1)"
    if [[ -z "$rule_id" ]]; then
      response="$(printf '%s' "$rule_payload" | curl -fsS -X POST \
        "https://api.cloudflare.com/client/v4/zones/${zone_id}/rulesets/${ruleset_id}/rules" \
        "${CF_AUTH[@]}" \
        -H "Content-Type: application/json" --data @-)"
    else
      response="$(printf '%s' "$rule_payload" | curl -fsS -X PATCH \
        "https://api.cloudflare.com/client/v4/zones/${zone_id}/rulesets/${ruleset_id}/rules/${rule_id}" \
        "${CF_AUTH[@]}" \
        -H "Content-Type: application/json" --data @-)"
    fi
  fi
  printf '%s' "$response" | jq -e '.success == true' >/dev/null
}

echo "==> Enabling short edge caching for the shared application shell"
upsert_cache_rule "OpenSmash application shell" \
  "(http.host in {\"${DOMAIN}\" \"www.${DOMAIN}\"} and http.request.method in {\"GET\" \"HEAD\"} and http.request.uri.path in {\"/\" \"/create\" \"/create/\" \"/og-studio\" \"/og-studio/\" \"/index.html\"})" \
  '{"cache":true,"browser_ttl":{"mode":"override_origin","default":15}}'

# The origin marks generic, baked engine files public and owner-scoped files
# private/no-store. Making the route cache-eligible while respecting those
# headers lets Cloudflare cache JS, wasm, JSON, audio, and custom bundle
# extensions without putting a Worker in the request path.
echo "==> Enabling origin-controlled caching for engine assets"
upsert_cache_rule "OpenSmash public engine assets" \
  "(http.host in {\"${DOMAIN}\" \"www.${DOMAIN}\"} and http.request.method in {\"GET\" \"HEAD\"} and starts_with(http.request.uri.path, \"/engine/\"))" \
  '{"cache":true,"edge_ttl":{"mode":"respect_origin"},"browser_ttl":{"mode":"respect_origin"}}'

# Vite's hashed app bundle. JS and CSS fall under Cloudflare's default
# extension list, but the title-screen .glb models (8 MB per visitor) do not,
# so without this rule every page view pulled them from Cloud Run.
# Hosted Melee engine files: the origin serves /melee/engine/v/<build>/... as
# immutable and unversioned /melee/engine/... with a one-hour TTL; neither
# .wasm nor .mjs is on Cloudflare's default extension list, so make the route
# cache-eligible and respect those headers (the API keeps /melee/api/ no-store).
echo "==> Enabling origin-controlled caching for hosted Melee engine files"
upsert_cache_rule "OpenSmash Melee engine assets" \
  "(http.host in {\"${DOMAIN}\" \"www.${DOMAIN}\"} and http.request.method in {\"GET\" \"HEAD\"} and starts_with(http.request.uri.path, \"/melee/engine/\"))" \
  '{"cache":true,"edge_ttl":{"mode":"respect_origin"},"browser_ttl":{"mode":"respect_origin"}}'

echo "==> Enabling edge caching for the hashed app assets"
upsert_cache_rule "OpenSmash app assets" \
  "(http.host in {\"${DOMAIN}\" \"www.${DOMAIN}\"} and http.request.method in {\"GET\" \"HEAD\"} and starts_with(http.request.uri.path, \"/app-assets/\"))" \
  '{"cache":true,"edge_ttl":{"mode":"respect_origin"},"browser_ttl":{"mode":"respect_origin"}}'

# Portraits and announcer clips of baked fighters. PNGs already fall under
# Cloudflare's default extension list, but .wav does not, so without this
# rule every announcer play reaches the origin. The origin sends
# "public, max-age=3600" and a deploy purges the zone.
echo "==> Enabling edge caching for baked character assets"
upsert_cache_rule "OpenSmash baked character assets" \
  "(http.host in {\"${DOMAIN}\" \"www.${DOMAIN}\"} and http.request.method in {\"GET\" \"HEAD\"} and starts_with(http.request.uri.path, \"/character-assets/\"))" \
  '{"cache":true,"edge_ttl":{"mode":"respect_origin"},"browser_ttl":{"mode":"respect_origin"}}'

# Smart Tiered Cache: edge colos fill from one upper-tier colo instead of each
# missing to Cloud Run independently (the 15 s shell TTL alone means ~one
# origin render per colo per 15 s without it). Free-plan feature.
echo "==> Enabling smart tiered caching"
curl -fsS -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${zone_id}/cache/tiered_cache_smart_topology_enable" \
  "${CF_AUTH[@]}" -H "Content-Type: application/json" --data '{"value":"on"}' | jq -e '.success == true' >/dev/null

for hostname in "$DOMAIN" "www.${DOMAIN}"; do
  record_response="$(curl -fsS -G \
    "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records" \
    "${CF_AUTH[@]}" \
    --data-urlencode "type=A" --data-urlencode "name=${hostname}")"
  record_id="$(printf '%s' "$record_response" | jq -r '.result[0].id // ""')"
  record_content="$(printf '%s' "$record_response" | jq -r '.result[0].content // ""')"
  if [[ -z "$record_id" || -z "$record_content" ]]; then
    echo "A record not found for $hostname" >&2
    exit 2
  fi
  payload="$(jq -nc --arg name "$hostname" --arg content "$record_content" \
    '{type:"A", name:$name, content:$content, ttl:1, proxied:true}')"
  curl -fsS -X PUT \
    "https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${record_id}" \
    "${CF_AUTH[@]}" \
    -H "Content-Type: application/json" --data "$payload" >/dev/null
done

curl -fsS -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${zone_id}/settings/ssl" \
  "${CF_AUTH[@]}" \
  -H "Content-Type: application/json" --data '{"value":"strict"}' >/dev/null

echo "Cloudflare proxy and origin-controlled cache rules are active for $DOMAIN."
