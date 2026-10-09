package ai.yumi.android.service

import ai.yumi.android.protocol.ConnectionState

/** What the home screen and the notification show about Yumi. */
data class YumiStatus(
    val serviceRunning: Boolean = false,
    val connection: ConnectionState = ConnectionState.NotPaired,
    val wakeWordListening: Boolean = false,
    /** The microphone is on for a goal, after the mic button or the wake word. */
    val voiceListening: Boolean = false,
)
