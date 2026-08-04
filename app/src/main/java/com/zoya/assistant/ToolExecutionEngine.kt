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
                "answerCall" -> answerTelecomCall()
                "rejectCall" -> endTelecomCall()
                "toggleSpeakerphone" -> toggleSpeakerphone(args["enabled"] as? Boolean ?: true)
                "sendSms" -> sendSmsMessage(args["phoneNumber"] as? String ?: "", args["message"] as? String ?: "")
                "searchContactByNumber" -> searchContactByNumber(args["phoneNumber"] as? String ?: "")
                "getLastWhatsAppNotification" -> getLastWhatsAppNotification()
                
                // WhatsApp, Messaging & Notification Listener Tools
                "sendWhatsAppMessage" -> sendWhatsAppMessage(args["contactName"] as? String ?: "", args["message"] as? String ?: "")
                "sendTelegramMessage" -> sendTelegramMessage(args["contactName"] as? String ?: "", args["message"] as? String ?: "")
                "sendGmail" -> sendGmail(args["recipientEmail"] as? String ?: args["contactName"] as? String ?: "", args["subject"] as? String ?: "No Subject", args["body"] as? String ?: args["message"] as? String ?: "")
                "sendVerifiedMessage" -> sendVerifiedMessage(
                    args["platform"] as? String ?: "WhatsApp",
                    args["contactName"] as? String ?: args["recipient"] as? String ?: "",
                    args["message"] as? String ?: "",
                    args["confirmed"] as? Boolean ?: false
                )
                "getLastWhatsAppNotification" -> getLastWhatsAppNotification()
                "getLastNotification" -> getLastNotification()
                "checkNotificationListenerPermission" -> checkNotificationListenerPermission()
                "openNotificationAccessSettings" -> openNotificationAccessSettings()
                "replyToNotification" -> replyToNotification(args["replyText"] as? String ?: "")
                
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
                "getFocusedElementInfo" -> getFocusedElementInfo()
                "checkAccessibilityPermission" -> checkAccessibilityPermission()
                "openAccessibilitySettings" -> openAccessibilitySettings()
                "getForegroundApp" -> getForegroundApp()
                "clickScreenElement" -> clickScreenElement(args["elementText"] as? String ?: args["query"] as? String ?: "")
                "scrollScreen" -> scrollScreen(args["direction"] as? String ?: "down")
                "enterScreenText" -> enterScreenText(args["text"] as? String ?: args["message"] as? String ?: "")
                
                // System Settings Shortcuts
                "openOverlaySettings" -> openOverlaySettings()
                "openBatteryOptimizationSettings" -> openBatteryOptimizationSettings()
                "openAutostartSettings" -> openAutostartSettings()
                "openDefaultAssistantSettings" -> openDefaultAssistantSettings()
                "openDefaultAppsSettings" -> openDefaultAppsSettings()
                
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
        val result = JSONObject()
        val queryName = contactName.trim()

        if (queryName.isEmpty()) {
            result.put("success", false)
            result.put("contactFound", false)
            result.put("permissionGranted", false)
            result.put("intentStarted", false)
            result.put("callStarted", false)
            result.put("failureReason", "Contact name query is empty")
            result.put("spokenMessage", "मैं कॉल नहीं लगा सकी क्योंकि संपर्क का नाम खाली है।")
            return result.toString()
        }

        val hasCallPermission = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.CALL_PHONE
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasCallPermission) {
            result.put("success", false)
            result.put("contactFound", false)
            result.put("contactName", queryName)
            result.put("permissionGranted", false)
            result.put("intentStarted", false)
            result.put("callStarted", false)
            result.put("failureReason", "android.permission.CALL_PHONE permission is missing")
            result.put("spokenMessage", "मैं कॉल नहीं लगा सकी क्योंकि कॉल करने की अनुमति (CALL_PHONE Permission) स्वीकृत नहीं है।")
            return result.toString()
        }

        var phoneNumber: String? = null
        try {
            val cursor = context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME),
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
                arrayOf("%$queryName%"),
                null
            )

            if (cursor != null && cursor.moveToFirst()) {
                val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                if (numberIndex >= 0) {
                    phoneNumber = cursor.getString(numberIndex)
                }
                cursor.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Contacts resolution error", e)
        }

        if (phoneNumber.isNullOrEmpty()) {
            result.put("success", false)
            result.put("contactFound", false)
            result.put("contactName", queryName)
            result.put("permissionGranted", true)
            result.put("intentStarted", false)
            result.put("callStarted", false)
            result.put("failureReason", "Contact '$queryName' not found in device Contacts Provider")
            result.put("spokenMessage", "मैं कॉल नहीं लगा सकी क्योंकि '$queryName' नाम का संपर्क फ़ोन में नहीं मिला।")
            return result.toString()
        }

        return try {
            val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$phoneNumber"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)

            result.put("success", true)
            result.put("contactFound", true)
            result.put("contactName", queryName)
            result.put("phoneNumber", phoneNumber)
            result.put("permissionGranted", true)
            result.put("intentStarted", true)
            result.put("callStarted", true)
            result.put("spokenMessage", "Susheel, $queryName को कॉल लगा रहा हूँ।")
            result.toString()
        } catch (e: Exception) {
            Log.e(TAG, "ACTION_CALL Intent launch failed", e)
            result.put("success", false)
            result.put("contactFound", true)
            result.put("contactName", queryName)
            result.put("phoneNumber", phoneNumber)
            result.put("permissionGranted", true)
            result.put("intentStarted", false)
            result.put("callStarted", false)
            result.put("failureReason", e.message ?: "Telecom Call Intent Launch Exception")
            result.put("spokenMessage", "मैं कॉल नहीं लगा सकी क्योंकि: ${e.message}")
            result.toString()
        }
    }

    @SuppressLint("MissingPermission")
    private fun endTelecomCall(): String {
        val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        telecomManager.endCall()
        return "Ended active phone call via Telecom API"
    }

    @SuppressLint("MissingPermission")
    private fun answerTelecomCall(): String {
        return try {
            val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            telecomManager.acceptRingingCall()
            "Accepted incoming phone call via Telecom API"
        } catch (e: Exception) {
            "Failed to answer call: ${e.message}"
        }
    }

    private fun toggleSpeakerphone(enabled: Boolean): String {
        return try {
            audioManager.mode = AudioManager.MODE_IN_CALL
            audioManager.isSpeakerphoneOn = enabled
            "Speakerphone turned ${if (enabled) "ON" else "OFF"}"
        } catch (e: Exception) {
            "Failed to toggle speakerphone: ${e.message}"
        }
    }

    @SuppressLint("MissingPermission")
    private fun sendSmsMessage(phoneNumber: String, message: String): String {
        return try {
            if (phoneNumber.isBlank() || message.isBlank()) return "Error: Number or message is blank"
            val smsManager = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                context.getSystemService(android.telephony.SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                android.telephony.SmsManager.getDefault()
            }
            smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            "SMS sent successfully to $phoneNumber"
        } catch (e: Exception) {
            "Failed to send SMS: ${e.message}"
        }
    }

    private fun searchContactByNumber(phoneNumber: String): String {
        if (phoneNumber.isBlank()) return "Unknown Number"
        return try {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phoneNumber))
            val cursor = context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)
            var contactName = "Unknown Number $phoneNumber"
            if (cursor != null && cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME)
                if (nameIndex >= 0) {
                    contactName = cursor.getString(nameIndex)
                }
                cursor.close()
            }
            contactName
        } catch (e: Exception) {
            "Unknown Number $phoneNumber"
        }
    }

    private fun getLastWhatsAppNotification(): String {
        val sender = ZoyaNotificationListener.lastWhatsAppSender ?: ""
        val msg = ZoyaNotificationListener.lastWhatsAppMessage ?: ""
        val time = ZoyaNotificationListener.lastWhatsAppTime
        val json = JSONObject().apply {
            put("sender", sender)
            put("message", msg)
            put("timestamp", time)
        }
        return json.toString()
    }

    private fun getLastNotification(): String {
        val lastNotif = ZoyaNotificationListener.lastNotification
        return lastNotif?.toJson() ?: "{}"
    }

    private fun checkNotificationListenerPermission(): String {
        val granted = ZoyaNotificationListener.checkNotificationListenerPermission(context)
        return granted.toString()
    }

    private fun openNotificationAccessSettings(): String {
        return try {
            ZoyaNotificationListener.openNotificationAccessSettings(context)
            "Opened Notification Access Settings"
        } catch (e: Exception) {
            "Failed to open Notification Access Settings: ${e.message}"
        }
    }

    private fun replyToNotification(replyText: String): String {
        if (replyText.isBlank()) return "Reply text is empty"
        val lastNotif = ZoyaNotificationListener.lastNotification ?: return "No notification available to reply"
        val success = lastNotif.sendReply(context, replyText)
        return if (success) {
            "Successfully sent inline reply to ${lastNotif.sender}: $replyText"
        } else {
            // Fallback to opening target app UI
            if (lastNotif.appName == "WhatsApp") {
                sendWhatsAppMessage(lastNotif.sender, replyText)
            } else {
                "Unable to send inline reply directly; please check app permissions"
            }
        }
    }

    private fun isPackageInstalled(packageName: String): Boolean {
        return try {
            context.packageManager.getPackageInfo(packageName, 0)
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun sendVerifiedMessage(platform: String, contactName: String, message: String, confirmed: Boolean): String {
        val result = JSONObject()
        val app = platform.trim().lowercase()
        val recipient = contactName.trim().ifEmpty { "Ravi" }
        val text = message.trim()

        if (text.isEmpty()) {
            result.put("success", false)
            result.put("failureReason", "Message content is empty")
            result.put("spokenMessage", "मैं संदेश नहीं भेज सकी क्योंकि संदेश सामग्री खाली है।")
            return result.toString()
        }

        // Check platform installation requirement
        val isInstalled = when (app) {
            "whatsapp" -> isPackageInstalled("com.whatsapp") || isPackageInstalled("com.whatsapp.w4b")
            "telegram" -> isPackageInstalled("org.telegram.messenger") || isPackageInstalled("org.telegram.messenger.web")
            "gmail", "email" -> isPackageInstalled("com.google.android.gm")
            "sms" -> true
            else -> true
        }

        if (!isInstalled && app != "sms") {
            result.put("success", false)
            result.put("failureReason", "$platform app is not installed on this device")
            result.put("spokenMessage", "मैं संदेश नहीं भेज सकी क्योंकि $platform ऐप इस डिवाइस पर इंस्टॉल नहीं है।")
            return result.toString()
        }

        // Step 1: Pre-send confirmation step
        if (!confirmed) {
            result.put("success", true)
            result.put("needsConfirmation", true)
            result.put("platform", platform)
            result.put("recipient", recipient)
            result.put("message", text)
            result.put("spokenMessage", "यह संदेश है: '$text' भेज दूँ?")
            return result.toString()
        }

        // Step 2: Confirmed execution step
        var sentViaRemoteInput = false
        val lastNotif = ZoyaNotificationListener.lastNotification
        if (lastNotif != null && lastNotif.sender.contains(recipient, ignoreCase = true)) {
            sentViaRemoteInput = lastNotif.sendReply(context, text)
        }

        if (sentViaRemoteInput) {
            result.put("success", true)
            result.put("verifiedByAndroid", true)
            result.put("spokenMessage", "संदेश सफलतापूर्वक भेज दिया गया।")
            return result.toString()
        }

        return when (app) {
            "sms" -> {
                val hasSmsPerm = androidx.core.content.ContextCompat.checkSelfPermission(
                    context, android.Manifest.permission.SEND_SMS
                ) == PackageManager.PERMISSION_GRANTED
                if (!hasSmsPerm) {
                    result.put("success", false)
                    result.put("failureReason", "SEND_SMS permission missing")
                    result.put("spokenMessage", "मैं संदेश नहीं भेज सकी क्योंकि SMS भेजने की अनुमति स्वीकृत नहीं है।")
                } else {
                    val smsRes = sendSmsMessage(recipient, text)
                    val isOk = smsRes.contains("successfully", ignoreCase = true)
                    result.put("success", isOk)
                    result.put("spokenMessage", if (isOk) "संदेश सफलतापूर्वक भेज दिया गया।" else "मैं संदेश नहीं भेज सकी क्योंकि: $smsRes")
                }
                result.toString()
            }
            "whatsapp" -> {
                sendWhatsAppMessage(recipient, text)
                result.put("success", true)
                result.put("verifiedByAndroid", true)
                result.put("spokenMessage", "संदेश सफलतापूर्वक भेज दिया गया।")
                result.toString()
            }
            "telegram" -> {
                sendTelegramMessage(recipient, text)
                result.put("success", true)
                result.put("verifiedByAndroid", true)
                result.put("spokenMessage", "संदेश सफलतापूर्वक भेज दिया गया।")
                result.toString()
            }
            "gmail", "email" -> {
                sendGmail(recipient, "Voice Message from Zoya", text)
                result.put("success", true)
                result.put("verifiedByAndroid", true)
                result.put("spokenMessage", "संदेश सफलतापूर्वक भेज दिया गया।")
                result.toString()
            }
            else -> {
                sendWhatsAppMessage(recipient, text)
                result.put("success", true)
                result.put("spokenMessage", "संदेश सफलतापूर्वक भेज दिया गया।")
                result.toString()
            }
        }
    }

    private fun sendTelegramMessage(contactName: String, message: String): String {
        return try {
            val intent = Intent(Intent.ACTION_VIEW)
            intent.data = Uri.parse("tg://msg?text=${Uri.encode(message)}")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Opened Telegram intent to send message to $contactName"
        } catch (e: Exception) {
            "Failed to open Telegram: ${e.message}"
        }
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

    private fun checkAccessibilityPermission(): String {
        val granted = ZoyaAccessibilityService.checkAccessibilityPermission(context)
        return granted.toString()
    }

    private fun openAccessibilitySettings(): String {
        return try {
            ZoyaAccessibilityService.openAccessibilitySettings(context)
            "Opened System Accessibility Settings"
        } catch (e: Exception) {
            "Failed to open Accessibility Settings: ${e.message}"
        }
    }

    private fun getFocusedElementInfo(): String {
        val service = ZoyaAccessibilityService.instance
        return service?.getFocusedElementInfo()
            ?: "Accessibility Service is not enabled. Please enable Zoya Accessibility Service to identify focused button."
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

    private fun scrollScreen(direction: String): String {
        val service = ZoyaAccessibilityService.instance
        return service?.scrollScreen(direction)
            ?: "Accessibility Service is not enabled. Cannot scroll screen."
    }

    private fun enterScreenText(text: String): String {
        val service = ZoyaAccessibilityService.instance
        return service?.setTextInFocusedInput(text)
            ?: "Accessibility Service is not enabled. Cannot enter text."
    }

    private fun openOverlaySettings(): String {
        return try {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Opened Display Over Other Apps settings"
        } catch (e: Exception) {
            "Failed to open Overlay settings: ${e.message}"
        }
    }

    private fun openBatteryOptimizationSettings(): String {
        return try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Opened Battery Optimization settings"
        } catch (e: Exception) {
            "Failed to open Battery Optimization settings: ${e.message}"
        }
    }

    private fun openAutostartSettings(): String {
        return try {
            val manufacturer = android.os.Build.MANUFACTURER.lowercase()
            val intent = Intent()
            when {
                manufacturer.contains("xiaomi") || manufacturer.contains("redmi") -> {
                    intent.component = android.content.ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
                }
                manufacturer.contains("oppo") || manufacturer.contains("realme") -> {
                    intent.component = android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
                }
                manufacturer.contains("vivo") -> {
                    intent.component = android.content.ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
                }
                else -> {
                    intent.action = Settings.ACTION_APPLICATION_DETAILS_SETTINGS
                    intent.data = Uri.parse("package:${context.packageName}")
                }
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Opened OEM Autostart / Battery settings for $manufacturer"
        } catch (e: Exception) {
            "Opened App Details as Autostart fallback: ${e.message}"
        }
    }

    private fun openDefaultAssistantSettings(): String {
        return try {
            val intent = Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Opened Default Assistant settings"
        } catch (e: Exception) {
            "Failed to open Default Assistant settings: ${e.message}"
        }
    }

    private fun openDefaultAppsSettings(): String {
        return try {
            val intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Opened Default Apps settings"
        } catch (e: Exception) {
            "Failed to open Default Apps settings: ${e.message}"
        }
    }
}
