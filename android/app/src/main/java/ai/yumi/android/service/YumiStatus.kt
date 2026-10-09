package ai.yumi.android.service

import ai.yumi.android.protocol.ConnectionState

/** What the home screen and the notification show about Yumi. */
data class YumiStatus(
    val serviceRunning: Boolean = false,
    val connection: ConnectionState = ConnectionState.NotPaired,
    val wakeWordListening: Boolean = false,
    /** The microphone is on for a goal, after the mic button or the wake word. */
    val voiceListening: Boolean = false,
    /** A delegated goal is running on the Mac, including the moment after Stop until the Mac confirms (SPEC-09 r9, r12). */
    val goalWorking: Boolean = false,
    /** The Mac confirmed the pause, so Resume and Cancel are offered (SPEC-09 r12). */
    val goalPaused: Boolean = false,
    /** The latest `progress` subtask title, shown on the home screen and the notification. */
    val goalSubtask: String? = null,
)
