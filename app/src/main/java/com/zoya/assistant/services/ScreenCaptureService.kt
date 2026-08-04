package com.zoya.assistant.services

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.ByteArrayOutputStream

class ScreenCaptureService : Service() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Zoya Screen Understanding")
            .setContentText("Screen capture permission granted and active")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        startForeground(1002, notification)

        val resultCode = intent?.getIntExtra("RESULT_CODE", Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        val resultData = intent?.getParcelableExtra<Intent>("RESULT_DATA")

        if (resultCode == Activity.RESULT_OK && resultData != null) {
            val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = projectionManager.getMediaProjection(resultCode, resultData)
            setupVirtualDisplay()
            isPermissionGranted = true
            Log.d(TAG, "MediaProjection successfully initialized.")
        } else {
            isPermissionGranted = false
            Log.w(TAG, "MediaProjection permission denied or invalid result.")
        }

        return START_STICKY
    }

    private fun setupVirtualDisplay() {
        val metrics = resources.displayMetrics
        val width = metrics.widthPixels / 2
        val height = metrics.heightPixels / 2
        val density = metrics.densityDpi

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "ZoyaScreenCapture",
            width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface, null, null
        )
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()
        mediaProjection = null
        isPermissionGranted = false
        if (instance == this) instance = null
        Log.d(TAG, "ScreenCaptureService destroyed.")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Zoya Screen Capture Service Channel",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    companion object {
        private const val TAG = "ScreenCaptureService"
        private const val CHANNEL_ID = "ZoyaScreenCaptureChannel"

        var instance: ScreenCaptureService? = null
            private set

        var isPermissionGranted: Boolean = false
            private set

        private var mediaProjection: MediaProjection? = null
        private var virtualDisplay: VirtualDisplay? = null
        private var imageReader: ImageReader? = null

        fun captureLatestFrameBase64(): String? {
            val reader = imageReader ?: return null
            val image = reader.acquireLatestImage() ?: return null
            try {
                val planes = image.planes
                val buffer = planes[0].buffer
                val pixelStride = planes[0].pixelStride
                val rowStride = planes[0].rowStride
                val rowPadding = rowStride - pixelStride * image.width

                val bitmap = Bitmap.createBitmap(
                    image.width + rowPadding / pixelStride,
                    image.height,
                    Bitmap.Config.ARGB_8888
                )
                bitmap.copyPixelsFromBuffer(buffer)

                val croppedBitmap = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
                val outputStream = ByteArrayOutputStream()
                croppedBitmap.compress(Bitmap.CompressFormat.JPEG, 75, outputStream)
                val byteArray = outputStream.toByteArray()
                return Base64.encodeToString(byteArray, Base64.NO_WRAP)
            } catch (e: Exception) {
                Log.e(TAG, "Error capturing bitmap frame", e)
                return null
            } finally {
                image.close()
            }
        }
    }
}
