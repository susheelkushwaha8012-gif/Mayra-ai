# ProGuard Rules for Zoya Assistant
-keep class com.zoya.assistant.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
