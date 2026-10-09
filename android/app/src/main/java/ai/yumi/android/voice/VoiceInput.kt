package ai.yumi.android.voice

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Push-to-talk behind the mic button. OBJ-24 provides the real on-device recognizer. */
interface VoiceInput {
    /** True only while the microphone is on. Drives the listening cat. */
    val listening: StateFlow<Boolean>
    fun start()
    fun stop()
}

/** Where every goal goes, spoken or typed. OBJ-24 hands transcripts here; routing objectives connect it. */
fun interface GoalSink {
    fun onGoal(text: String)
}

/**
 * Stand-in until OBJ-24: switches the cat to listening and back, without opening the microphone.
 */
class StandInVoiceInput : VoiceInput {
    private val _listening = MutableStateFlow(false)
    override val listening: StateFlow<Boolean> = _listening.asStateFlow()
    override fun start() { _listening.value = true }
    override fun stop() { _listening.value = false }
}

/** Stand-in until routing exists: keeps the last goal so the home screen can show it. */
class LastGoal : GoalSink {
    private val _text = MutableStateFlow<String?>(null)
    val text: StateFlow<String?> = _text.asStateFlow()
    override fun onGoal(text: String) { _text.value = text.trim().ifEmpty { null } }
}
