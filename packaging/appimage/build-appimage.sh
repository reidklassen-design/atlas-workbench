#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPDIR="$ROOT/dist-appimage/AtlasWorkbench.AppDir"

npm run build
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/atlas-workbench"
cp -R "$ROOT/dist" "$APPDIR/usr/share/atlas-workbench/dist"
cp "$ROOT/packaging/atlas-workbench.desktop" "$APPDIR/usr/share/applications/atlas-workbench.desktop"

cat > "$APPDIR/usr/bin/atlas-workbench" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../share/atlas-workbench/dist" && pwd)"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "file://$APP_DIR/index.html"
else
  printf 'Atlas Workbench built assets are available at %s\n' "$APP_DIR"
fi
SCRIPT
chmod +x "$APPDIR/usr/bin/atlas-workbench"

echo "AppDir prepared at $APPDIR"
echo "Run linuxdeploy or appimagetool against this AppDir to produce Atlas_Workbench-x86_64.AppImage."
