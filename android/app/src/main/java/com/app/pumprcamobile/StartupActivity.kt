package com.app.pumprcamobile

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Runs before React Native. If a previous startup crashed, the user can show a
 * screenshot of the reason instead of locating logcat on the phone. Never loads
 * the AI library; the real ReactPackage remains registered in MainApplication.
 */
class StartupActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("pumprca.startup", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val lastAttempt = prefs.getLong("attempt", 0L)
        val lastReady = prefs.getLong("ready", 0L)
        val recordedAt = prefs.getLong("error_at", 0L)
        val crash = previousExit(lastAttempt)
        if (lastAttempt > lastReady && (recordedAt >= lastAttempt || crash != null)) {
            showDiagnostic(crash)
        } else {
            openApp()
        }
    }

    private fun previousExit(lastAttempt: Long): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || lastAttempt == 0L) return null
        return try {
            val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
            val exit = manager.getHistoricalProcessExitReasons(packageName, 0, 8)
                .firstOrNull { it.timestamp >= lastAttempt - 1000L && it.processName == packageName }
            when (exit?.reason) {
                android.app.ApplicationExitInfo.REASON_CRASH -> "JAVA_CRASH: ${exit.description ?: "без описания"}"
                android.app.ApplicationExitInfo.REASON_CRASH_NATIVE -> "NATIVE_CRASH: ${exit.description ?: "без описания"}"
                android.app.ApplicationExitInfo.REASON_ANR -> "ANR: ${exit.description ?: "приложение не ответило"}"
                else -> null
            }
        } catch (_: Exception) { null }
    }

    private fun openApp() {
        val now = System.currentTimeMillis()
        prefs.edit().putLong("attempt", now).remove("error_class").remove("error_message")
            .remove("error_stack").remove("error_stage").remove("error_thread")
            .remove("error_at").putString("stage", "STARTUP_ACTIVITY").commit()
        try {
            (application as MainApplication).initializeReactNative()
            (application as MainApplication).recordStartupStage("MAIN_ACTIVITY_LAUNCH")
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        } catch (error: Throwable) {
            (application as MainApplication).saveCrash(error, Thread.currentThread().name)
            showDiagnostic(null)
        }
    }

    private fun showDiagnostic(exit: String?) {
        val background = Color.rgb(18, 18, 18)
        val white = Color.WHITE
        val orange = Color.rgb(255, 123, 25)
        val gray = Color.rgb(180, 180, 180)
        window.statusBarColor = background
        window.navigationBarColor = background
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(background)
            setPadding(24.dp(), 32.dp(), 24.dp(), 20.dp())
        }
        val title = TextView(this).apply {
            text = "Надёжкин · диагностика запуска"
            textSize = 23f
            setTextColor(orange)
            setTypeface(null, 1)
        }
        val subtitle = TextView(this).apply {
            text = "Предыдущее открытие завершилось до загрузки интерфейса. Ваши кейсы и материалы не удалены."
            textSize = 15f
            setTextColor(white)
            setPadding(0, 18.dp(), 0, 18.dp())
        }
        val time = SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale.getDefault())
            .format(Date(prefs.getLong("attempt", 0L)))
        val errorClass = prefs.getString("error_class", null)
        val errorMessage = prefs.getString("error_message", null)
        val errorStack = prefs.getString("error_stack", null)
        val stage = prefs.getString("error_stage", null) ?: prefs.getString("stage", "UNKNOWN")
        val details = TextView(this).apply {
            text = "КОД: ${errorClass ?: exit?.substringBefore(':') ?: "STARTUP_INTERRUPTED"}\n" +
                "ПОПЫТКА: $time\n" +
                "ЭТАП: $stage\n" +
                "ПОТОК: ${prefs.getString("error_thread", "не зафиксирован")}\n" +
                "ANDROID: ${Build.VERSION.RELEASE} / ${Build.SUPPORTED_ABIS.firstOrNull() ?: "?"}\n" +
                "MESSAGE: ${errorMessage ?: exit ?: "Система не записала причину."}\n\n" +
                "JAVA STACK TRACE:\n${errorStack?.takeIf { it.isNotBlank() } ?: "Не сохранён предыдущей сборкой; нужен системный bug report."}"
            textSize = 13f
            setTextColor(gray)
            setPadding(0, 14.dp(), 0, 24.dp())
            setTextIsSelectable(true)
        }
        val button = Button(this).apply {
            text = "ПОПРОБОВАТЬ ОТКРЫТЬ ЕЩЁ РАЗ"
            setOnClickListener { openApp() }
        }
        root.addView(title)
        root.addView(subtitle)
        root.addView(details)
        root.addView(button)
        val scroll = ScrollView(this)
        scroll.addView(root)
        setContentView(scroll)
    }

    private fun Int.dp() = (this * resources.displayMetrics.density).toInt()
}
