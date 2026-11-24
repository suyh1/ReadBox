# ReadBox

ReadBox 是面向中文 EPUB 的离线阅读器项目。目标是兼容针对多看制作的 EPUB 排版与交互。当前阶段交付可启动的宿主、桌面显示设置和安装包构建流程。阅读模块的范围和验收方法见[阅读与多看适配约定](src/reader/README.md)。

## 平台基线

| 目标 | 宿主和产物 | 首次验收 |
| --- | --- | --- |
| Windows x64 | Electron 45.0.0、NSIS 离线 EXE | 安装、普通用户冷启动、卸载 |
| Linux amd64 | 同版 Electron、gzip DEB | 桌面安装、菜单启动、显示设置持久化 |
| Linux arm64 | 同版 Electron、gzip DEB；参考银河麒麟桌面 V10 SP1 | 干净目标系统断网安装、X11 或 XWayland 启动、滚动流畅度 |
| Android | Kotlin、GeckoView、单个签名 APK；最低 Android 8.0 | 小米真机断网冷启动、系统栏、返回手势与同签名覆盖升级 |

安装包自带渲染引擎和前端资源。用户在支持的桌面系统上安装 ReadBox 即可使用。Linux 使用系统已有的 glibc、GTK 3、NSS 等桌面基础库。ARM64 的打包流程扫描随包 ELF 符号需求，基线上限为 glibc 2.31。麒麟兼容状态需通过 ReadBox 自身在目标系统的验收确认。[DevKit 2.7.2 麒麟基线](https://github.com/suyh1/DevKit/tree/2.7.2)

## 界面与绘制

四端使用同一份 Vue 3、TypeScript 和 CSS 资源。设计依据 Apple 当前的 Liquid Glass 指南。玻璃材质用于导航、工具栏和浮层，正文使用稳定底色。提供深浅色、清晰的键盘焦点、降低透明度与动效的替代效果。正式阅读界面在桌面端规划可调整窗口、侧栏、鼠标和快捷键操作，在手机端规划单栏、触控、底部操作区及安全区。[Apple 材质指南](https://developer.apple.com/design/human-interface-guidelines/materials)

桌面默认软件绘制，可在「显示设置」启用硬件加速，下次启动生效。设置页分别显示保存的选择与本次 GPU 合成状态。黑屏时可用 `readbox --disable-gpu` 启动（Windows 在安装目录运行 `readbox.exe --disable-gpu`），再关闭硬件加速。麒麟的软件绘制模式以静态半透明材质为基线。Android 采用 GeckoView 自身的渲染策略。

## 本地开发

使用 [.nvmrc](.nvmrc) 指定的 Node 24，仓库根目录运行以下命令。

```sh
npm ci
npm run build
npm run desktop
```

`npm run dev` 可单独预览共享界面，桌面设置通过 Electron 宿主提供。打包前运行 `npm run build`。Windows 构建机执行 `npm run package:desktop -- win32 x64`。Linux 构建机需 Python 3、binutils、dpkg，分别执行以下命令，产物写入 `out/`。

```sh
npm run package:desktop -- linux x64
npm run package:desktop -- linux arm64
```

Android 使用 JDK 17、Android SDK Platform 36 和 Build Tools 36.0.0。设置 `ANDROID_HOME` 或在 `android/local.properties` 指定 SDK 路径，构建共享界面后运行：

```sh
./android/gradlew -p android :app:assembleDebug
```

Windows 可用 `android\gradlew.bat -p android :app:assembleDebug`。SDK、Gradle 和 Mozilla Maven 依赖在构建机下载。APK 内的 GeckoView 加载随包的本地页面。调试包使用独立应用 ID，可与正式版共存。

## 发布

GitHub Actions 对分支推送与 PR 执行构建，验证 Windows 安装和 Linux 两种架构的启动，检查 APK 签名并在断网模拟器上打开本地界面。发布标签形如 `v0.1.0`。标签必须与 `package.json` 中的版本一致，Gradle 从同一文件生成 Android 版本号。每个版本的中文条目来自 `notes/<版本>/*.json`，支持「新增」「改进」「修复」「兼容性」。本地运行 `npm run notes` 预览。

正式发布前，仓库维护者将固定 Android 签名资料放入 Actions Secrets。覆盖升级需要沿用同一密钥和应用 ID。

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 编码的正式 keystore |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 口令 |
| `ANDROID_KEY_ALIAS` | 签名密钥别名 |
| `ANDROID_KEY_PASSWORD` | 签名密钥口令 |

版本标签触发签名构建，四种安装包及校验通过后上传到同一份 GitHub Release，再公开中文更新说明和 `SHA256SUMS`。普通分支及 PR 使用调试签名，仅上传 Actions 构建产物。
