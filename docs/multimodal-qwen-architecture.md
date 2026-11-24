# PumpRCA: рабочая multimodal-архитектура на Android

## Статус

На этом этапе APK не переделывается. Технический APK `AI Chat basic sample` не является полноценным PumpRCA и не должен использоваться как финальная сборка.

## Целевая схема

```text
Фото / видео
    |
    v
Локальная подготовка медиа
- фото: JPEG <= 1024 px, quality 80
- видео: кадры с timestamp, максимум 20 кадров
    |
    v
Qwen2.5-VL-3B-Instruct Q4_K_M + mmproj
- реальный image understanding
- OCR / видимые дефекты / локализация
- confidence и список неизвестного
    |
    v
Структурированный visual evidence JSON
    |
    v
Qwen3-4B-Q4_K_M
- текстовый RCA
- 4 обязательных блока
- SMART-мероприятия
- строгое разделение фактов и гипотез
    |
    v
Полный существующий PumpRCA UI
- кейсы, evidence, аннотации, теги, PDF, чат, cache-only
```

## Vision-модель: рекомендуемый локальный вариант

**Qwen2.5-VL-3B-Instruct-GGUF** от `ggml-org`.

Файлы:

- `Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf`: 1.930 GB;
- `mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf`: 0.845 GB;
- суммарно только веса: примерно 2.775 GB, без runtime, KV cache и временных буферов.

Почему она выбрана:

- llama.cpp официально перечисляет Qwen2.5-VL-3B в списке поддерживаемых vision GGUF;
- llama.cpp `libmtmd` принимает изображение, аудио и видео и работает с отдельным `mmproj`;
- исходная модель заявляет image/video understanding, OCR, визуальную локализацию и structured output;
- 3B — более реалистичный размер для телефона, чем 7B/32B.

Официальные источники:

- [Qwen2.5-VL-3B-Instruct-GGUF](https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF)
- [Qwen2.5-VL-3B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct)
- [llama.cpp multimodal](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)
- [llama.cpp libmtmd](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md)

## RCA-модель

**Qwen3-4B-Q4_K_M.gguf** остаётся отдельной text-only моделью для reasoning/RCA:

- размер примерно 2.5 GB;
- она получает только текстовый контекст и JSON visual evidence;
- приложение не будет утверждать, что Qwen3 видит фото;
- визуальные выводы будут помечаться источником `VISION_MODEL`, а текстовые RCA-выводы — `RCA_MODEL`.

## Управление RAM

Обе модели не должны быть загружены одновременно по умолчанию.

1. Загружается vision-модель.
2. Анализируются фото или выбранные кадры видео.
3. Vision-модель выгружается.
4. Загружается Qwen3-4B.
5. Выполняется RCA по structured evidence.
6. Qwen3 выгружается после завершения, если пользователь не включил текстовый чат.

Фактический peak RAM и скорость должны быть измерены на Samsung S25 Ultra через ADB. Теоретическая оценка не будет выдаваться за подтверждённую совместимость.

## Видео-пайплайн

- исходный ролик не отправляется в Qwen3;
- приложение извлекает кадры с timestamp;
- для короткого ролика — примерно 1 кадр в 1–2 секунды;
- для длинного — равномерная выборка, максимум 20 кадров на один vision-анализ;
- каждый кадр передаётся в vision runtime как реальное изображение;
- модель возвращает наблюдения по кадру и timestamp;
- RCA получает только агрегированный JSON с наблюдениями, уверенностью и неизвестными.

## Контракт visual evidence

```json
{
  "source": "VISION_MODEL",
  "mediaId": "evidence-123",
  "observations": [
    {
      "timestampMs": 4200,
      "finding": "следы задиров на видимой поверхности",
      "location": "наружное кольцо подшипника",
      "status": "OBSERVED",
      "confidence": 0.71
    }
  ],
  "notVisible": ["внутреннее состояние посадочного места"],
  "nextChecks": ["осмотр после демонтажа", "замер вибрации и температуры"]
}
```

Модель не должна писать `CONFIRMED` для того, что нельзя определить по изображению. Финальный RCA всё равно требует подтверждения инженером.

## Почему не Qwen3-VL-4B как первый вариант

Qwen3-VL-4B также имеет GGUF и mmproj, примерно 2.497 GB + 0.454 GB. Но для первого Android runtime безопаснее Qwen2.5-VL-3B: она явно присутствует в текущем официальном списке multimodal-моделей llama.cpp и имеет более проверенный путь интеграции через libmtmd. Qwen3-VL можно оставить вторым профилем после успешного device benchmark.

## Более лёгкая альтернатива

SmolVLM-500M Q8 + mmproj примерно 0.437 + 0.109 GB. Она существенно легче и пригодна для on-device image understanding, но официальная карточка указывает английскую языковую ориентацию и меньшую пригодность для русскоязычного промышленного RCA. Это fallback для устройств с низкой свободной RAM, а не основной выбор.

## Технический блокер текущего APK

Текущий native APK — это отдельный официальный sample экран с `MainActivity`, а не Expo PumpRCA. Его `InferenceEngine` предоставляет text-only методы `loadModel`, `setSystemPrompt` и `sendUserPrompt`; multimodal `libmtmd` JNI API ещё не подключён. Поэтому просто заменить имя GGUF недостаточно.

Чтобы сохранить полный UI, потребуется:

1. оставить текущий Expo PumpRCA UI без удаления функций;
2. создать custom Android build / Expo native module;
3. добавить JNI bridge для `libmtmd` и двух runtime-профилей;
4. подключить bridge к существующему local provider;
5. добавить реальные image tensors/frames, а не URI или metadata;
6. провести device smoke test на S25 Ultra;
7. только после этого выпустить новый APK.

До выполнения этих шагов нельзя честно заявлять, что APK одновременно сохраняет PumpRCA и реально анализирует фото/видео локально.
