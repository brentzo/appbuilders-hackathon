package ai.yumi.android

import ai.yumi.android.notifications.YumiNotifications
import android.app.Application

class YumiApplication : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        YumiNotifications.createChannels(this)
        graph = AppGraph(this)
    }
}
