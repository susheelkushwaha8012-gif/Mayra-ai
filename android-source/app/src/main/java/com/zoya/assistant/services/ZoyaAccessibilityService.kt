package com.zoya.assistant.services

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class ZoyaAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "ZoyaAccessibilityService connected.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            event.packageName?.let {
                currentPackageName = it.toString()
            }
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        super.onDestroy()
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
        val root = rootInActiveWindow ?: return "Accessibility Service is active, but screen hierarchy node is unavailable."
        val builder = StringBuilder()
        traverseNode(root, builder, 0)
        return if (builder.isNotEmpty()) builder.toString() else "No visible text found on current screen."
    }

    private fun traverseNode(node: AccessibilityNodeInfo?, builder: StringBuilder, depth: Int) {
        if (node == null || depth > 10) return

        val text = node.text?.toString()?.trim()
        val contentDesc = node.contentDescription?.toString()?.trim()
        val className = node.className?.toString()?.substringAfterLast('.')

        if (!text.isNull_orEmpty()) {
            builder.append("- ").append(text)
            if (node.isClickable) builder.append(" [Clickable]")
            builder.append("\n")
        } else if (!contentDesc.isNull_orEmpty()) {
            builder.append("- [Desc: ").append(contentDesc).append("]")
            if (node.isClickable) builder.append(" [Clickable]")
            builder.append("\n")
        }

        for (i in 0 until node.childCount) {
            traverseNode(node.getChild(i), builder, depth + 1)
        }
    }

    fun clickElementByText(targetText: String): String {
        val root = rootInActiveWindow ?: return "Screen root node unavailable."
        val matchedNodes = root.findAccessibilityNodeInfosByText(targetText)
        if (matchedNodes.isNullOrEmpty()) {
            return "Element matching '$targetText' not found on current screen."
        }

        for (node in matchedNodes) {
            var clickableNode: AccessibilityNodeInfo? = node
            while (clickableNode != null && !clickableNode.isClickable) {
                clickableNode = clickableNode.parent
            }
            if (clickableNode != null && clickableNode.isClickable) {
                val success = clickableNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (success) {
                    return "Clicked element '$targetText' successfully."
                }
            }
        }
        return "Found element '$targetText', but it is not clickable."
    }

    private fun String?.isNull_orEmpty(): Boolean = this == null || this.isEmpty()

    companion object {
        private const val TAG = "ZoyaAccessibilityService"
        var instance: ZoyaAccessibilityService? = null
            private set
        var currentPackageName: String = ""
    }
}
