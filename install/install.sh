#!/bin/sh
set -eu

# rendered from src/install/runtime-pin.ts by scripts/render-install-scripts.mjs; edit the pin there
RUNTIME_NAME='node'
RUNTIME_VERSION='26.13.0'
RUNTIME_COMPATIBLE_MAJOR=20
select_runtime_build() {
  case "$1" in
    'win32-x64')
      RUNTIME_URL='https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip'
      RUNTIME_SHA256='dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a'
      RUNTIME_ARCHIVE='zip'
      ;;
    'linux-x64')
      RUNTIME_URL='https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.gz'
      RUNTIME_SHA256='5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455'
      RUNTIME_ARCHIVE='tar.gz'
      ;;
    'darwin-x64')
      RUNTIME_URL='https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-x64.tar.gz'
      RUNTIME_SHA256='525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e'
      RUNTIME_ARCHIVE='tar.gz'
      ;;
    'darwin-arm64')
      RUNTIME_URL='https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.gz'
      RUNTIME_SHA256='d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6'
      RUNTIME_ARCHIVE='tar.gz'
      ;;
    *) return 1 ;;
  esac
}
# end of rendered pins

# rendered from catalog.schema.json by scripts/render-install-scripts.mjs; edit the schema there
FILE_KEY_PATTERN='^[^/\\:]*[^/\\:. ](?:/[^/\\:]*[^/\\:. ])*(?![\s\S])'
VERSION_PATTERN='^(?![\s\S]*\.\.)[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]*[0-9A-Za-z-])?(\+[0-9A-Za-z.-]*[0-9A-Za-z-])?(?![\s\S])'
SHA256_PATTERN='^[0-9a-f]{64}(?![\s\S])'
# end of rendered patterns

HOST_ID='forebay-host'
INSTALL_MARKER='.installed.json'
UNPACKED_MARKER='.unpacked'

LIST_HOST_FILES='
const fail = (detail, fix) => { process.stderr.write(detail + "\nfix: " + fix + "\n"); process.exit(1); };
const [argument, keyPattern, versionPattern, sha256Pattern] = process.argv.slice(1);
const origin = /^https:\/\//.test(argument) ? argument : require("url").pathToFileURL(require("path").resolve(argument)).href;
const KEY = new RegExp(keyPattern, "u");
const VERSION = new RegExp(versionPattern, "u");
const SHA256 = new RegExp(sha256Pattern, "u");
const REQUIRED = ["host.js", "reconcile-worker.js", "host.json"];
const folded = (key) => key.normalize("NFC").toLowerCase();
let text = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let catalog;
  try { catalog = JSON.parse(text); } catch { fail("the catalog " + argument + " is not a JSON catalog index", "pass the catalog.json of a catalog, or its https url"); }
  const item = catalog && catalog.items && catalog.items["forebay-host"];
  if (!item || item.kind !== "host") fail("the catalog " + argument + " lists no forebay-host", "install from a catalog that lists the host");
  const version = item.latest;
  const files = VERSION.test(String(version)) && item.versions && item.versions[version] && item.versions[version].files;
  if (!files || Object.keys(files).length === 0) fail("the catalog lists no files for forebay-host " + version, "install from a catalog whose latest forebay-host lists its files");
  const missing = REQUIRED.filter((key) => !Object.prototype.hasOwnProperty.call(files, key));
  if (missing.length > 0) fail("the catalog lists forebay-host " + version + " without " + missing.join(", "), "install from a catalog whose forebay-host lists " + REQUIRED.join(", "));
  const base = new URL(origin);
  const directory = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
  const lines = [version];
  const seen = new Map();
  for (const [key, reference] of Object.entries(files)) {
    if (seen.has(folded(key))) fail("the catalog lists the forebay-host files " + seen.get(folded(key)) + " and " + key + ", which differ only by case and would install into one file", "install from a catalog built by forebay-host catalog build");
    seen.set(folded(key), key);
    const url = new URL(String(reference.url), origin);
    const inside = base.protocol === "https:" ? url.protocol === "https:" : url.protocol === "file:" && url.hostname === "" && url.pathname.startsWith(directory);
    if (!KEY.test(key) || !inside || !SHA256.test(String(reference.sha256)) || !Number.isInteger(reference.size)) {
      fail("the catalog lists the forebay-host file " + JSON.stringify(key) + " with a name, url, sha256 or size the installer refuses", "install from a catalog built by forebay-host catalog build");
    }
    lines.push([key, url.href, reference.sha256, reference.size].join("\t"));
  }
  process.stdout.write(lines.join("\n") + "\n");
});
'

refuse() {
  printf '%s\nfix: %s\n' "$1" "$2" >&2
  exit 1
}

progress() {
  printf '%s\n' "$1" >&2
}

require_tools() {
  command -v curl >/dev/null 2>&1 || refuse 'curl is not installed, and the installer fetches with it' 'install curl, then run this again'
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    refuse 'neither sha256sum nor shasum is installed, and the installer verifies every download with one' 'install coreutils, then run this again'
  fi
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

has_sha256() {
  [ -f "$1" ] && [ "$(file_sha256 "$1")" = "$2" ]
}

file_size() {
  wc -c < "$1" | tr -d ' '
}

is_absolute() {
  case "$1" in
    /*) return 0 ;;
    *) return 1 ;;
  esac
}

require_home() {
  is_absolute "${HOME:-}" || refuse 'HOME is absent or not an absolute path, so the cache place cannot be found' 'set HOME, or SPISOR_CACHE, to an absolute directory path'
}

resolve_platform() {
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) refuse "this installer runs on Linux and macOS, not $(uname -s)" 'on Windows, run install.ps1 in PowerShell' ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) arch=$(uname -m) ;;
  esac
  PLATFORM="$os-$arch"
}

resolve_cache() {
  if is_absolute "${SPISOR_CACHE:-}"; then
    CACHE=$SPISOR_CACHE
  elif [ "$os" = darwin ]; then
    require_home
    CACHE="$HOME/Library/Caches/spisor"
  elif is_absolute "${XDG_CACHE_HOME:-}"; then
    CACHE="$XDG_CACHE_HOME/spisor"
  else
    require_home
    CACHE="$HOME/.cache/spisor"
  fi
  CACHE=${CACHE%/}
}

check_catalog() {
  case "$CATALOG" in
    https://*) ;;
    *://*) refuse "the catalog $CATALOG is neither an https url nor a local path" 'pass the path of a catalog.json, or its https url' ;;
    *) [ -f "$CATALOG" ] || refuse "the catalog $CATALOG does not exist" 'pass the path of a catalog.json, or its https url' ;;
  esac
}

compatible_runtime() {
  command -v "$RUNTIME_NAME" >/dev/null 2>&1 || return 1
  version=$("$RUNTIME_NAME" -p 'process.versions.node' 2>/dev/null) || return 1
  major=${version%%.*}
  case "$major" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge "$RUNTIME_COMPATIBLE_MAJOR" ] || return 1
  NODE=$(command -v "$RUNTIME_NAME")
}

remove_temporary() {
  [ -z "$TEMPORARY" ] || rm -f "$TEMPORARY"
  TEMPORARY=''
}

new_temporary() {
  TEMPORARY=$(mktemp "$1.XXXXXX")
}

place_temporary() {
  mv -f "$TEMPORARY" "$1"
  TEMPORARY=''
}

download_verified() {
  new_temporary "$2"
  curl -fsSL -o "$TEMPORARY" "$1" || refuse "could not fetch $1" 'check the network connection, then run this again'
  if [ "$(file_size "$TEMPORARY")" != "$4" ] && [ "$4" != any ] || ! has_sha256 "$TEMPORARY" "$3"; then
    refuse "$1 does not have the SHA-256 $3 it is pinned to" 'run this again; if it repeats, the download is being altered on the way'
  fi
}

fetch_verified() {
  download_verified "$@"
  place_temporary "$2"
}

runtime_unpacked() {
  [ -f "$1" ] || return 1
  { read -r unpacked_archive && read -r unpacked_executable; } < "$1" || return 1
  [ "$unpacked_archive" = "$RUNTIME_SHA256" ] && has_sha256 "$NODE" "$unpacked_executable"
}

write_unpacked_marker() {
  new_temporary "$1"
  printf '%s\n%s\n' "$RUNTIME_SHA256" "$(file_sha256 "$NODE")" > "$TEMPORARY"
  place_temporary "$1"
}

remove_other_runtime_versions() {
  for version_directory in "$CACHE/runtimes/$RUNTIME_NAME"/*; do
    [ -d "$version_directory" ] || continue
    [ "${version_directory##*/}" != "$RUNTIME_VERSION" ] || continue
    rm -rf "$version_directory" 2>/dev/null || true
  done
}

unpack_runtime_executable() {
  rm -f "$2"
  rm -rf "$directory/$stem"
  progress "fetching $RUNTIME_NAME $RUNTIME_VERSION for $PLATFORM"
  download_verified "$RUNTIME_URL" "$directory/$archive_name" "$RUNTIME_SHA256" any
  tar -xzf "$TEMPORARY" -C "$directory" "$1" || refuse "the $RUNTIME_NAME archive for $PLATFORM holds no $1" 'run this again; if it repeats, report the pinned archive'
  remove_temporary
  "$NODE" -e 0 >/dev/null 2>&1 || refuse "the $RUNTIME_NAME $RUNTIME_VERSION executable for $PLATFORM does not run on this machine" "install $RUNTIME_NAME $RUNTIME_COMPATIBLE_MAJOR or newer, then run this again"
  write_unpacked_marker "$2"
}

acquire_runtime() {
  select_runtime_build "$PLATFORM" || refuse "$RUNTIME_NAME $RUNTIME_VERSION has no pinned build for $PLATFORM" "install $RUNTIME_NAME $RUNTIME_COMPATIBLE_MAJOR or newer, then run this again"
  [ "$RUNTIME_ARCHIVE" = tar.gz ] || refuse "the pinned $RUNTIME_NAME build for $PLATFORM is a $RUNTIME_ARCHIVE, which this installer cannot unpack" "install $RUNTIME_NAME $RUNTIME_COMPATIBLE_MAJOR or newer, then run this again"
  directory="$CACHE/runtimes/$RUNTIME_NAME/$RUNTIME_VERSION/$PLATFORM"
  archive_name=${RUNTIME_URL##*/}
  stem=${archive_name%.tar.gz}
  NODE="$directory/$stem/bin/node"
  mkdir -p "$directory"
  runtime_unpacked "$directory/$UNPACKED_MARKER" || unpack_runtime_executable "$stem/bin/node" "$directory/$UNPACKED_MARKER"
  remove_other_runtime_versions
}

read_catalog_index() {
  case "$CATALOG" in
    https://*) INDEX=$(curl -fsSL "$CATALOG") || refuse "could not fetch the catalog $CATALOG" 'check the network connection and the url, then run this again' ;;
    *) INDEX=$(cat < "$CATALOG") || refuse "could not read the catalog $CATALOG" 'pass the path of a readable catalog.json' ;;
  esac
}

fetch_host() {
  read_catalog_index
  listing=$(printf '%s\n' "$INDEX" | "$NODE" -e "$LIST_HOST_FILES" -- "$CATALOG" "$FILE_KEY_PATTERN" "$VERSION_PATTERN" "$SHA256_PATTERN")
  newline='
'
  tab=$(printf '\t')
  HOST_VERSION=${listing%%"$newline"*}
  files=${listing#*"$newline"}
  HOST_DIRECTORY="$CACHE/bundles/$HOST_ID/$HOST_VERSION"
  mkdir -p "$HOST_DIRECTORY"
  hashes=''
  changed=no
  while IFS="$tab" read -r key url sha256 size; do
    hashes="$hashes${hashes:+,}\"$key\":\"$sha256\""
    target="$HOST_DIRECTORY/$key"
    if has_sha256 "$target" "$sha256"; then
      continue
    fi
    progress "fetching $HOST_ID $HOST_VERSION $key"
    rm -f "$HOST_DIRECTORY/$INSTALL_MARKER"
    case "$key" in
      */*) mkdir -p "$HOST_DIRECTORY/${key%/*}" ;;
    esac
    fetch_verified "$url" "$target" "$sha256" "$size"
    changed=yes
  done <<EOF
$files
EOF
  if [ "$changed" = yes ] || [ ! -f "$HOST_DIRECTORY/$INSTALL_MARKER" ]; then
    new_temporary "$HOST_DIRECTORY/$INSTALL_MARKER"
    printf '{"files":{%s}}\n' "$hashes" > "$TEMPORARY"
    place_temporary "$HOST_DIRECTORY/$INSTALL_MARKER"
  fi
}

TEMPORARY=''
trap remove_temporary EXIT
trap 'remove_temporary; exit 130' INT
trap 'remove_temporary; exit 143' TERM

[ "$#" -ge 1 ] || refuse 'no catalog was given, and none is published yet' 'pass the catalog to install from: sh install.sh <path or https url of catalog.json>'
CATALOG=$1
shift
check_catalog
require_tools
resolve_platform
resolve_cache
compatible_runtime || acquire_runtime
fetch_host
exec "$NODE" "$HOST_DIRECTORY/host.js" install "--catalog=$CATALOG" "$@"
