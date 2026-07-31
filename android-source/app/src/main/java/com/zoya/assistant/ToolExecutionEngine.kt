package com.zoya.assistant

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.MediaStore
import android.util.Log

class ToolExecutionEngine(private val context: Context) {
    private val packageManager: PackageManager = context.packageManager
    private val TAG = "ToolExecutionEngine"

    fun executeTool(name: String, args: Map<String, Any>): String {
        Log.d(TAG, "Executing tool: $name with args: $args")
        return try {
            when (name) {
                "openApp" -> openApp(args["packageName"] as? String ?: "")
                "searchInstalledApp" -> searchInstalledApp(args["appName"] as? String ?: "")
                "openYouTube" -> openApp("com.google.android.youtube")
                "openInstagram" -> openApp("com.instagram.android")
                "openWhatsApp" -> openApp("com.whatsapp")
                "openChrome" -> openApp("com.android.chrome")
                "openCamera" -> openCamera()
                "searchAndCallContact" -> searchAndCallContact(args["contactName"] as? String ?: "")
                "sendWhatsAppMessage" -> sendWhatsAppMessage(args["contactName"] as? String ?: "", args["message"] as? String ?: "")
                "sendGmail" -> sendGmail(args["recipientEmail"] as? String ?: "", args["subject"] as? String ?: "", args["body"] as? String ?: "")
                else -> "Unknown tool: $name"
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error executing tool $name", e)
            "Failed to execute $name: ${e.message}"
        }
    }

    private fun openApp(packageName: String): String {
        if (packageName.isEmpty()) return "Error: Package name is empty"
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launchIntent)
            return "Successfully opened $packageName"
        }
        return "App $packageName is not installed"
    }

    private fun searchInstalledApp(appName: String): String {
        if (appName.isEmpty()) return "Error: App name is empty"
        val packages = packageManager.getInstalledApplications(PackageManager.GET_META_DATA)
        for (appInfo in packages) {
            val label = packageManager.getApplicationLabel(appInfo).toString()
            if (label.equals(appName, ignoreCase = true)) {
                return appInfo.packageName
            }
        }
        return "App $appName not found"
    }

    private fun openCamera(): String {
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(packageManager) != null) {
            context.startActivity(intent)
            return "Opened camera"
        }
        return "No camera app found"
    }

    private fun searchAndCallContact(contactName: String): String {
        if (contactName.isEmpty()) return "Error: Contact name is empty"
        
        // This requires READ_CONTACTS permission
        if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(android.Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            return "Error: Missing READ_CONTACTS or CALL_PHONE permission"
        }

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
            return "Calling $contactName at $phoneNumber"
        }
        
        return "Contact $contactName not found"
    }

    private fun sendWhatsAppMessage(contactName: String, message: String): String {
        // Find phone number first
        // Note: For real world use, formatting the number correctly is required
        val intent = Intent(Intent.ACTION_VIEW)
        // A direct WA deep link for demonstration:
        intent.data = Uri.parse("https://api.whatsapp.com/send?text=${Uri.encode(message)}")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return "Opened WhatsApp to send message to $contactName"
    }

    private fun sendGmail(recipientEmail: String, subject: String, body: String): String {
        val intent = Intent(Intent.ACTION_SENDTO)
        intent.data = Uri.parse("mailto:$recipientEmail")
        intent.putExtra(Intent.EXTRA_SUBJECT, subject)
        intent.putExtra(Intent.EXTRA_TEXT, body)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        
        if (intent.resolveActivity(packageManager) != null) {
            context.startActivity(intent)
            return "Opened email app to compose message"
        }
        return "No email app found"
    }
}
