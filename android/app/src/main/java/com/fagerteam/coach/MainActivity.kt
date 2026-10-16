package com.fagerteam.coach

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ClipData
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.Lifecycle
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
 * {type: "health.data", id, owner, today, days: [{date, steps?, activeKcal?, exerciseMin?}]} or
 * {type: "health.error", id, owner, error, message?}. The app also posts {type: "health.wake"}
 * when it comes back to the front or its owner changes, so the page syncs again.
 */
class MainActivity : ComponentActivity() {
    companion object {
        private const val TAG = "FagerCoach"
        private const val ACTION_CHOOSE_OWNER = "com.fagerteam.coach.CHOOSE_OWNER"
        private val OWNERS = listOf("leah" to "Leah", "eve" to "Eve")
        // Only the artifact's own frame may use the bridge. claude.ai serves each artifact from a frame on
        // https://<id>.frame.claudeusercontent.com, inside the artifact page on claude.ai.
        private val FRAME_ORIGINS = setOf("https://*.frame.claudeusercontent.com")
        // After two denials Android stops showing the Health Connect permission screen and answers at once.
        // A screen the person actually saw takes far longer than this to answer; backing out of it doesn't
        // count as blocked.
        private const val BLOCKED_ANSWER_MS = 500L
        // Renderer crashes kept across recreate(), so a page that keeps crashing doesn't loop forever.
        private val crashes = ArrayDeque<Long>()
    }

    private lateinit var web: WebView
    private val health by lazy { HealthReader(this) }
    private val prefs by lazy { getSharedPreferences("coach", MODE_PRIVATE) }
    private var owner: String?
        get() = prefs.getString("owner", null)
        set(v) { prefs.edit { putString("owner", v) } }

    // The artifact frame's reply channel, kept so the app can tell the page it came back to the front.
    private var page: JavaScriptReplyProxy? = null
    private val healthLock = Mutex()
    private var resumedOnce = false
    private var webGone = false

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
        web.webViewClient = CoachClient()
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
            // The listener answers only the artifact frame (never the top page), and only while the top page
            // is the coach artifact itself, not another claude.ai artifact.
            WebViewCompat.addWebMessageListener(web, "FagerHealth", FRAME_ORIGINS) { view, message, origin, isMainFrame, reply ->
                if (isMainFrame || !isCoach((view.url ?: "").toUri())) return@addWebMessageListener
                val req = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                if (req.optString("type") != "health.read") return@addWebMessageListener
                Log.i(TAG, "health.read from $origin")
                page = reply
                lifecycleScope.launch { reply.postMessage(healthRead(req).toString()) }
            }
        } else if (!prefs.getBoolean("warnedWebView", false)) {
            prefs.edit { putBoolean("warnedWebView", true) }
            AlertDialog.Builder(this)
                .setTitle(R.string.webview_old_title)
                .setMessage(R.string.webview_old_message)
                .setPositiveButton(android.R.string.ok, null)
                .show()
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

    // After a renderer crash the WebView is destroyed until recreate() builds a new one.
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (!webGone) web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (webGone) return
        web.onResume()
        if (resumedOnce) wake() else resumedOnce = true
    }

    override fun onPause() {
        if (!webGone) web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    /** Keeps the app on claude.ai and survives a WebView renderer crash. */
    // onRenderProcessGone is implemented below; the androidx.webkit check also flags the
    // WebViewClient() superclass call of any subclass, so it can't be satisfied otherwise.
    @SuppressLint("MissingOnRenderProcessGone")
    private inner class CoachClient : WebViewClient() {
        // The app only shows claude.ai. Anything else (links in a coach message, Google sign-in) opens
        // in the phone's browser.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame || isClaude(request.url)) return false
            openOutside(request.url)
            return true
        }

        // The WebView's renderer crashed or was killed for memory. The view can't be used again, so
        // drop it and rebuild the screen (the page reloads; the claude.ai sign-in is in cookies).
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w(TAG, "WebView renderer gone (crashed: ${detail.didCrash()})")
            webGone = true
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            page = null
            val now = System.currentTimeMillis()
            crashes.addLast(now)
            while (crashes.first() < now - 60_000) crashes.removeFirst()
            if (crashes.size > 3) {
                // Crashing over and over: stop rather than loop. Opening the app again starts fresh.
                Toast.makeText(this@MainActivity, R.string.webview_crashed, Toast.LENGTH_LONG).show()
                finish()
            } else {
                recreate()
            }
            return true
        }
    }

    private fun wake() {
        if (webGone || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        runCatching { page?.postMessage(JSONObject().put("type", "health.wake").toString()) }
    }

    private fun isClaude(uri: Uri): Boolean {
        val host = uri.host ?: return false
        return uri.scheme == "https" && (host == "claude.ai" || host.endsWith(".claude.ai"))
    }

    /** The coach artifact page itself (BuildConfig.COACH_URL), on claude.ai. */
    private fun isCoach(uri: Uri): Boolean =
        isClaude(uri) && uri.path?.trimEnd('/') == BuildConfig.COACH_URL.toUri().path?.trimEnd('/')

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No app for $uri")
        }
    }

    // "Whose phone is this?": the explanation, then one radio button per person (a plain choice list
    // can't show a message too).
    private fun chooseOwner() {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val group = RadioGroup(this)
        OWNERS.forEachIndexed { i, (id, name) ->
            group.addView(RadioButton(this).apply { this.id = i + 1; text = name; isChecked = id == owner })
        }
        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, 0)
            addView(TextView(this@MainActivity).apply { setText(R.string.owner_message) })
            addView(group)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.owner_title)
            .setView(view)
            .setCancelable(owner != null)
            .show()
        group.setOnCheckedChangeListener { _, checked ->
            owner = OWNERS[checked - 1].first
            dialog.dismiss()
            wake()
        }
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

        // Only read while the app is on screen; the page syncs again when it comes back (health.wake).
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return error("background")
        if (owner == null) return error("no_owner")
        // An explicit Sync now may open the Play Store, Health Connect or the permission screen; automatic
        // syncs ask only once.
        val ask = req.optBoolean("ask") || !prefs.getBoolean("asked", false)
        when (health.sdkStatus()) {
            HealthConnectClient.SDK_AVAILABLE -> Unit
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                if (ask) {
                    prefs.edit { putBoolean("asked", true) }
                    openOutside("market://details?id=${HealthReader.PROVIDER}&url=healthconnect%3A%2F%2Fonboarding".toUri())
                }
                return error("unavailable", "Health Connect needs to be installed or updated.")
            }
            else -> return error("unsupported", "Health Connect isn't available on this phone.")
        }
        if (!health.granted().containsAll(HealthReader.PERMISSIONS)) {
            if (prefs.getBoolean("blocked", false)) {
                // Android won't show the permission screen again; the person has to allow it in Health Connect.
                if (req.optBoolean("ask")) openHealthConnect()
                return error("permission_blocked")
            }
            if (!ask) return error("permission")
            prefs.edit { putBoolean("asked", true) }
            val wait = CompletableDeferred<Set<String>>()
            permissionWait = wait
            val started = SystemClock.elapsedRealtime()
            permissionLauncher.launch(HealthReader.PERMISSIONS)
            if (!wait.await().containsAll(HealthReader.PERMISSIONS)) {
                if (SystemClock.elapsedRealtime() - started > BLOCKED_ANSWER_MS) return error("permission")
                prefs.edit { putBoolean("blocked", true) }
                openHealthConnect()
                return error("permission_blocked")
            }
        }
        if (prefs.contains("blocked")) prefs.edit { remove("blocked") }

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
            out.put("type", "health.data").put("today", LocalDate.now().toString()).put("days", days)
        } catch (e: SecurityException) {
            error("permission")
        } catch (e: Exception) {
            Log.w(TAG, "Health Connect read failed", e)
            error("failed", e.message ?: e.javaClass.simpleName)
        }
    }

    private fun openHealthConnect() {
        try {
            startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No Health Connect settings screen")
        }
    }
}
