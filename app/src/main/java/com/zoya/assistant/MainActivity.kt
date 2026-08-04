package com.zoya.assistant

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var toolExecutionEngine: ToolExecutionEngine
    private val TAG = "MainActivity"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate()
        
        toolExecutionEngine = ToolExecutionEngine(this)
        webView = WebView(this)
        setContentView(webView)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "[NativeBridge] WebView page finished loading: $url")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                Log.d(TAG, "[NativeBridge] Granting WebView permissions: ${request?.resources?.joinToString()}")
                request?.grant(request.resources)
            }
        }

        val bridge = WebAppInterface(toolExecutionEngine)
        webView.addJavascriptInterface(bridge, "ToolExecutionEngine")
        webView.addJavascriptInterface(bridge, "ZoyaNative")

        val appUrl = "https://ais-dev-6rhpk72w25flug33hwwvnl-684919112679.asia-southeast1.run.app"
        Log.d(TAG, "[NativeBridge] Loading app URL in Android WebView: $appUrl")
        webView.loadUrl(appUrl)
    }

    class WebAppInterface(private val engine: ToolExecutionEngine) {
        @JavascriptInterface
        fun executeTool(name: String, jsonArgs: String): String {
            Log.d("NativeBridge", "[ToolExecutionEngine] executeTool invoked from JS: name='$name', args='$jsonArgs'")
            val argsMap = parseJsonToMap(jsonArgs)
            val result = engine.executeTool(name, argsMap)
            Log.d("NativeBridge", "[ToolExecutionEngine] executeTool result: '$result'")
            return result
        }

        private fun parseJsonToMap(jsonStr: String): Map<String, Any> {
            val map = mutableMapOf<String, Any>()
            if (jsonStr.isBlank()) return map
            try {
                val jsonObject = JSONObject(jsonStr)
                val keys = jsonObject.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    map[key] = jsonObject.get(key)
                }
            } catch (e: Exception) {
                Log.e("NativeBridge", "Error parsing jsonArgs: $jsonStr", e)
            }
            return map
        }
    }
}
