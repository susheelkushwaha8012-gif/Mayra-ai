# Zoya Assistant - Native Android Source Code

This folder contains the native Android (Kotlin) code required to compile the release-ready APK for the assistant, implementing real device control via `PackageManager` and `Intent` execution.

Because this workspace runs in a sandboxed web-based environment, a native `.apk` cannot be compiled directly here. To build the APK, simply copy this `com.zoya.assistant` folder into a new Android Studio project.

## Included Native Code
1. `ToolExecutionEngine.kt`: Handles the execution of Android intents triggered by Gemini function calls. Implements tools like `openApp`, `searchInstalledApp`, `openYouTube`, `openChrome`, `searchAndCallContact`, etc. using native `PackageManager`.
2. `PermissionsManager.kt`: Uses Jetpack Compose `ActivityResultContracts` to request `RECORD_AUDIO`, `READ_CONTACTS`, `CALL_PHONE`, and `POST_NOTIFICATIONS` smoothly at runtime.

The Node.js backend (running in the main project folder) has been successfully updated to parse, register, and transmit all these new intent-based tool calls via the Gemini Live API. The live Web UI simulates these intents for immediate testing.
