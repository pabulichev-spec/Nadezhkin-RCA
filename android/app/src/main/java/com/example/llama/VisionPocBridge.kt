package com.example.llama

fun interface NativeProgress {
    fun onPhase(phase: String)
}

object VisionPocBridge {
    @Volatile private var loaded = false

    private fun ensureLoaded() {
        if (!loaded) synchronized(this) {
            if (!loaded) {
                System.loadLibrary("ai-chat")
                loaded = true
            }
        }
    }

    fun runVisionPoc(
        visionModelPath: String,
        mmprojPath: String,
        imageBytes: ByteArray,
        progress: NativeProgress,
    ): String {
        ensureLoaded()
        return nativeRunVisionPoc(visionModelPath, mmprojPath, imageBytes, progress)
    }

    fun runTextRca(qwen3ModelPath: String, prompt: String, progress: NativeProgress): String {
        ensureLoaded()
        return nativeRunTextRca(qwen3ModelPath, prompt, progress)
    }

    fun cancel() {
        if (loaded) nativeCancel()
    }

    private external fun nativeRunVisionPoc(
        visionModelPath: String,
        mmprojPath: String,
        imageBytes: ByteArray,
        progress: NativeProgress,
    ): String

    private external fun nativeRunTextRca(
        qwen3ModelPath: String,
        prompt: String,
        progress: NativeProgress,
    ): String

    private external fun nativeCancel()
}
