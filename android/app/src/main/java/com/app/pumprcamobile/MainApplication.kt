package com.app.pumprcamobile

import android.app.Application
import android.content.res.Configuration
import android.util.Log

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper
import com.app.pumprcamobile.localai.LocalAiPackage

class MainApplication : Application(), ReactApplication {
  @Volatile private var reactNativeInitialized = false

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> {
          recordStartupStage("RN_AUTOLINKED_PACKAGES")
          return PackageList(this).packages.apply {
            recordStartupStage("PUMPRCA_LOCAL_AI_PACKAGE_REGISTER")
            add(LocalAiPackage())
            recordStartupStage("RN_PACKAGES_READY")
          }
        }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        saveCrash(error, thread.name)
      } catch (storageError: Throwable) {
        Log.e("PumpRcaStartup", "Unable to persist uncaught Throwable", storageError)
      }
      previousHandler?.uncaughtException(thread, error)
    }
    // React Native can fail before the launcher Activity is visible. Initialize
    // it from StartupActivity instead so the next launch can show a diagnosis.
  }

  fun recordStartupStage(stage: String) {
    getSharedPreferences("pumprca.startup", MODE_PRIVATE).edit()
      .putString("stage", stage).commit()
  }

  fun saveCrash(error: Throwable, threadName: String) {
    val prefs = getSharedPreferences("pumprca.startup", MODE_PRIVATE)
    prefs.edit()
      .putString("error_class", error.javaClass.name)
      .putString("error_message", error.message ?: "")
      .putString("error_stack", Log.getStackTraceString(error))
      .putString("error_thread", threadName)
      .putString("error_stage", prefs.getString("stage", "UNKNOWN"))
      .putLong("error_at", System.currentTimeMillis())
      .commit()
  }

  @Synchronized fun initializeReactNative() {
    if (reactNativeInitialized) return
    recordStartupStage("REACT_NATIVE_ENTRYPOINT")
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    recordStartupStage("EXPO_APPLICATION_LIFECYCLE")
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
    recordStartupStage("REACT_NATIVE_INITIALIZED")
    reactNativeInitialized = true
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
