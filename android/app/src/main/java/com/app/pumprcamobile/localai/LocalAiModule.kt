package com.app.pumprcamobile.localai

import android.util.Base64
import android.util.Log
import com.example.llama.NativeProgress
import com.example.llama.VisionPocBridge
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors
import java.io.PrintWriter
import java.io.StringWriter

class LocalAiModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    // A single worker prevents simultaneous GGUF model residency on the phone.
    private val executor = Executors.newSingleThreadExecutor()

    private fun saveDiagnostic(kind: String, payload: String) {
        context.getSharedPreferences("pumprca.local-ai.diagnostics", android.content.Context.MODE_PRIVATE)
            .edit()
            .putLong("updatedAt", System.currentTimeMillis())
            .putString("kind", kind)
            .putString("last", payload.takeLast(100_000))
            .apply()
        Log.e("PumpRcaLocalAI", "diagnostic[$kind]=${payload.takeLast(12_000)}")
    }

    private fun throwableDiagnostic(error: Throwable): String {
        val writer = StringWriter()
        error.printStackTrace(PrintWriter(writer))
        return "JAVA_EXCEPTION=${error.javaClass.name}\nMESSAGE=${error.message ?: "<null>"}\nSTACKTRACE=\n${writer}"
    }

    @ReactMethod
    fun getLastDiagnostic(promise: Promise) {
        val prefs = context.getSharedPreferences("pumprca.local-ai.diagnostics", android.content.Context.MODE_PRIVATE)
        val nativeLog = runCatching {
            context.getFileStreamPath("pumprca-native.log")
                .takeIf { it.exists() }
                ?.readText()
                ?.takeLast(200_000)
        }.getOrNull().orEmpty()
        promise.resolve(Arguments.createMap().apply {
            putString("kind", prefs.getString("kind", "") ?: "")
            putString("last", prefs.getString("last", "") ?: "")
            putString("nativeLog", nativeLog)
            putDouble("updatedAt", prefs.getLong("updatedAt", 0L).toDouble())
        })
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun markUiReady() {
        context.getSharedPreferences("pumprca.startup", android.content.Context.MODE_PRIVATE)
            .edit().putLong("ready", System.currentTimeMillis())
            .putString("stage", "REACT_UI_READY").commit()
    }

    private fun emitPhase(phase: String) {
        try {
            val payload = Arguments.createMap().apply { putString("phase", phase) }
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("PumpRcaAIProgress", payload)
        } catch (error: Exception) {
            Log.w("PumpRcaLocalAI", "Could not display progress for phase=$phase", error)
        }
    }

    // Required by NativeEventEmitter; cancellation itself is intentionally NOT queued.
    @ReactMethod fun addListener(eventName: String) { /* progress subscriptions are handled by RN */ }
    @ReactMethod fun removeListeners(count: Double) { /* progress subscriptions are handled by RN */ }

    @ReactMethod
    fun cancelAnalysis() {
        VisionPocBridge.cancel()
    }

    @ReactMethod
    fun runVisionRca(visionModelPath: String, mmprojPath: String, imageBase64: String, promise: Promise) {
        executor.execute {
            try {
                saveDiagnostic("VISION_START", "model=$visionModelPath\nmmproj=$mmprojPath\nruntime=llama.cpp+libmtmd\nprovider=ggml-cpu\n")
                emitPhase("IMAGE_DECODE")
                val imageBytes = Base64.decode(imageBase64, Base64.DEFAULT)
                val result = VisionPocBridge.runVisionPoc(
                    visionModelPath, mmprojPath, imageBytes, NativeProgress(::emitPhase))
                val response: WritableMap = Arguments.createMap().apply {
                    putString("text", result)
                    putBoolean("success", result.startsWith("VISION_POC_OK\n") &&
                        result.contains("VISION_MODEL_LOADED=true") &&
                        result.contains("MMPROJ_LOADED=true") &&
                        result.contains("VISION_UNLOADED=true"))
                }
                saveDiagnostic(if (response.getBoolean("success")) "VISION_SUCCESS" else "VISION_NATIVE_ERROR", result)
                promise.resolve(response)
            } catch (error: Throwable) {
                val diagnostic = throwableDiagnostic(error)
                saveDiagnostic("VISION_JAVA_ERROR", diagnostic)
                promise.reject("LOCAL_AI_VISION_NATIVE", diagnostic, error)
            }
        }
    }

    @ReactMethod
    fun runTextRca(qwen3ModelPath: String, prompt: String, promise: Promise) {
        executor.execute {
            try {
                saveDiagnostic("TEXT_START", "model=$qwen3ModelPath\nruntime=llama.cpp\nprovider=ggml-cpu\npromptBytes=${prompt.toByteArray().size}\n")
                val result = VisionPocBridge.runTextRca(qwen3ModelPath, prompt, NativeProgress(::emitPhase))
                val response = Arguments.createMap().apply {
                    putString("text", result)
                    putBoolean("success", result.startsWith("TEXT_RCA_OK\n") && result.contains("\nANSWER="))
                }
                saveDiagnostic(if (response.getBoolean("success")) "TEXT_SUCCESS" else "TEXT_NATIVE_ERROR", result)
                promise.resolve(response)
            } catch (error: Throwable) {
                val diagnostic = throwableDiagnostic(error)
                saveDiagnostic("TEXT_JAVA_ERROR", diagnostic)
                promise.reject("LOCAL_AI_TEXT_NATIVE", diagnostic, error)
            }
        }
    }

    /** Temporary field diagnostic: prove text-only llama.cpp before libmtmd. */
    @ReactMethod
    fun runDiagnosticMode(qwen3ModelPath: String, visionModelPath: String, mmprojPath: String, imageBase64: String, promise: Promise) {
        executor.execute {
            try {
                saveDiagnostic("DIAGNOSTIC_START", "text-only -> multimodal\nqwen3=$qwen3ModelPath\nvision=$visionModelPath\nmmproj=$mmprojPath")
                val text = VisionPocBridge.runTextRca(qwen3ModelPath, "DIAGNOSTIC TEXT-ONLY: reply with the single word OK.", NativeProgress(::emitPhase))
                saveDiagnostic("DIAGNOSTIC_TEXT_RESULT", text)
                if (!text.startsWith("TEXT_RCA_OK\n")) {
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("textSuccess", false)
                        putBoolean("visionSuccess", false)
                        putString("text", text)
                        putString("vision", "SKIPPED_TEXT_ONLY_FAILED")
                    })
                    return@execute
                }
                val imageBytes = Base64.decode(imageBase64, Base64.DEFAULT)
                val vision = VisionPocBridge.runVisionPoc(visionModelPath, mmprojPath, imageBytes, NativeProgress(::emitPhase))
                saveDiagnostic("DIAGNOSTIC_VISION_RESULT", vision)
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("textSuccess", true)
                    putBoolean("visionSuccess", vision.startsWith("VISION_POC_OK\n"))
                    putString("text", text)
                    putString("vision", vision)
                })
            } catch (error: Throwable) {
                val diagnostic = throwableDiagnostic(error)
                saveDiagnostic("DIAGNOSTIC_JAVA_ERROR", diagnostic)
                promise.reject("LOCAL_AI_DIAGNOSTIC", diagnostic, error)
            }
        }
    }

    override fun invalidate() {
        VisionPocBridge.cancel()
        executor.shutdownNow()
        super.invalidate()
    }

    companion object {
        const val NAME = "PumpRcaLocalAI"
    }
}
