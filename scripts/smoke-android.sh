#!/usr/bin/env bash
set -euo pipefail
abi=$(adb shell getprop ro.product.cpu.abi | tr -d '\r')
apks=(out/*-android-"$abi".apk)
[[ ${#apks[@]} -eq 1 && -f ${apks[0]} ]] || { echo "找不到与 $abi 匹配的唯一 APK" >&2; exit 1; }
apk=${apks[0]}
aapt="$ANDROID_HOME/build-tools/36.0.0/aapt"
app=$("$aapt" dump badging "$apk" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
manifest=$("$aapt" dump xmltree "$apk" AndroidManifest.xml)
grep -Eq 'android:icon\([^)]*\)=@0x' <<< "$manifest"
grep -Eq 'android:roundIcon\([^)]*\)=@0x' <<< "$manifest"
adb shell svc wifi disable
adb shell svc data disable
adb install "$apk"
# Dismiss the emulator's one-time immersive-mode tutorial before testing touch targets.
adb shell settings put secure immersive_mode_confirmations confirmed
adb shell am start -W -n "$app/io.github.suyh1.readbox.MainActivity"

# Read GeckoView's accessibility tree to locate controls across emulator sizes.
wait_control() {
  local label=$1
  echo "等待界面元素 $label"
  local tree coords x y
  tree=$(mktemp)
  for attempt in {1..20}; do
    if adb shell uiautomator dump /sdcard/readbox-window.xml >/dev/null &&
       adb exec-out cat /sdcard/readbox-window.xml > "$tree" &&
       coords=$(python3 - "$tree" "$label" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

for node in ET.parse(sys.argv[1]).iter('node'):
    if not any(sys.argv[2] in node.get(attr, '') for attr in ('text', 'content-desc')):
        continue
    left, top, right, bottom = map(int, re.findall(r'-?\d+', node.get('bounds', '')))
    if right > left and bottom > top:
        print((left + right) // 2, (top + bottom) // 2)
        break
else:
    sys.exit(1)
PY
       ); then
      rm -f "$tree"
      if [[ ${2:-} == tap ]]; then
        read -r x y <<< "$coords"
        adb shell input tap "$x" "$y"
      fi
      return 0
    fi
    sleep 1
  done
  adb exec-out screencap -p > out/android-reader-failure.png
  echo "READBOX_SCREEN $(base64 -w0 out/android-reader-failure.png)"
  cat "$tree" >&2
  rm -f "$tree"
  adb logcat -d -s ReadBox AndroidRuntime GeckoConsole >&2
  return 1
}

check_edge_to_edge() {
  # The full-screen emulator's surface must cover the display in its current orientation.
  # A padded parent leaves a native strip even when the HTML fills its viewport.
  if (( $(adb shell getprop ro.build.version.sdk | tr -d '\r') >= 30 )); then
    local screen
    screen=$(adb exec-out screencap -p | python3 -c '
import struct, sys
w, h = struct.unpack(">II", sys.stdin.buffer.read()[16:24])
print(f"0,0-{w},{h}")')
    adb shell dumpsys activity top | python3 -c '
import re, sys
tree = sys.stdin.read()
match = re.search(r"\bGeckoView\{[^\n]*? (\d+,\d+-\d+,\d+)[ }]", tree)
if not match or match[1] != sys.argv[1]:
    sys.exit(f"GeckoView bounds {match and match[1]}, expected {sys.argv[1]}")
print("Edge-to-edge GeckoView:", match[1])' "$screen"
  fi
}

wait_control '我的书房'
check_edge_to_edge
wait_control '开始阅读' tap
wait_control '窗边的一页'
check_edge_to_edge
# Gecko can report the chapter as the entire accessibility root. Tap the actual
# bookmark button in the bottom toolbar and verify its persisted result on the shelf.
coords=$(adb exec-out cat /sdcard/readbox-window.xml | python3 -c '
import re, sys
import xml.etree.ElementTree as ET
nodes = list(ET.parse(sys.stdin).iter("node"))
def bounds(node):
    return list(map(int, re.findall(r"-?\d+", node.get("bounds"))))
button = next((n for n in nodes if n.get("text") == "加书签"), None)
if button is not None:
    x1, y1, x2, y2 = bounds(button)
    print((x1+x2)//2, (y1+y2)//2)
else:
    chapter = next(n for n in nodes if n.get("class") == "android.webkit.WebView")
    x1, _, x2, bottom = bounds(chapter)
    nav = next((n for n in nodes if n.get("resource-id") == "android:id/navigationBarBackground"), None)
    safe_bottom = bounds(nav)[1] if nav is not None else bounds(nodes[0])[3]
    print(x1 + (x2-x1)*9//10, bottom + (safe_bottom-bottom)*4//5)
')
read -r x y <<< "$coords"
echo "点击书签工具 ($x, $y)"
adb shell input tap "$x" "$y"
# Wait for the touch handler and the IndexedDB transaction before issuing Back.
adb shell uiautomator dump /sdcard/readbox-window.xml >/dev/null
adb shell input keyevent KEYCODE_BACK
wait_control '我的书房'
wait_control '1 条书摘'
adb shell am force-stop "$app"
adb shell am start -W -n "$app/io.github.suyh1.readbox.MainActivity"
wait_control '1 条书摘'
wait_control '接着读' tap
wait_control '清晨，光从窗框的左侧落下来'
