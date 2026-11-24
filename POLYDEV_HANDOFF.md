# Передача проекта «Надёжкин» в PolyDev

## Версия передачи

Проект: `pump-rca-mobile`
Ветка: `main`
Git HEAD: `85a0a8ccf9658f44a6810bf032c540c89d263384`

Архив собран из актуальной рабочей директории и включает незакоммиченные изменения, перечисленные ниже. Git-история намеренно не включена.

## Состояние рабочего дерева

```text
[32mM[m  android/app/src/main/java/com/app/pumprcamobile/StartupActivity.kt
[32mM[m  android/app/src/main/res/drawable-hdpi/splashscreen_logo.png
[32mM[m  android/app/src/main/res/drawable-mdpi/splashscreen_logo.png
[32mM[m  android/app/src/main/res/drawable-xhdpi/splashscreen_logo.png
[32mM[m  android/app/src/main/res/drawable-xxhdpi/splashscreen_logo.png
[32mM[m  android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png
[32mM[m  android/app/src/main/res/mipmap-hdpi/ic_launcher.webp
[32mM[m  android/app/src/main/res/mipmap-hdpi/ic_launcher_background.webp
[32mM[m  android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp
[32mM[m  android/app/src/main/res/mipmap-hdpi/ic_launcher_monochrome.webp
[32mM[m  android/app/src/main/res/mipmap-hdpi/ic_launcher_round.webp
[32mM[m  android/app/src/main/res/mipmap-mdpi/ic_launcher.webp
[32mM[m  android/app/src/main/res/mipmap-mdpi/ic_launcher_background.webp
[32mM[m  android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp
[32mM[m  android/app/src/main/res/mipmap-mdpi/ic_launcher_monochrome.webp
[32mM[m  android/app/src/main/res/mipmap-mdpi/ic_launcher_round.webp
[32mM[m  android/app/src/main/res/mipmap-xhdpi/ic_launcher.webp
[32mM[m  android/app/src/main/res/mipmap-xhdpi/ic_launcher_background.webp
[32mM[m  android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp
[32mM[m  android/app/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.webp
[32mM[m  android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.webp
[32mM[m  android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp
[32mM[m  android/app/src/main/res/mipmap-xxhdpi/ic_launcher_background.webp
[32mM[m  android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp
[32mM[m  android/app/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.webp
[32mM[m  android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp
[32mM[m  android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp
[32mM[m  android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_background.webp
[32mM[m  android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp
[32mM[m  android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.webp
[32mM[m  android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp
[32mM[m  android/app/src/main/res/values/strings.xml
[32mM[m  android/settings.gradle
[32mM[m  app.config.ts
[32mM[m[31mM[m app/(tabs)/_layout.tsx
[32mA[m[31mM[m app/(tabs)/cases.tsx
[32mM[m[31mM[m app/(tabs)/index.tsx
[32mM[m  app/(tabs)/knowledge.tsx
[32mM[m  app/(tabs)/methodology.tsx
[32mM[m[31mM[m app/(tabs)/pumps.tsx
[32mM[m[31mM[m app/(tabs)/settings.tsx
[32mM[m[31mM[m app/(tabs)/usage.tsx
[32mM[m[31mM[m app/(tabs)/workspace.tsx
[32mM[m  assets/images/android-icon-background.png
[32mM[m  assets/images/android-icon-foreground.png
[32mM[m  assets/images/android-icon-monochrome.png
[32mM[m  assets/images/favicon.png
[32mM[m  assets/images/icon.png
[32mA[m  assets/images/nadezhkin-icon.png
[32mM[m  assets/images/splash-icon.png
[32mM[m  components/photo-annotation-editor.tsx
[32mM[m  components/rca-chat.tsx
[32mM[m  components/ui/icon-symbol.tsx
 [31mM[m dist-web/(tabs)/index.html
 [31mM[m dist-web/(tabs)/knowledge.html
 [31mM[m dist-web/(tabs)/methodology.html
 [31mM[m dist-web/(tabs)/pumps.html
 [31mM[m dist-web/(tabs)/settings.html
 [31mM[m dist-web/(tabs)/usage.html
 [31mM[m dist-web/(tabs)/workspace.html
 [31mM[m dist-web/+not-found.html
 [31mD[m dist-web/_expo/static/js/web/entry-a08df1585d35913c83c2895633ed28f5.js
 [31mM[m dist-web/_sitemap.html
 [31mM[m dist-web/dev/theme-lab.html
 [31mM[m dist-web/favicon.ico
 [31mM[m dist-web/index.html
 [31mM[m dist-web/knowledge.html
 [31mM[m dist-web/methodology.html
 [31mM[m dist-web/oauth/callback.html
 [31mM[m dist-web/pumps.html
 [31mM[m dist-web/settings.html
 [31mM[m dist-web/usage.html
 [31mM[m dist-web/workspace.html
[32mA[m  docs/free-ai-research-2026-11-01.md
[32mA[m  lib/domain-events.ts
[32mM[m  lib/domain-repository.ts
[32mM[m  lib/pumprca-transfer.ts
[32mM[m  lib/transport.ts
[32mM[m  server/ai/free-allowlist.ts
[32mM[m  server/ai/model-registry.ts
[32mM[m  server/ai/openrouter-provider.ts
[32mM[m  server/ai/rca-orchestrator.ts
[32mM[m  server/ai/rca-validator.ts
[32mM[m  server/ai/types.ts
[32mM[m  server/routers.ts
[32mM[m  server/storage.ts
[32mA[m  shared/ai-media.ts
[32mA[m  shared/cases.ts
[32mM[m  shared/domain/types.ts
[32mA[m  shared/equipment-metrics.ts
[32mM[m  shared/report.ts
[32mM[m  tests/ai-allowlist.test.ts
[32mM[m  tests/ai-gateway.test.ts
[32mA[m  tests/ai-media.test.ts
[32mA[m  tests/cases.test.ts
[32mM[m  tests/domain-repository.test.ts
[32mA[m  tests/equipment-metrics.test.ts
[32mM[m  tests/rca-ai-validation.test.ts
[32mM[m  tests/rca-orchestrator.test.ts
[32mM[m  tests/rca.utils.test.ts
[32mA[m  tests/report.test.ts
[32mA[m  tests/storage.test.ts
[32mM[m  tests/transport.test.ts
[32mM[m  theme.config.js
[31m??[m HANDOFF.md
[31m??[m dist-web/(tabs)/cases.html
[31m??[m dist-web/_expo/static/js/web/entry-676c111c5d344996eeacc94887b24f2b.js
[31m??[m dist-web/cases.html
[31m??[m nadezhkin-prototype.html
[31m??[m nadezhkin-pwa.html
```

## Основные компоненты

Android/Expo-клиент находится в `app/`, `components/`, `hooks/`, `lib/`, `assets/` и `android/`. Backend и API находятся в `server/`; AI Gateway, CostGuard, free-model allowlist и RCA pipeline — в `server/ai/`. Общие типы и доменная модель — в `shared/`; миграции — в `drizzle/`; тесты — в `tests/`; native Android/llama.cpp исходники — в `native/`.

## Запуск

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm lint
pnpm build:server
```

Для Android нужны JDK 17, Android SDK/NDK и настроенный signing в PolyDev. После настройки окружения: `cd android && ./gradlew assembleRelease`.

## Секреты

В архиве есть `.env.example` только с именами переменных и placeholder-значениями. Реальные ключи, пароли, токены, signing keys, пользовательские данные и `.env` не передавались. AI API keys должны быть настроены только как серверные secrets PolyDev, а не в APK.

## Исключения

Не включены `.git`, `node_modules`, `.expo`, `dist`, `dist-web`, Gradle/CMake build-кэши, APK/AAB, AI-модели, `.so/.a` binaries, logs, `android/local.properties`, `debug.keystore` и другие приватные ключи.
