package com.zoya.assistant.services

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class ZoyaAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "ZoyaAccessibilityService connected & active continuously.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event != null) {
            if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                event.packageName?.let {
                    currentPackageName = it.toString()
                }
            }
            if (event.source != null) {
                lastEventNode = event.source
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "ZoyaAccessibilityService interrupted.")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "ZoyaAccessibilityService destroyed.")
        if (instance == this) instance = null
    }

    fun performAction(actionName: String): Boolean {
        return when (actionName.lowercase()) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "quick_settings" -> performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
            "lock_screen" -> performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
            "take_screenshot" -> performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT)
            else -> false
        }
    }

    fun getForegroundAppPackage(): String {
        val root = rootInActiveWindow
        val pkg = root?.packageName?.toString() ?: currentPackageName
        return if (pkg.isNotEmpty()) pkg else "Unknown App"
    }

    fun extractScreenTextHierarchy(): String {
        val root = rootInActiveWindow ?: return "Accessibility Service सक्रिय है, लेकिन स्क्रीन का डेटा उपलब्ध नहीं है।"
        val builder = StringBuilder()
        val pkgName = root.packageName?.toString() ?: currentPackageName
        builder.append("ऐप: $pkgName\n")
        builder.append("स्क्रीन पर दिखने वाले मुख्य बटन और टेक्स्ट:\n")
        traverseNode(root, builder, 0)
        return if (builder.length > 30) builder.toString() else "स्क्रीन पर कोई पढ़ने योग्य टेक्स्ट या बटन नहीं मिला।"
    }

    private fun traverseNode(node: AccessibilityNodeInfo?, builder: StringBuilder, depth: Int) {
        if (node == null || depth > 12) return

        val text = node.text?.toString()?.trim()
        val contentDesc = node.contentDescription?.toString()?.trim()
        val className = node.className?.toString()?.substringAfterLast('.') ?: ""

        if (!text.isNullOrEmpty()) {
            builder.append("- ").append(text)
            if (node.isClickable) builder.append(" (बटन/क्लिक योग्य)")
            builder.append("\n")
        } else if (!contentDesc.isNullOrEmpty()) {
            builder.append("- [विवरण: ").append(contentDesc).append("]")
            if (node.isClickable) builder.append(" (बटन/क्लिक योग्य)")
            builder.append("\n")
        }

        for (i in 0 until node.childCount) {
            traverseNode(node.getChild(i), builder, depth + 1)
        }
    }

    fun getFocusedElementInfo(): String {
        val root = rootInActiveWindow
        var focusedNode = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: root?.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)
            ?: lastEventNode

        if (focusedNode == null && root != null) {
            focusedNode = findFirstClickableNode(root)
        }

        if (focusedNode == null) {
            return "कोई चयनित या फोकस किया हुआ बटन/एलिमेंट नहीं मिला।"
        }

        val text = focusedNode.text?.toString()?.trim() ?: ""
        val desc = focusedNode.contentDescription?.toString()?.trim() ?: ""
        val type = focusedNode.className?.toString()?.substringAfterLast('.') ?: "एलिमेंट"
        val label = if (text.isNotBlank()) text else if (desc.isNotBlank()) desc else "अज्ञात बटन"

        val clickableInfo = if (focusedNode.isClickable) "यह एक दबाने योग्य (Clickable) $type है।" else "यह एक $type है।"
        return "चयनित एलिमेंट: '$label' ($type)। $clickableInfo इसका उपयोग ऐप में '$label' विकल्प को चुनने या खोलने के लिए किया जाता है।"
    }

    private fun findFirstClickableNode(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isClickable && (!node.text.isNullOrEmpty() || !node.contentDescription.isNullOrEmpty())) {
            return node
        }
        for (i in 0 until node.childCount) {
            val child = findFirstClickableNode(node.getChild(i))
            if (child != null) return child
        }
        return null
    }

    fun scrollScreen(direction: String): String {
        val root = rootInActiveWindow ?: return "स्क्रीन लोड नहीं हो सकी।"
        val action = if (direction.lowercase() == "up") {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }
        val scrollableNode = findScrollableNode(root)
        if (scrollableNode != null) {
            val success = scrollableNode.performAction(action)
            if (success) {
                return "स्क्रीन को सफलतापूर्वक स्क्रॉल किया गया।"
            }
        }
        return "स्क्रॉल करने योग्य एरिया नहीं मिला।"
    }

    private fun findScrollableNode(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isScrollable) return node
        for (i in 0 until node.childCount) {
            val child = findScrollableNode(node.getChild(i))
            if (child != null) return child
        }
        return null
    }

    fun setTextInFocusedInput(inputText: String): String {
        val root = rootInActiveWindow ?: return "स्क्रीन लोड नहीं हो सकी।"
        var inputNode = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (inputNode == null) {
            inputNode = findFirstEditableNode(root)
        }
        if (inputNode == null) {
            return "कोई इनपुट (EditText) फ़ील्ड नहीं मिला।"
        }

        val arguments = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, inputText)
        }
        val success = inputNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        return if (success) {
            "टेक्स्ट दर्ज किया गया: '$inputText'"
        } else {
            "टेक्स्ट दर्ज नहीं हो सका।"
        }
    }

    private fun findFirstEditableNode(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable || node.className?.contains("EditText", ignoreCase = true) == true) {
            return node
        }
        for (i in 0 until node.childCount) {
            val child = findFirstEditableNode(node.getChild(i))
            if (child != null) return child
        }
        return null
    }

    fun clickElementByText(targetText: String): String {
        val root = rootInActiveWindow ?: return "स्क्रीन लोड नहीं हो सकी।"
        val matchedNodes = root.findAccessibilityNodeInfosByText(targetText)
        if (matchedNodes.isNullOrEmpty()) {
            return "स्क्रीन पर '$targetText' नाम का एलिमेंट नहीं मिला।"
        }

        for (node in matchedNodes) {
            var clickableNode: AccessibilityNodeInfo? = node
            while (clickableNode != null && !clickableNode.isClickable) {
                clickableNode = clickableNode.parent
            }
            if (clickableNode != null && clickableNode.isClickable) {
                val success = clickableNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (success) {
                    return "'$targetText' को सफलतापूर्वक दबाया गया।"
                }
            }
        }
        return "'$targetText' मिला, लेकिन इसे दबाया नहीं जा सका।"
    }

    companion object {
        private const val TAG = "ZoyaAccessibilityService"
        var instance: ZoyaAccessibilityService? = null
            private set
        var currentPackageName: String = ""
        var lastEventNode: AccessibilityNodeInfo? = null

        fun checkAccessibilityPermission(context: Context): Boolean {
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            return enabledServices.contains(context.packageName)
        }

        fun openAccessibilitySettings(context: Context) {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }
}
