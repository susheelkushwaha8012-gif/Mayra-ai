package com.zoya.assistant.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.zoya.assistant.services.ZoyaForegroundService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return
        val action = intent.action
        Log.d("BootReceiver", "Zoya BootReceiver triggered with action: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            try {
                val serviceIntent = Intent(context, ZoyaForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                Log.d("BootReceiver", "Successfully restarted ZoyaForegroundService on system boot/update")
            } catch (e: Exception) {
                Log.e("BootReceiver", "Failed to start ZoyaForegroundService on boot", e)
            }
        }
    }
}
