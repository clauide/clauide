#!/usr/bin/env bash
#
# Creates the free self-signed code signing certificate that Clauide releases are signed with.
# Run this ONCE, then keep the generated .p12 safe — every future release must be signed with the
# same certificate or already-installed copies will refuse to auto-update.
#
#   ./scripts/create-signing-cert.sh
#
set -euo pipefail

CN="Clauide Self Signed"
OUT_DIR="${1:-$HOME/.clauide-signing}"
KEY="$OUT_DIR/clauide.key"
CERT="$OUT_DIR/clauide.crt"
P12="$OUT_DIR/clauide-signing.p12"
CONFIG="$OUT_DIR/openssl.cnf"

if security find-certificate -c "$CN" >/dev/null 2>&1; then
  echo "A certificate named '$CN' is already in your keychain."
  echo "Delete it from Keychain Access first if you really want to create a new one."
  exit 1
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

PASSWORD="$(openssl rand -base64 24)"

cat > "$CONFIG" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no

[dn]
CN = $CN

[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

echo "==> Generating certificate"
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$KEY" -out "$CERT" -config "$CONFIG"

# OpenSSL 3 defaults to a PBE the macOS keychain cannot read and needs -legacy; LibreSSL (what
# /usr/bin/openssl actually is on stock macOS) already writes the compatible form and rejects the flag.
LEGACY=()
if openssl pkcs12 -help 2>&1 | grep -q -- '-legacy'; then LEGACY=(-legacy); fi

echo "==> Bundling into $P12"
openssl pkcs12 -export "${LEGACY[@]}" \
  -inkey "$KEY" -in "$CERT" -out "$P12" -name "$CN" -passout "pass:$PASSWORD"

echo "==> Importing into your login keychain (codesign will be allowed to use it)"
security import "$P12" -k "$HOME/Library/Keychains/login.keychain-db" \
  -P "$PASSWORD" -T /usr/bin/codesign

echo "==> Trusting it for code signing (needs sudo)"
sudo security add-trusted-cert -d -r trustRoot -p codeSign \
  -k /Library/Keychains/System.keychain "$CERT"

echo "==> Allowing codesign to use the key without prompting"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k "" "$HOME/Library/Keychains/login.keychain-db" >/dev/null 2>&1 ||
  echo "    (skipped — codesign may prompt for your keychain password on first use)"

chmod 600 "$KEY" "$CERT" "$P12"
rm -f "$CONFIG"

cat <<EOF

Done. Local builds will now sign with "$CN".

Store these two GitHub Actions secrets on clauide/clauide
(Settings -> Secrets and variables -> Actions):

  MAC_CERT_P12       $(base64 -i "$P12" | tr -d '\n' | cut -c1-24)...  (full value below)
  MAC_CERT_PASSWORD  $PASSWORD

Full MAC_CERT_P12 value:

$(base64 -i "$P12" | tr -d '\n')

Back up $P12 somewhere safe. Losing it means existing installs stop
auto-updating and users have to reinstall once via Homebrew.
EOF
