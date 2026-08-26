// Copyright © 2026 Insurely AB. All rights reserved.

package com.insurely.blocks.rn

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import java.util.HashMap

class InsurelyHttpPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == InsurelyHttpModule.NAME) {
      InsurelyHttpModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      InsurelyHttpModule.NAME to ReactModuleInfo(
        name = InsurelyHttpModule.NAME,
        className = InsurelyHttpModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }
}
