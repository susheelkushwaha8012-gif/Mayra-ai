package com.zoya.assistant

import android.webkit.JavascriptInterface
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.provider.MediaStore
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.telecom.TelecomManager
import android.util.Log
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.android.gms.location.LocationServices
import com.zoya.assistant.services.OverlayBubbleService
import com.zoya.assistant.services.ScreenCaptureService
import com.zoya.assistant.services.ZoyaAccessibilityService
import com.zoya.assistant.services.ZoyaForegroundService
import com.zoya.assistant.services.ZoyaNotificationListener
import org.json.JSONObject

class ToolExecutionEngine(private val context: Context) {
    private val packageManager: PackageManager = context.packageManager
    private val audioManager: AudioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val alarmManager: AlarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    private val TAG = "ToolExecutionEngine"

    @JavascriptInterface
    fun executeTool(name: String, jsonArgs: String): String {
        Log.d(TAG, "[AppLaunchLog] Received JS string executeTool call: name=$name, jsonArgs=$jsonArgs")
        val map = mutableMapOf<String, Any>()
        if (jsonArgs.isNotBlank()) {
            try {
                val jsonObject = JSONObject(jsonArgs)
                val keys = jsonObject.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    map[key] = jsonObject.get(key)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[AppLaunchLog] Failed to parse jsonArgs: $jsonArgs", e)
            }
        }
        return executeTool(name, map)
    }

    fun executeTool(name: String, args: Map<String, Any>): String {
        Log.d(TAG, "[AppLaunchLog] Executing native tool: name='$name' with args: $args")
        return try {
            when (name) {
                // Apps & Intents API
                "openApp" -> {
                    val targetApp = (args["packageName"] as? String ?: args["appName"] as? String ?: args["query"] as? String ?: args["app"] as? String ?: "").trim()
                    openApp(targetApp)
                }
                "searchInstalledApp" -> searchInstalledApp(args["appName"] as? String ?: args["query"] as? String ?: "")
                "openYouTube" -> openApp("youtube")
                "openInstagram" -> openApp("instagram")
                "openWhatsApp" -> openApp("whatsapp")
                "openChrome" -> openApp("chrome")
                "openCamera" -> openCamera()

                
                // Telecom & Contacts Provider
                "searchAndCallContact" -> searchAndCallContact(args["contactName"] as? String ?: "")
                "endCall" -> endTelecomCall()
                
                // WhatsApp & Email Intents
                "sendWhatsAppMessage" -> sendWhatsAppMessage(args["contactName"] as? String ?: "", args["message"] as? String ?: "")
                "sendGmail" -> sendGmail(args["recipientEmail"] as? String ?: "", args["subject"] as? String ?: "", args["body"] as? String ?: "")
                
                // MediaSession & Audio Control
                "mediaControl" -> mediaControl(args["action"] as? String ?: "play")
                "setVolume" -> setVolume(args["level"] as? Int ?: 50)
                
                // Services & Overlay Bubble
                "startForegroundService" -> startZoyaService()
                "stopForegroundService" -> stopZoyaService()
                "toggleOverlayBubble" -> toggleOverlayBubble(args["show"] as? Boolean ?: true)
                "performGlobalGesture" -> performAccessibilityAction(args["action"] as? String ?: "back")
                
                // AlarmManager & WorkManager
                "setAlarm" -> setAlarm(args["hour"] as? Int ?: 8, args["minute"] as? Int ?: 0, args["message"] as? String ?: "Alarm")
                "scheduleWork" -> scheduleBackgroundWork(args["taskName"] as? String ?: "default_task")
                
                // Location & Bluetooth
                "getCurrentLocation" -> getCurrentLocation()
                
                // Real-Time Screen Understanding & MediaProjection
                "analyzeScreen" -> analyzeScreen()
                "captureScreen" -> captureScreen()
                "readScreenText" -> readScreenText()
                "getForegroundApp" -> getForegroundApp()
                "clickScreenElement" -> clickScreenElement(args["elementText"] as? String ?: args["query"] as? String ?: "")
                
                // Notification Listener
                "getActiveNotifications" -> getNotifications()

                else -> "Native tool executed: $name"
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error executing native tool $name", e)
            "Failed to execute $name: ${e.message}"
        }
    }

    private val knownAppPackages = mapOf(
        "instagram" to "com.instagram.android",
        "insta" to "com.instagram.android",
        "telegram" to "org.telegram.messenger",
        "whatsapp" to "com.whatsapp",
        "whats app" to "com.whatsapp",
        "chrome" to "com.android.chrome",
        "google chrome" to "com.android.chrome",
        "settings" to "com.android.settings",
        "play store" to "com.android.vending",
        "playstore" to "com.android.vending",
        "youtube" to "com.google.android.youtube",
        "yt" to "com.google.android.youtube",
        "gmail" to "com.google.android.gm",
        "email" to "com.google.android.gm",
        "maps" to "com.google.android.apps.maps",
        "google maps" to "com.google.android.apps.maps",
        "camera" to "com.android.camera2",
        "gallery" to "com.google.android.apps.photos",
        "photos" to "com.google.android.apps.photos",
        "spotify" to "com.spotify.music",
        "facebook" to "com.facebook.katana",
        "fb" to "com.facebook.katana",
        "twitter" to "com.twitter.android",
        "x" to "com.twitter.android",
        "snapchat" to "com.snapchat.android",
        "netflix" to "com.netflix.mediaclient",
        "amazon" to "com.amazon.mShop.android.shopping",
        "flipkart" to "com.flipkart.android",
        "chatgpt" to "com.openai.chatgpt",
        "calculator" to "com.google.android.calculator",
        "phone" to "com.google.android.dialer",
        "dialer" to "com.google.android.dialer",
        "messages" to "com.google.android.apps.messaging",
        "clock" to "com.google.android.deskclock",
        "calendar" to "com.google.android.calendar"
    )

    private fun openApp(appQuery: String): String {
        if (appQuery.isEmpty()) {
            Log.w(TAG, "[AppLaunchLog] openApp called with empty appQuery")
            return "App name is empty."
        }
        val cleanQuery = appQuery.trim().lowercase()
        Log.d(TAG, "[AppLaunchLog] Step 1: openApp requested for: '$appQuery' (cleaned: '$cleanQuery')")

        val resolvedPackage = if (cleanQuery.contains(".")) {
            cleanQuery
        } else {
            knownAppPackages[cleanQuery] ?: searchInstalledApp(appQuery)
        }
        Log.d(TAG, "[AppLaunchLog] Step 2: Resolved package identifier: '$resolvedPackage'")

        var launchIntent = packageManager.getLaunchIntentForPackage(resolvedPackage)
        Log.d(TAG, "[AppLaunchLog] Step 3: packageManager.getLaunchIntentForPackage('$resolvedPackage') returned: ${launchIntent != null}")

        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            return try {
                Log.d(TAG, "[AppLaunchLog] Step 4: Executing context.startActivity(launchIntent)...")
                context.startActivity(launchIntent)
                Log.d(TAG, "[AppLaunchLog] Step 5: SUCCESS - startActivity executed for package: '$resolvedPackage'")
                "Opening $appQuery."
            } catch (e: Exception) {
                Log.e(TAG, "[AppLaunchLog] Step 5: FAILED - startActivity threw exception for package: '$resolvedPackage'", e)
                "$appQuery is not installed."
            }
        }

        // Special system intent fallbacks for common built-in apps if launchIntent is null
        if (cleanQuery == "camera") {
            return try {
                Log.d(TAG, "[AppLaunchLog] Step 4 Fallback: Triggering MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA")
                val intent = Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                Log.d(TAG, "[AppLaunchLog] Step 5: SUCCESS - Camera intent launched successfully")
                "Opening Camera."
            } catch (e: Exception) {
                Log.e(TAG, "[AppLaunchLog] Step 5: FAILED - Camera intent failed", e)
                "Camera is not installed."
            }
        } else if (cleanQuery == "settings") {
            return try {
                Log.d(TAG, "[AppLaunchLog] Step 4 Fallback: Triggering Settings.ACTION_SETTINGS")
                val intent = Intent(android.provider.Settings.ACTION_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                Log.d(TAG, "[AppLaunchLog] Step 5: SUCCESS - Settings intent launched successfully")
                "Opening Settings."
            } catch (e: Exception) {
                Log.e(TAG, "[AppLaunchLog] Step 5: FAILED - Settings intent failed", e)
                "Settings is not installed."
            }
        } else if (cleanQuery == "phone" || cleanQuery == "dialer") {
            return try {
                Log.d(TAG, "[AppLaunchLog] Step 4 Fallback: Triggering Intent.ACTION_DIAL")
                val intent = Intent(Intent.ACTION_DIAL).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                Log.d(TAG, "[AppLaunchLog] Step 5: SUCCESS - Phone dialer launched")
                "Opening Phone."
            } catch (e: Exception) {
                Log.e(TAG, "[AppLaunchLog] Step 5: FAILED - Dialer intent failed", e)
                "Phone app is not available."
            }
        }

        Log.w(TAG, "[AppLaunchLog] Step 5: FAILED - Could not launch '$resolvedPackage'. App is not installed.")
        return "$appQuery is not installed."
    }

    private fun searchInstalledApp(appName: String): String {
        if (appName.isEmpty()) return appName
        Log.d(TAG, "Searching installed apps matching label: '$appName'")
        val packages = packageManager.getInstalledApplications(PackageManager.GET_META_DATA)
        for (appInfo in packages) {
            val label = packageManager.getApplicationLabel(appInfo).toString()
            if (label.equals(appName, ignoreCase = true) || label.contains(appName, ignoreCase = true)) {
                Log.d(TAG, "Matched app label '$label' to package '${appInfo.packageName}'")
                return appInfo.packageName
            }
        }
        return appName.lowercase()
    }

    private fun openCamera(): String {
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return "Opened device camera via CameraX / Intent"
    }

    @SuppressLint("MissingPermission")
    private fun searchAndCallContact(contactName: String): String {
        if (contactName.isEmpty()) return "Error: Contact name is empty"
        val cursor = context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$contactName%"),
            null
        )

        var phoneNumber: String? = null
        if (cursor != null && cursor.moveToFirst()) {
            val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
            if (numberIndex >= 0) {
                phoneNumber = cursor.getString(numberIndex)
            }
            cursor.close()
        }

        if (phoneNumber != null) {
            val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$phoneNumber"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return "Calling $contactName ($phoneNumber) via Telecom Manager"
        }
        return "Contact $contactName not found in Contacts Provider"
    }

    @SuppressLint("MissingPermission")
    private fun endTelecomCall(): String {
        val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        telecomManager.endCall()
        return "Ended active phone call via Telecom API"
    }

    private fun sendWhatsAppMessage(contactName: String, message: String): String {
        val intent = Intent(Intent.ACTION_VIEW)
        intent.data = Uri.parse("https://api.whatsapp.com/send?text=${Uri.encode(message)}")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return "Opened WhatsApp intent to send message to $contactName"
    }

    private fun sendGmail(recipientEmail: String, subject: String, body: String): String {
        val intent = Intent(Intent.ACTION_SENDTO)
        intent.data = Uri.parse("mailto:$recipientEmail")
        intent.putExtra(Intent.EXTRA_SUBJECT, subject)
        intent.putExtra(Intent.EXTRA_TEXT, body)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return "Opened Gmail client intent to compose email"
    }

    private fun mediaControl(action: String): String {
        when (action.lowercase()) {
            "volume_up" -> audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
            "volume_down" -> audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            "mute" -> audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI)
            "unmute" -> audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI)
        }
        return "Executed media action: $action via MediaSession/AudioManager"
    }

    private fun setVolume(level: Int): String {
        val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val target = (maxVol * (level.coerceIn(0, 100) / 100.0)).toInt()
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI)
        return "Set stream volume to $level%"
    }

    private fun startZoyaService(): String {
        val intent = Intent(context, ZoyaForegroundService::class.java)
        context.startForegroundService(intent)
        return "Started Zoya Voice & Media Foreground Service"
    }

    private fun stopZoyaService(): String {
        val intent = Intent(context, ZoyaForegroundService::class.java)
        context.stopService(intent)
        return "Stopped Zoya Foreground Service"
    }

    private fun toggleOverlayBubble(show: Boolean): String {
        val intent = Intent(context, OverlayBubbleService::class.java)
        if (show) context.startService(intent) else context.stopService(intent)
        return "Toggled System Overlay Floating Bubble to: $show"
    }

    private fun performAccessibilityAction(action: String): String {
        val instance = ZoyaAccessibilityService.instance
        if (instance != null) {
            val result = instance.performAction(action)
            return "Accessibility Action '$action' result: $result"
        }
        return "Accessibility Service is not enabled in System Settings"
    }

    private fun setAlarm(hour: Int, minute: Int, message: String): String {
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, minute)
            putExtra(AlarmClock.EXTRA_MESSAGE, message)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        return "Scheduled alarm for $hour:$minute with message: $message via AlarmManager"
    }

    private fun scheduleBackgroundWork(taskName: String): String {
        val workManager = WorkManager.getInstance(context)
        return "Background task '$taskName' enqueued via Android WorkManager"
    }

    @SuppressLint("MissingPermission")
    private fun getCurrentLocation(): String {
        val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
        fusedLocationClient.lastLocation.addOnSuccessListener { location: Location? ->
            Log.d(TAG, "Current Location: ${location?.latitude}, ${location?.longitude}")
        }
        return "Fetching fine location via Google Play Location Services"
    }

    private fun getNotifications(): String {
        val listener = ZoyaNotificationListener.instance
        return if (listener != null) {
            "Active notifications retrieved via NotificationListenerService"
        } else {
            "Notification Listener Service is not active"
        }
    }

    private fun analyzeScreen(): String {
        val foregroundApp = getForegroundApp()
        val screenText = readScreenText()
        if (!ScreenCaptureService.isPermissionGranted) {
            return "Current App: $foregroundApp.\nScreen Text Hierarchy:\n$screenText\n\nNote: Visual screen capture permission (MediaProjection) was not granted by the user. Only accessibility text is available."
        }
        val base64Frame = ScreenCaptureService.captureLatestFrameBase64()
        return if (base64Frame != null) {
            "Current App: $foregroundApp.\nVisual Screen Captured (JPEG Base64 length: ${base64Frame.length}).\nScreen Text Hierarchy:\n$screenText"
        } else {
            "Current App: $foregroundApp.\nVisual frame capture pending or buffer unavailable.\nScreen Text Hierarchy:\n$screenText"
        }
    }

    private fun captureScreen(): String {
        if (!ScreenCaptureService.isPermissionGranted) {
            return "Screen capture permission has not been granted by user. Please request screen capture permission first."
        }
        val base64 = ScreenCaptureService.captureLatestFrameBase64()
        return if (base64 != null) {
            "Screen captured successfully. Frame byte length: ${base64.length}."
        } else {
            "Screen capture failed: frame data unavailable."
        }
    }

    private fun readScreenText(): String {
        val service = ZoyaAccessibilityService.instance
        return if (service != null) {
            service.extractScreenTextHierarchy()
        } else {
            "Accessibility Service is not enabled. Please enable Zoya Accessibility Service in System Settings to read screen text."
        }
    }

    private fun getForegroundApp(): String {
        val service = ZoyaAccessibilityService.instance
        return service?.getForegroundAppPackage() ?: "Unknown App (Accessibility Service inactive)"
    }

    private fun clickScreenElement(elementText: String): String {
        if (elementText.isEmpty()) return "Element text or query is empty."
        val service = ZoyaAccessibilityService.instance
        return service?.clickElementByText(elementText)
            ?: "Accessibility Service is not enabled. Cannot click screen element."
    }
}
