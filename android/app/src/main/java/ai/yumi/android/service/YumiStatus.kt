package ai.yumi.android.service

import ai.yumi.android.protocol.ConnectionState

/** What the home screen and the notification show about Yumi. */
data class YumiStatus(
    val serviceRunning: Boolean = false,
    val connection: ConnectionState = ConnectionState.NotPaired,
    val wakeWordListening: Boolean = false,
)
