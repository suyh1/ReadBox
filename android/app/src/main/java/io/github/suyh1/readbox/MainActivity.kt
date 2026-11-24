package io.github.suyh1.readbox

import android.app.Activity
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
        view.releaseSession()
        session.close()
        super.onDestroy()
    }
}
