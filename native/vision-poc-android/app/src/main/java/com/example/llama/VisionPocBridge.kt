package com.example.llama

object VisionPocBridge {
    init { System.loadLibrary("ai-chat") }

    external fun runVisionPoc(
        visionModelPath: String,
        mmprojPath: String,
        qwen3ModelPath: String,
        imageBytes: ByteArray,
    ): String
}
