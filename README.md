# ReadBox

ReadBox 是面向中文 EPUB 的离线阅读器。打开「我的书房」可以导入自己的无 DRM EPUB，也可以点「开始阅读」体验内置短篇集《书页之间》。导入单本后直接打开。配置 WebDAV 后，书房中的「接着读」会打开云端保存的阅读位置。

- **书架**支持批量导入、按文件内容去重、书名及作者搜索、收藏和排序。原书、阅读位置和书摘保存在本机。
- **阅读**支持 EPUB 2 / 3 目录、分页、章节内滚动、专注阅读、主题、字号、字体、行距和版心宽度。桌面可在「阅读设置 → 阅读方式」选择双栏分页，窗口宽度达到 800 像素时并排显示相邻两页，缩窄时自动切回单栏。可点击翻页箭头，或按方向键、Page Up / Page Down 翻页。专注模式也保留箭头，手机分页时还可滑动或轻点两侧。阅读页顶部的时钟显示本次阅读时长和本机的本书累计时长，窗口隐藏或离开阅读页时暂停。
- **查阅**支持全书搜索、结果跳转、返回跳转前的位置，以及 EPUB 3 和常见多看脚注的原地展开。
- **书摘**支持书签、选文划线、笔记编辑和回到原文。桌面可导出 Markdown 文件，Android 可复制 Markdown。设备提供本地系统语音时可从当前位置朗读本章。

交互取舍、样书覆盖和仍需实机验收的项目见[阅读模块与竞品调研](src/reader/README.md)。

## WebDAV 进度同步

在书房右上角打开「进度同步」，或在书内打开「阅读设置 → WebDAV 进度同步」。坚果云用户可填写 `https://dav.jianguoyun.com/dav/`、账户邮箱和在坚果云安全设置中创建的第三方应用密码，再保存设置。两端应使用同一目录，并分别导入同一份 EPUB。修改文件名不影响识别。

每次开书都会读取云端位置。未配置、云端没有记录或读取失败时从书首打开。自动模式会合并连续翻页，手动模式可点「立即同步」上传积累的变更。每本书的进度单独保存在目录下的 `ReadBox/` 中，上传中断会保留待同步记录。两端都有变更时按记录的更新时间选择位置。原书、书摘和阅读时长留在本机。

## 平台基线

| 目标 | 宿主和产物 | 首次验收 |
| --- | --- | --- |
| Windows x64 | Electron 45.0.0、可选择安装目录的 NSIS 离线 EXE | 安装、普通用户冷启动、卸载 |
| Linux amd64 | 同版 Electron、gzip DEB | 桌面安装、菜单启动、显示设置持久化 |
| Linux arm64 | 同版 Electron、gzip DEB；参考银河麒麟桌面 V10 SP1 | 干净目标系统断网安装、X11 或 XWayland 启动、滚动流畅度 |
| Android | Kotlin、GeckoView、按处理器架构发布签名 APK；最低 Android 8.0 | 小米真机断网冷启动、系统栏、返回手势与同签名覆盖升级 |

安装包自带渲染引擎和前端资源。用户在支持的桌面系统上安装 ReadBox 即可使用。Linux 使用系统已有的 glibc、GTK 3、NSS 等桌面基础库。ARM64 的打包流程扫描随包 ELF 符号需求，基线上限为 glibc 2.31。麒麟兼容状态需通过 ReadBox 自身在目标系统的验收确认。[DevKit 2.7.2 麒麟基线](https://github.com/suyh1/DevKit/tree/2.7.2)

## 界面与绘制

四端共用 Vue 3、TypeScript 和 CSS 界面。书房默认使用雾灰、纸白和墨蓝，窄屏下续读和导入卡片上下排列。阅读工具栏悬浮在正文下方。打开目录后，点击卷名可折叠或展开章节；带正文链接的卷可用右侧书本按钮跳转。界面支持深浅色、键盘操作和系统的减少动效设置。

桌面默认单按 `F8` 隐藏窗口，再按一次恢复。在「显示设置 → 老板键」点击输入框即可改键。支持单独使用功能键、字母、数字或空格，也可以搭配修饰键。

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

Android 使用 JDK 17、Android SDK Platform 37.1 和 Build Tools 36.0.0。设置 `ANDROID_HOME` 或在 `android/local.properties` 指定 SDK 路径，构建共享界面后运行：

```sh
./android/gradlew -p android :app:assembleDebug
```

Windows 可用 `android\gradlew.bat -p android :app:assembleDebug`。SDK、Gradle 和 Mozilla Maven 依赖在构建机下载。APK 内的 GeckoView 加载随包的本地页面。构建产物位于 `android/app/build/outputs/apk/debug/`。每个 APK 只包含一种架构的 GeckoView 原生库，安装时由系统解压，安装后的占用会高于下载大小。调试包使用独立应用 ID，可与正式版共存。

## 选择 Android 安装包

大多数近年的小米及其他 Android 手机下载文件名以 `-android-arm64-v8a.apk` 结尾的版本。32 位 ARM 设备选 `armeabi-v7a`，Intel/AMD 的 64 位 Android 设备或 x86_64 模拟器选 `x86_64`。每台设备只安装一个 APK。通过 ADB 连接时可运行 `adb shell getprop ro.product.cpu.abi` 查看设备首选架构。

## 发布

GitHub Actions 对 main 分支推送与 PR 执行构建，验证 Windows 安装和 Linux 两种架构的启动，检查 APK 签名并在断网模拟器上打开本地界面。发布标签形如 `v0.1.0`。标签必须与 `package.json` 中的版本一致，Gradle 从同一文件生成 Android 版本号。每个版本的中文条目来自 `notes/<版本>/*.json`，支持「新增」「改进」「修复」「兼容性」。本地运行 `npm run notes` 预览。

正式发布前，仓库维护者将固定 Android 签名资料放入 Actions Secrets。覆盖升级需要沿用同一密钥和应用 ID。

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 编码的正式 keystore |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 口令 |
| `ANDROID_KEY_ALIAS` | 签名密钥别名 |
| `ANDROID_KEY_PASSWORD` | 签名密钥口令 |

版本标签触发签名构建，三个桌面安装包和三个 Android APK 校验通过后上传到同一份 GitHub Release，再公开中文更新说明和 `SHA256SUMS`。普通分支及 PR 使用调试签名，仅上传 Actions 构建产物。
