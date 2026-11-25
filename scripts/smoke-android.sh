#!/usr/bin/env bash
set -euo pipefail
apk=$(ls out/*.apk)
app=$("$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging "$apk" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
adb shell svc wifi disable
adb shell svc data disable
adb install "$apk"
adb shell am start -W -n "$app/io.github.suyh1.readbox.MainActivity"
for attempt in {1..15}; do
  if adb shell uiautomator dump /sdcard/readbox-window.xml >/dev/null &&
     adb shell cat /sdcard/readbox-window.xml | grep -q '我的书房'; then
    exit 0
  fi
  sleep 2
done
adb logcat -d -s ReadBox AndroidRuntime GeckoConsole
exit 1
