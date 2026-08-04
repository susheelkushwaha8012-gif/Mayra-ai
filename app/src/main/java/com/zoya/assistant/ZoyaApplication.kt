package com.zoya.assistant

import android.app.Application
import android.util.Log

class ZoyaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.d("ZoyaApplication", "Zoya Assistant Application initialized.")
    }
}
