package com.example.llama

import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private var visionPath: String? = null
    private var mmprojPath: String? = null
    private var qwen3Path: String? = null
    private var imageBytes: ByteArray? = null
    private var visionUri: String? = null
    private var mmprojUri: String? = null
    private var qwen3Uri: String? = null
    private var imageUri: String? = null

    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@registerForActivityResult
        val request = pendingRequest
        lifecycleScope.launch(Dispatchers.IO) {
            when (request) {
                Request.VISION -> { visionUri = uri.toString(); visionPath = copyToPrivate(uri, "Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf") }
                Request.MMPROJ -> { mmprojUri = uri.toString(); mmprojPath = copyToPrivate(uri, "mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf") }
                Request.QWEN3 -> { qwen3Uri = uri.toString(); qwen3Path = copyToPrivate(uri, "Qwen3-4B-Q4_K_M.gguf") }
                Request.IMAGE -> { imageUri = uri.toString(); imageBytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                null -> Unit
            }
            withContext(Dispatchers.Main) { refreshStatus() }
        }
    }
    private var pendingRequest: Request? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(28, 36, 28, 28) }
        val title = TextView(this).apply { text = "PumpRCA multimodal PoC — diagnostics"; textSize = 22f }
        status = TextView(this).apply { textSize = 14f; setPadding(0, 18, 0, 18) }
        root.addView(title)
        root.addView(status)
        root.addView(button("1. Выбрать Qwen2.5-VL-3B GGUF") { choose(Request.VISION) })
        root.addView(button("2. Выбрать mmproj GGUF") { choose(Request.MMPROJ) })
        root.addView(button("3. Выбрать Qwen3-4B GGUF") { choose(Request.QWEN3) })
        root.addView(button("4. Выбрать локальное изображение") { choose(Request.IMAGE) })
        root.addView(button("Запустить диагностику загрузки") { runPoc() })
        setContentView(ScrollView(this).apply { addView(root) })
        refreshStatus()
    }

    private fun button(label: String, click: () -> Unit) = Button(this).apply { text = label; setOnClickListener { click() } }
    private fun choose(request: Request) {
        pendingRequest = request
        picker.launch(arrayOf(if (request == Request.IMAGE) "image/*" else "*/*"))
    }
    private fun copyToPrivate(uri: Uri, filename: String): String {
        val target = File(filesDir, "vision-poc/$filename").also { it.parentFile?.mkdirs() }
        contentResolver.openInputStream(uri)!!.use { input -> target.outputStream().use { output -> input.copyTo(output) } }
        require(target.isFile && target.length() > 0) { "Copied file is empty: ${target.absolutePath}" }
        return target.absolutePath
    }
    private fun fileLine(label: String, uri: String?, path: String?): String {
        val file = path?.let(::File)
        return "$label\n  contentUri=${uri ?: "-"}\n  localPath=${path ?: "-"}\n  localSizeBytes=${file?.length() ?: 0}\n  readable=${file?.canRead() == true}"
    }
    private fun refreshStatus() {
        status.text = listOf(
            fileLine("VISION", visionUri, visionPath),
            fileLine("MMPROJ", mmprojUri, mmprojPath),
            fileLine("QWEN3", qwen3Uri, qwen3Path),
            "IMAGE\n  contentUri=${imageUri ?: "-"}\n  bytes=${imageBytes?.size ?: 0}",
        ).joinToString("\n\n")
    }
    private fun runPoc() {
        val vision = visionPath; val mmproj = mmprojPath; val qwen3 = qwen3Path; val image = imageBytes
        if (vision == null || mmproj == null || qwen3 == null || image == null) {
            Toast.makeText(this, "Выберите все 3 модели и изображение", Toast.LENGTH_LONG).show(); return
        }
        status.text = "Диагностика: сначала загрузка Qwen2.5-VL и mmproj…\nПуть передан native: $vision"
        lifecycleScope.launch(Dispatchers.Default) {
            val result = VisionPocBridge.runVisionPoc(vision, mmproj, qwen3, image)
            withContext(Dispatchers.Main) { status.text = result }
        }
    }

    private enum class Request { VISION, MMPROJ, QWEN3, IMAGE }
}
