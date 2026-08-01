package com.zoya.assistant.services

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class ZoyaNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        // Handle incoming notifications
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) instance = null
    }

    companion object {
        var instance: ZoyaNotificationListener? = null
    }
}
