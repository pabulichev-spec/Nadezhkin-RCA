# Android multimodal PoC — статус

## Что уже доказано сборкой

- Android project собирается с NDK `29.0.13113456`.
- `libmtmd` подключён как native target.
- JNI bridge `VisionPocBridge.runVisionPoc(...)` собран.
- Native code содержит реальные вызовы:
  - `llama_model_load_from_file()` для Qwen2.5-VL;
  - `mtmd_init_from_file()` для mmproj;
  - `mtmd_helper_bitmap_init_from_buf()` для декодирования байтов изображения в bitmap;
  - `mtmd_tokenize()` с media chunk;
  - `mtmd_helper_eval_chunks()` для image encode/decode;
  - генерацию ответа vision-модели;
  - освобождение vision context/model;
  - повторную загрузку Qwen3-4B и передачу visual evidence текстом.
- Сборка debug APK завершилась успешно.

## Что ещё НЕ доказано

Фактический Android runtime smoke test ещё не выполнен. Поэтому нельзя пока утверждать, что именно Qwen2.5-VL на Samsung S25 Ultra успешно загрузил mmproj, обработал bitmap и вернул описание.

## Конкретный блокер

Команда:

```text
adb devices -l
```

вернула:

```text
List of devices attached
```

без устройств. Дополнительно в Sandbox отсутствуют следующие большие файлы:

- `Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf`;
- `mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf`;
- `Qwen3-4B-Q4_K_M.gguf`.

Есть только тестовое локальное изображение из пользовательского вложения.

## Как завершить runtime-проверку

1. Установить APK на Samsung S25 Ultra.
2. Скачать на телефон:
   - `Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf`;
   - `mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf`;
   - `Qwen3-4B-Q4_K_M.gguf`.
3. Открыть `PumpRCA multimodal PoC`.
4. Выбрать три GGUF и одно изображение.
5. Нажать `Запустить реальный vision PoC`.
6. Успешный результат обязан содержать одновременно:

```text
VISION_POC_OK
MMPROJ=loaded
BITMAP=decoded_and_encoded
VISION_ANSWER=...
VISION_UNLOADED=true
QWEN3_LOADED=true
QWEN3_EVIDENCE_HANDOFF=...
```

Любая строка `POC_ERROR` означает, что интеграцию в полный PumpRCA начинать нельзя.

## Важное ограничение

Основной PumpRCA UI намеренно не изменён. Текущий APK — отдельный технический PoC и не является заменой полноценного приложения.
