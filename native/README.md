# PumpRCA local Android inference prototype

Native prototype now targets exactly `Qwen3-4B-Q4_K_M.gguf` and loads it through the official `llama.cpp/examples/llama.android` binding. The Android Activity rejects other architectures, copies the selected GGUF into app-private storage under the canonical filename, loads it on startup when already present, applies a Russian RCA system prompt, and generates locally through `InferenceEngine.sendUserPrompt`.

## Model

- File: `Qwen3-4B-Q4_K_M.gguf`
- Official source: `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true`
- License: Apache-2.0
- Approximate download size: 2.5 GB
- Architecture: `qwen3`
- Modality: text-only. The Qwen3-4B base model does not see photos or video. Media must be converted to text by a separate local OCR/transcription pipeline before being sent to this model.

## Get the model

From a development machine:

```bash
./native/download-qwen.sh ./models
```

On Android, use the prototype's folder picker and select the exact GGUF file. The app validates GGUF metadata and accepts only Qwen3 architecture, then stores it at `files/models/Qwen3-4B-Q4_K_M.gguf`. On the next launch it loads that file automatically.

## Build

The checked-in Android example is backed by the official llama.cpp source tree under `native/llama.cpp`. Build with Android SDK/NDK and JDK 17:

```bash
cd native/llama.cpp/examples/llama.android
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > local.properties
./gradlew assembleDebug --no-daemon
```

The build targets `arm64-v8a` and includes the JNI bridge. No cloud model or Manus API is used by this native prototype.

## Smoke test

Install the APK on the target Android phone, select the Qwen GGUF once, wait for the status `Локальная модель готова`, then send a Russian text question. The response must come from `InferenceEngine.sendUserPrompt`; an empty response, unsupported architecture, OOM, or Android process kill is a failed test.

`native/smoke-test.sh` remains available for CLI/ADB measurements. Record device model, Android API, available storage, model load time, peak RSS, prompt tokens/sec, generation tokens/sec, and backend logs. UI integration into the Expo RCA screen must happen only after this real-device smoke test.
