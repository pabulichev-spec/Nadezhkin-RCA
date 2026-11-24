# GitHub Actions: Android Release APK

Workflow: `.github/workflows/android-release.yml`

Он выполняет:

1. Устанавливает Node.js 20, pnpm 9.12, JDK 17 и Android SDK.
2. Устанавливает Android API 35, Build Tools 35.0.0 и NDK 27.1.12297006.
3. Устанавливает зависимости через `pnpm install --frozen-lockfile`.
4. Генерирует native-проект командой `expo prebuild --platform android --clean --no-install`, потому что каталог `android/` намеренно исключён из Git.
5. Собирает `arm64-v8a` и `armeabi-v7a` Release APK с production defaults из приложения.
6. Проверяет package name `com.app.pumprcamobile`, application label `Надёжкин`, version `1.0.8`, versionCode `9`, наличие production API URL в JS bundle и считает SHA-256.
7. Публикует APK, badging и SHA-256 как GitHub Actions artifact на 30 дней.

## Подпись APK

Для APK, которым нужно обновлять уже установленную версию приложения, в GitHub Repository Settings → Secrets and variables → Actions добавьте secrets:

- `ANDROID_KEYSTORE_BASE64` — base64-содержимое release `.jks`/`.keystore`;
- `ANDROID_KEYSTORE_PASSWORD`;
- `ANDROID_KEY_ALIAS`;
- `ANDROID_KEY_PASSWORD`.

Закрытый ключ не добавляется в Git и не выводится в логи. Workflow временно записывает keystore только в runner и удаляет его вместе с runner после завершения job.

Если signing secrets не заданы, workflow всё равно выполняет CI-сборку с generated debug signing. Такой APK подходит для проверки установки и функциональности, но не должен использоваться для обновления production APK другой подписью.

## Запуск

После экспорта проекта в GitHub:

- любой push в `main`, затрагивающий исходники приложения или workflow, запускает сборку;
- ручной запуск доступен через GitHub Actions → Android Release APK → Run workflow.

В результате job скачайте artifact `nadezhkin-release-apk-<run_number>`. Файл `apk-sha256.txt` содержит контрольную сумму именно загруженного APK.

Workflow не публикует APK автоматически в Releases и не меняет production backend.
