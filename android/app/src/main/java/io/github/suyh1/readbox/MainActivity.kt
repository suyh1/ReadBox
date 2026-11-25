package io.github.suyh1.readbox

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.widget.Toast
import java.io.File
import java.util.UUID
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession.PromptDelegate.FilePrompt
import org.mozilla.geckoview.GeckoSession.PromptDelegate.PromptResponse
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.TextView
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

class MainActivity : Activity() {
    private lateinit var view: GeckoView
    private val session = GeckoSession()

    private var reading = false
    private var panelOpen = false
    private var libraryUrl: String? = null
    private var pendingFile: Pair<FilePrompt, GeckoResult<PromptResponse>>? = null
    private val importDir by lazy { File(cacheDir, "imports/" + UUID.randomUUID()) }
    private val backCallback by lazy { OnBackInvokedCallback { readerBack() } }

    @Suppress("DEPRECATION")
    private fun updateSystemBars() {
        val light = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK != Configuration.UI_MODE_NIGHT_YES
        if (Build.VERSION.SDK_INT >= 30) {
            val controller = window.insetsController ?: return
            val icons = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            controller.setSystemBarsAppearance(if (light) icons else 0, icons)
            controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            val bars = WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars()
            if (reading) controller.hide(bars) else controller.show(bars)
        } else {
            // On Android 8–10 Gecko reports cutouts, but not visible system bars,
            // to CSS. Let the system fit the shelf and extend only the reader.
            val icons = if (light) View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0
            val immersive = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            window.decorView.systemUiVisibility = if (reading) icons or immersive else icons
            if (Build.VERSION.SDK_INT >= 28) {
                val mode = if (reading) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
                if (window.attributes.layoutInDisplayCutoutMode != mode) {
                    window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = mode }
                }
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) updateSystemBars()
    }

    private fun readerBack() {
        if (panelOpen) session.goBack(false)
        else libraryUrl?.let { session.loadUri(it) }
    }

    private fun setupNavigation() {
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: List<GeckoSession.PermissionDelegate.ContentPermission>,
                hasUserGesture: Boolean
            ) {
                val inReader = libraryUrl?.let { url?.startsWith("$it?book=") } == true
                panelOpen = inReader && url?.endsWith("#tools") == true
                if (reading == inReader) return
                reading = inReader
                updateSystemBars()
                if (Build.VERSION.SDK_INT >= 33) {
                    if (reading) onBackInvokedDispatcher.registerOnBackInvokedCallback(
                        OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback)
                    else onBackInvokedDispatcher.unregisterOnBackInvokedCallback(backCallback)
                }
            }
        }
    }

    @Deprecated("Used on Android 8–12")
    override fun onBackPressed() {
        if (reading) readerBack() else super.onBackPressed()
    }

    private fun setupFilePicker() {
        session.promptDelegate = object : GeckoSession.PromptDelegate {
            override fun onFilePrompt(session: GeckoSession, prompt: FilePrompt): GeckoResult<PromptResponse> {
                if (pendingFile != null) return GeckoResult.fromValue(prompt.dismiss())
                val result = GeckoResult<PromptResponse>()
                pendingFile = Pair(prompt, result)
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/epub+zip", "application/octet-stream", "application/zip"))
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, prompt.type == FilePrompt.Type.MULTIPLE)
                }
                try {
                    startActivityForResult(intent, 1)
                } catch (error: android.content.ActivityNotFoundException) {
                    pendingFile = null
                    result.complete(prompt.dismiss())
                    Toast.makeText(this@MainActivity, "系统文件选择器不可用", Toast.LENGTH_LONG).show()
                }
                return result
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 1) return
        val (prompt, result) = pendingFile ?: return
        val clips = data?.clipData
        val uris = if (clips != null) (0 until clips.itemCount).map { clips.getItemAt(it).uri }
            else listOfNotNull(data?.data)
        if (resultCode != RESULT_OK || uris.isEmpty()) {
            pendingFile = null
            if (!prompt.isComplete) result.complete(prompt.dismiss())
            return
        }
        // Document providers may only expose streams. Gecko expects readable local paths.
        Thread {
            val copies = runCatching {
                uris.map { uri ->
                    require(uri.scheme == "content")
                    val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    }
                    val dir = File(importDir, UUID.randomUUID().toString())
                    check(dir.mkdirs())
                    val safeName = name?.substringAfterLast('/')?.takeIf { it.isNotBlank() && it != "." && it != ".." } ?: "book.epub"
                    val file = File(dir, safeName)
                    requireNotNull(contentResolver.openInputStream(uri)).use { input ->
                        file.outputStream().use { output -> input.copyTo(output) }
                    }
                    Uri.fromFile(file)
                }.toTypedArray()
            }
            runOnUiThread {
                pendingFile = null
                if (isDestroyed || prompt.isComplete) return@runOnUiThread
                copies.onSuccess { result.complete(prompt.confirm(applicationContext, it)) }
                    .onFailure {
                        result.complete(prompt.dismiss())
                        Toast.makeText(this, "无法读取所选文件，请检查存储空间后重试", Toast.LENGTH_LONG).show()
                    }
            }
        }.start()
    }

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runtime = GeckoRuntime.getDefault(applicationContext)
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            runtime.settings.setConsoleOutputEnabled(true)
        }
        view = GeckoView(this)
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
        }
        // GeckoView supplies CSS safe-area-inset-* from the root window.
        // Its surface must cover that window so insets are applied exactly once.
        view.coverUntilFirstPaint(getColor(R.color.library_surface))
        setContentView(view)
        updateSystemBars()
        setupNavigation()
        setupFilePicker()
        session.open(runtime)
        view.setSession(session)
        runtime.webExtensionController.ensureBuiltIn("resource://android/assets/ui/", "ui@readbox.local")
            .accept({ extension ->
                if (!isDestroyed && extension != null) {
                    val url = extension.metaData.baseUrl + "index.html"
                    libraryUrl = url
                    session.loadUri(url)
                }
            }, { error ->
                android.util.Log.e("ReadBox", "本地界面加载失败", error)
                if (!isDestroyed) setContentView(TextView(this).apply { text = "本地界面加载失败" })
            })
    }

    override fun onDestroy() {
        pendingFile?.let { (prompt, result) -> if (!prompt.isComplete) result.complete(prompt.dismiss()) }
        pendingFile = null
        view.releaseSession()
        session.close()
        importDir.deleteRecursively()
        super.onDestroy()
    }
}
