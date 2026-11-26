package studio.ergon.smerp

import android.Manifest
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.edit
import androidx.core.graphics.toColorInt
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var frame: FrameLayout
    @Volatile private var origin = ""
    private var camera: PermissionRequest? = null
    private var upload: ValueCallback<Array<Uri>>? = null
    private val preferences by lazy { getSharedPreferences("appearance", MODE_PRIVATE) }
    private val app get() = application as SmerpApplication

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        camera?.let { request ->
            if (granted && trusted(request.origin)) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            else request.deny()
        }
        camera = null
    }
    private val chooseBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        upload?.onReceiveValue(uri?.let { arrayOf(it) })
        upload = null
    }
    private val saveBackup = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) exportBackup(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        frame = FrameLayout(this)
        frame.setBackgroundColor((if (theme() == "dark") "#11111b" else "#e6e9ef").toColorInt())
        setContentView(frame)
        ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
            val space = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(space.left, space.top, space.right, space.bottom)
            insets
        }
        web = WebView(this)
        frame.addView(web, FrameLayout.LayoutParams(-1, -1))
        val loading = ProgressBar(this)
        frame.addView(loading, FrameLayout.LayoutParams(-2, -2, android.view.Gravity.CENTER))
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = true // Android's chosen backup URI.
        web.addJavascriptInterface(Appearance(), "SmerpAndroid")
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (trusted(request.url)) return false
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme in listOf("http", "https", "mailto")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    catch (_: ActivityNotFoundException) { message("No app can open this link.") }
                }
                return true
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (trusted(request.url)) return null
                return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(byteArrayOf()))
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                if (!trusted(request.origin) || !request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { request.deny(); return }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    camera?.deny()
                    camera = request
                    cameraPermission.launch(Manifest.permission.CAMERA)
                }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (camera === request) camera = null
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                upload?.onReceiveValue(null)
                upload = callback
                chooseBackup.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
                return true
            }
            override fun onJsAlert(view: WebView, url: String, text: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(text).setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
            override fun onJsConfirm(view: WebView, url: String, text: String, result: JsResult): Boolean {
                confirm(text, result)
                return true
            }
            override fun onJsBeforeUnload(view: WebView, url: String, text: String, result: JsResult): Boolean {
                confirm("Leave this page? Unsaved changes will be lost.", result)
                return true
            }
        }
        web.setDownloadListener { url, _, _, _, _ ->
            if (trusted(Uri.parse(url)) && Uri.parse(url).path == "/backup") {
                val day = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date())
                saveBackup.launch("smerp-backup-$day.json")
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("""
                    (() => {
                      const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
                      if (!dialog) return false;
                      if (dialog.dispatchEvent(new Event('cancel', {cancelable:true}))) dialog.close();
                      return true;
                    })()
                """.trimIndent()) { closed ->
                    if (closed != "true") { if (web.canGoBack()) web.goBack() else finish() }
                }
            }
        })
        app.launch.whenComplete { location, error -> runOnUiThread {
            if (isDestroyed) return@runOnUiThread
            frame.removeView(loading)
            if (error != null) {
                AlertDialog.Builder(this).setTitle("Could not start Smerp")
                    .setMessage(error.cause?.message ?: error.message).setPositiveButton("Close") { _, _ -> finish() }
                    .setOnCancelListener { finish() }.show()
            } else {
                val uri = URI(location)
                origin = "${uri.scheme}://${uri.authority}"
                web.loadUrl(location)
            }
        } }
        applyTheme(theme())
    }

    private fun trusted(uri: Uri) = origin.isNotEmpty() && uri.scheme == "http" && uri.encodedAuthority == origin.toUri().encodedAuthority

    private fun confirm(text: String, result: JsResult) {
        AlertDialog.Builder(this).setMessage(text)
            .setPositiveButton("Continue") { _, _ -> result.confirm() }
            .setNegativeButton("Cancel") { _, _ -> result.cancel() }
            .setOnCancelListener { result.cancel() }.show()
    }

    private fun exportBackup(uri: Uri) {
        app.worker.execute {
            val result = runCatching {
                val launch = URI(app.launch.get())
                val connection = launch.resolve("/backup").toURL().openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 5000
                    connection.readTimeout = 15000
                    connection.setRequestProperty("Cookie", "smerp=${launch.rawQuery.removePrefix("session=")}")
                    check(connection.responseCode == 200) { "Could not read the workshop backup." }
                    contentResolver.openOutputStream(uri, "wt").use { output ->
                        checkNotNull(output) { "Could not open the chosen file." }
                        connection.inputStream.use { it.copyTo(output) }
                    }
                } finally { connection.disconnect() }
            }
            runOnUiThread { message(result.fold({ "Backup saved." }, { "Could not save backup: ${it.message}" })) }
        }
    }

    private fun theme(): String = preferences.getString("theme", null)
        ?: if (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"

    private fun applyTheme(value: String) {
        val light = value == "light"
        val bars = if (light) SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT) else SystemBarStyle.dark(Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        frame.setBackgroundColor((if (light) "#e6e9ef" else "#11111b").toColorInt())
        WindowInsetsControllerCompat(window, frame).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    private inner class Appearance {
        @JavascriptInterface fun getTheme(): String = theme()
        @JavascriptInterface fun setTheme(value: String) {
            if (value !in listOf("light", "dark")) return
            preferences.edit(commit = true) { putString("theme", value) }
            runOnUiThread { applyTheme(value) }
        }
    }

    private fun message(text: String) { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }

    override fun onPause() {
        // The permission dialog briefly pauses the activity while scanning starts.
        if (camera == null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('pagehide'))", null)
            web.onPause()
        }
        super.onPause()
    }
    override fun onResume() { super.onResume(); if (::web.isInitialized) web.onResume() }
    override fun onDestroy() {
        camera?.deny()
        upload?.onReceiveValue(null)
        frame.removeView(web)
        web.destroy()
        super.onDestroy()
    }
}
