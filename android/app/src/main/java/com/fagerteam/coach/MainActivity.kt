package com.fagerteam.coach

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ClipData
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import kotlin.math.roundToLong

/**
 * A full-screen WebView around the coach artifact, plus one bridge: the page asks for daily totals
 * from Health Connect and saves them to its own db. The app keeps nothing but whose phone this is.
 *
 * Bridge (shared with the iPhone app, see android/README.md): the page posts
 * {type: "health.read", id, dates, ask?} to window.FagerHealth and gets back
 * {type: "health.data", id, owner, days: [{date, steps?, activeKcal?, exerciseMin?}]} or
 * {type: "health.error", id, owner, error, message?}. The app also posts {type: "health.wake"}
 * when it comes back to the front, so the page syncs again.
 */
class MainActivity : ComponentActivity() {
    companion object {
        private const val TAG = "FagerCoach"
        private const val ACTION_CHOOSE_OWNER = "com.fagerteam.coach.CHOOSE_OWNER"
        private val OWNERS = listOf("leah" to "Leah", "eve" to "Eve")
    }

    private lateinit var web: WebView
    private val health by lazy { HealthReader(this) }
    private val prefs by lazy { getSharedPreferences("coach", MODE_PRIVATE) }
    private var owner: String?
        get() = prefs.getString("owner", null)
        set(v) { prefs.edit().putString("owner", v).apply() }

    // The artifact frame's reply channel, kept so the app can tell the page it came back to the front.
    private var page: JavaScriptReplyProxy? = null
    private val healthLock = Mutex()
    private var resumedOnce = false

    private var permissionWait: CompletableDeferred<Set<String>>? = null
    private val permissionLauncher =
        registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
            permissionWait?.complete(granted)
        }

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraFile: File? = null
    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val picked = WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data)
        val shot = cameraFile?.takeIf { res.resultCode == RESULT_OK && it.length() > 0 }
            ?.let { arrayOf(FileProvider.getUriForFile(this, "$packageName.files", it)) }
        cb.onReceiveValue(picked ?: shot)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        web = WebView(this)
        setContentView(web)
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(false)
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true) // the artifact runs in a frame on another origin
        }
        web.webViewClient = object : WebViewClient() {
            // The app only shows claude.ai. Anything else (links in a coach message, Google sign-in) opens
            // in the phone's browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || isClaude(request.url)) return false
                openOutside(request.url)
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileLauncher.launch(fileChooser(params))
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // "*" because the artifact runs in a sandboxed frame whose origin isn't claude.ai. The listener
            // only answers while the top page is claude.ai, and only with steps, active calories and exercise.
            WebViewCompat.addWebMessageListener(web, "FagerHealth", setOf("*")) { view, message, origin, _, reply ->
                if (!isClaude(Uri.parse(view.url ?: ""))) return@addWebMessageListener
                val req = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                if (req.optString("type") != "health.read") return@addWebMessageListener
                Log.i(TAG, "health.read from $origin")
                page = reply
                lifecycleScope.launch { reply.postMessage(healthRead(req).toString()) }
            }
        } else {
            Log.w(TAG, "This WebView has no web message listener; Health Connect sync is off. Update Android System WebView.")
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(BuildConfig.COACH_URL)
        if (owner == null || intent?.action == ACTION_CHOOSE_OWNER) chooseOwner()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CHOOSE_OWNER) chooseOwner()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        if (resumedOnce) wake() else resumedOnce = true
    }

    override fun onPause() {
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    private fun wake() {
        runCatching { page?.postMessage(JSONObject().put("type", "health.wake").toString()) }
    }

    private fun isClaude(uri: Uri): Boolean {
        val host = uri.host ?: return false
        return uri.scheme == "https" && (host == "claude.ai" || host.endsWith(".claude.ai"))
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No app for $uri")
        }
    }

    private fun chooseOwner() {
        val current = OWNERS.indexOfFirst { it.first == owner }
        AlertDialog.Builder(this)
            .setTitle(R.string.owner_title)
            .setSingleChoiceItems(OWNERS.map { it.second }.toTypedArray(), current) { dialog, which ->
                owner = OWNERS[which].first
                dialog.dismiss()
                wake()
            }
            .setCancelable(owner != null)
            .show()
    }

    /** The phone's picker for photos, with the camera offered too when the page asks for an image. */
    private fun fileChooser(params: WebChromeClient.FileChooserParams): Intent {
        cameraFile = null
        val pick = params.createIntent()
        val wantsImage = params.acceptTypes.any { it.isBlank() || it.startsWith("image/") }
        if (!wantsImage) return pick
        val file = File(cacheDir, "camera").apply { mkdirs() }.let { File(it, "photo.jpg") }.apply { delete() }
        cameraFile = file
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply { clipData = ClipData.newRawUri("", uri) } // carries the grant through the chooser
        if (params.isCaptureEnabled) return camera
        return Intent.createChooser(pick, null).putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
    }

    private suspend fun healthRead(req: JSONObject): JSONObject = healthLock.withLock {
        val out = JSONObject().put("id", req.opt("id")).put("owner", owner ?: JSONObject.NULL)
        fun error(code: String, message: String? = null) =
            out.put("type", "health.error").put("error", code).apply { if (message != null) put("message", message) }

        if (owner == null) return error("failed", "Pick whose phone this is first.")
        // An explicit Sync now may open the Play Store or the permission screen; automatic syncs ask only once.
        val ask = req.optBoolean("ask") || !prefs.getBoolean("asked", false)
        when (health.sdkStatus()) {
            HealthConnectClient.SDK_AVAILABLE -> Unit
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                if (ask) openOutside(Uri.parse("market://details?id=${HealthReader.PROVIDER}&url=healthconnect%3A%2F%2Fonboarding"))
                return error("unavailable", "Health Connect needs to be installed or updated.")
            }
            else -> return error("unavailable", "Health Connect isn't available on this phone.")
        }
        if (!health.granted().containsAll(HealthReader.PERMISSIONS)) {
            if (!ask) return error("permission")
            prefs.edit().putBoolean("asked", true).apply()
            val wait = CompletableDeferred<Set<String>>()
            permissionWait = wait
            permissionLauncher.launch(HealthReader.PERMISSIONS)
            if (!wait.await().containsAll(HealthReader.PERMISSIONS)) return error("permission")
        }

        val dates = req.optJSONArray("dates") ?: JSONArray()
        val wanted = (0 until dates.length()).mapNotNull { runCatching { LocalDate.parse(dates.getString(it)) }.getOrNull() }
        return try {
            val days = JSONArray()
            for (d in health.read(wanted)) {
                days.put(JSONObject().put("date", d.date.toString()).apply {
                    d.steps?.let { put("steps", it) }
                    d.activeKcal?.let { put("activeKcal", it.roundToLong()) }
                    d.exerciseMin?.let { put("exerciseMin", it) }
                })
            }
            out.put("type", "health.data").put("days", days)
        } catch (e: SecurityException) {
            error("permission")
        } catch (e: Exception) {
            Log.w(TAG, "Health Connect read failed", e)
            error("failed", e.message ?: e.javaClass.simpleName)
        }
    }
}
