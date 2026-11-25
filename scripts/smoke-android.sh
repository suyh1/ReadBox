#!/usr/bin/env bash
set -euo pipefail
apk=$(ls out/*.apk)
app=$("$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging "$apk" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
adb shell svc wifi disable
adb shell svc data disable
adb install "$apk"
adb shell am start -W -n "$app/io.github.suyh1.readbox.MainActivity"

# Read GeckoView's accessibility tree to locate controls across emulator sizes.
wait_control() {
  local label=$1
  local tree coords
  tree=$(mktemp)
  for attempt in {1..20}; do
    if adb shell uiautomator dump /sdcard/readbox-window.xml >/dev/null &&
       adb exec-out cat /sdcard/readbox-window.xml > "$tree" &&
       coords=$(python3 - "$tree" "$label" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

for node in ET.parse(sys.argv[1]).iter('node'):
    if sys.argv[2] not in (node.get('text'), node.get('content-desc')):
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
  cat "$tree" >&2
  rm -f "$tree"
  adb logcat -d -s ReadBox AndroidRuntime GeckoConsole >&2
  return 1
}

wait_control '我的书房'
wait_control '开始阅读' tap
wait_control '窗边的一页'
wait_control '加书签' tap
wait_control '已加书签'
adb shell input keyevent KEYCODE_BACK
wait_control '接着读' tap
wait_control '窗边的一页'
wait_control '已加书签'
