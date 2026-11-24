package com.app.pumprcamobile.localai

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.app.pumprcamobile.MainApplication

class LocalAiPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        (reactContext.applicationContext as? MainApplication)?.recordStartupStage("PUMPRCA_LOCAL_AI_CREATE_MODULE")
        val module = LocalAiModule(reactContext)
        (reactContext.applicationContext as? MainApplication)?.recordStartupStage("PUMPRCA_LOCAL_AI_MODULE_READY")
        return listOf(module)
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
