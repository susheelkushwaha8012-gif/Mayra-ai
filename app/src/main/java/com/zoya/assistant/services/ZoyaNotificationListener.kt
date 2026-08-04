package com.zoya.assistant.services

import android.app.Notification
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject

class ZoyaNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        Log.d("ZoyaNotificationListener", "Notification Listener Service Connected")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val pkg = sbn.packageName ?: ""
        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val appName = when {
            pkg.contains("whatsapp") -> "WhatsApp"
            pkg.contains("telegram") -> "Telegram"
            pkg.contains("messaging") || pkg.contains("sms") || pkg.contains("mms") -> "SMS"
            pkg.contains("gm") || pkg.contains("gmail") -> "Gmail"
            else -> null
        } ?: return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: appName
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        if (text.isNotBlank()) {
            Log.d("ZoyaNotificationListener", "Captured $appName notification: $title -> $text")
            
            var replyAction: Notification.Action? = null
            var remoteInputObj: RemoteInput? = null
            notification.actions?.forEach { action ->
                action.remoteInputs?.forEach { ri ->
                    if (ri.allowFreeFormInput) {
                        replyAction = action
                        remoteInputObj = ri
                    }
                }
            }

            val item = NotificationItem(
                appName = appName,
                packageName = pkg,
                sender = title,
                message = text,
                timestamp = System.currentTimeMillis(),
                replyAction = replyAction,
                remoteInput = remoteInputObj
            )

            lastNotification = item
            if (appName == "WhatsApp") {
                lastWhatsAppSender = title
                lastWhatsAppMessage = text
                lastWhatsAppTime = item.timestamp
            }
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) instance = null
    }

    data class NotificationItem(
        val appName: String,
        val packageName: String,
        val sender: String,
        val message: String,
        val timestamp: Long,
        val replyAction: Notification.Action? = null,
        val remoteInput: RemoteInput? = null
    ) {
        fun sendReply(context: Context, replyText: String): Boolean {
            if (replyAction != null && remoteInput != null) {
                return try {
                    val intent = Intent()
                    val bundle = Bundle()
                    bundle.putCharSequence(remoteInput.resultKey, replyText)
                    RemoteInput.addResultsToIntent(arrayOf(remoteInput), intent, bundle)
                    replyAction.actionIntent.send(context, 0, intent)
                    Log.d("ZoyaNotificationListener", "Sent RemoteInput inline reply: $replyText")
                    true
                } catch (e: Exception) {
                    Log.e("ZoyaNotificationListener", "Failed RemoteInput reply", e)
                    false
                }
            }
            return false
        }

        fun toJson(): String {
            val json = JSONObject().apply {
                put("appName", appName)
                put("packageName", packageName)
                put("sender", sender)
                put("message", message)
                put("timestamp", timestamp)
                put("hasInlineReply", replyAction != null && remoteInput != null)
            }
            return json.toString()
        }
    }

    companion object {
        var instance: ZoyaNotificationListener? = null
        var lastNotification: NotificationItem? = null
        var lastWhatsAppSender: String? = null
        var lastWhatsAppMessage: String? = null
        var lastWhatsAppTime: Long = 0L

        fun checkNotificationListenerPermission(context: Context): Boolean {
            val flat = android.provider.Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            )
            return flat != null && flat.contains(context.packageName)
        }

        fun openNotificationAccessSettings(context: Context) {
            val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }
}
