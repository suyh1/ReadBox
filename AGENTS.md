# 分支约定

ReadBox 的本地和远端都只保留 `main` 分支。后续修改直接在 `main` 上开发、提交并推送到 `origin/main`。

# Android 发布约定

每次发布都按处理器架构分别提供三个签名 APK：`arm64-v8a`、`armeabi-v7a` 和 `x86_64`。每个 APK 只包含对应架构的原生库，并在打包时压缩原生库。三个 APK 均作为独立文件上传到同一版本的 GitHub Release，文件名沿用 `ReadBox-<版本>-android-<架构>.apk`。
