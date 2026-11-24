# Бесплатные AI-маршруты: проверка 2026-11-01

Источники:
- https://openrouter.ai/docs/guides/overview/multimodal/overview
- https://openrouter.ai/docs/guides/overview/models
- https://openrouter.ai/collections/free-models

Подтверждено документацией OpenRouter:
- Единый chat completions API поддерживает изображения, PDF, audio и video; для изображений используется image_url, для PDF — file, для video — video_url.
- Локальные файлы передаются base64 data URL. URL-файлы эффективнее для больших объектов.
- Не все модели поддерживают каждую модальность; проверять нужно архитектуру модели и supported_parameters в Models API.
- Models API отдаёт input_modalities, output_modalities, pricing и supported_parameters. Нулевая цена должна быть проверена по всем применимым полям, а не только по prompt/completion.

Живой публичный реестр на момент проверки без inference-запросов:
- dots-studio/dots-3-note-preview:free — text+image -> text, 512k context, response_format и structured_outputs, prompt/completion 0.
- liquid/lfm-2.5-2.6b:free — text -> text, 65k context, structured_outputs/response_format, prompt/completion 0.
- xingchen-agi/xing4.0-29b-a4b:free — text -> text, 262k context, structured_outputs/response_format, prompt/completion 0.
- nvidia/nemotron-3.5-lightning:free — text -> text, 1M context, prompt/completion 0, но structured output в текущем registry не заявлен.
- nvidia/nemotron-3.5-super-vl:free — text+image+video -> text, 1M context, response_format/structured_outputs, prompt/completion 0.
- nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free — text+audio+image+video -> text, 256k context, prompt/completion 0, но structured output в текущем registry не заявлен.
- google/gemma-4-26b-a4b-it:free и google/gemma-4-31b-it:free — text+image+video -> text, structured output, prompt/completion 0, но текущая политика PumpRCA исключает Google-маршруты.

Текущий проектный allowlist уже исключает OpenAI/Anthropic/Google и требует exact allowlist + zero pricing. Поэтому для RCA следует оставить structured text routes, добавить текущий NVIDIA Nemotron 3.5 Super VL в vision/video pool, использовать Dots3 для photo fallback, а документы передавать через file content только при прохождении capability/cost checks. Реальную доступность квот нельзя гарантировать по registry; inference smoke test не выполнялся в ходе этой проверки.
