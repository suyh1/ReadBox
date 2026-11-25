package io.github.suyh1.readbox

import android.app.Activity
import android.content.Intent
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
import android.view.WindowInsets
import android.widget.FrameLayout
import android.widget.TextView
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

class MainActivity : Activity() {
    private lateinit var view: GeckoView
    private val session = GeckoSession()

    private var canGoBack = false
    private var pendingFile: Pair<FilePrompt, GeckoResult<PromptResponse>>? = null
    private val importDir by lazy { File(cacheDir, "imports/" + UUID.randomUUID()) }
    private val backCallback by lazy { OnBackInvokedCallback { session.goBack() } }

    private fun setupNavigation() {
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
                if (this@MainActivity.canGoBack == canGoBack) return
                this@MainActivity.canGoBack = canGoBack
                if (Build.VERSION.SDK_INT >= 33) {
                    if (canGoBack) onBackInvokedDispatcher.registerOnBackInvokedCallback(
                        OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback)
                    else onBackInvokedDispatcher.unregisterOnBackInvokedCallback(backCallback)
                }
            }
        }
    }

    @Deprecated("Used on Android 8–12")
    override fun onBackPressed() {
        if (canGoBack) session.goBack() else super.onBackPressed()
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
                if (isDestroyed || prompt.isComplete) return@runOnUiThread
                pendingFile = null
                copies.onSuccess { result.complete(prompt.confirm(applicationContext, it)) }
                    .onFailure {
                        result.complete(prompt.dismiss())
                        Toast.makeText(this, "无法读取所选文件，请检查存储空间后重试", Toast.LENGTH_LONG).show()
                    }
            }
        }.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runtime = GeckoRuntime.getDefault(applicationContext)
        view = GeckoView(this)
        val container = FrameLayout(this)
        container.addView(view)
        if (android.os.Build.VERSION.SDK_INT >= 35) {
            container.setOnApplyWindowInsetsListener { frame, insets ->
                val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                frame.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                insets
            }
        }
        setContentView(container)
        setupNavigation()
        setupFilePicker()
        session.open(runtime)
        view.setSession(session)
        runtime.webExtensionController.ensureBuiltIn("resource://android/assets/ui/", "ui@readbox.local")
            .accept({ extension ->
                if (!isDestroyed && extension != null) session.loadUri(extension.metaData.baseUrl + "index.html")
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
