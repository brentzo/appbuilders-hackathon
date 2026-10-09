package ai.yumi.android.voice

import ai.yumi.android.errors.YumiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** How a listening session was started. */
enum class VoiceTrigger { PushToTalk, WakeWord }

/** Push-to-talk behind the mic button, and listening after the wake word. */
interface VoiceInput {
    /** True only while the microphone is on. Drives the listening cat and the notification. */
    val listening: StateFlow<Boolean>

    /** True from [start] until the session ends, including the moments before and after the microphone is on. */
    val active: StateFlow<Boolean>

    /** What the recognizer has heard so far in this session, if anything. */
    val partial: StateFlow<String?>

    /** The last failure, with its SPEC-11 kind, until [clearFailure]. Present it with `ErrorPresenter`. */
    val failure: StateFlow<YumiException?>

    fun start(trigger: VoiceTrigger = VoiceTrigger.PushToTalk)

    /** Stops listening. What was heard so far is still transcribed. */
    fun stop()
    fun clearFailure()
}

/** Where every goal goes, spoken or typed. Routing (SPEC-09, SPEC-10 Part A) connects it. */
fun interface GoalSink {
    fun onGoal(text: String)
}

/** Stand-in until routing exists: keeps the last goal so the home screen can show it. */
class LastGoal : GoalSink {
    private val _text = MutableStateFlow<String?>(null)
    val text: StateFlow<String?> = _text.asStateFlow()
    override fun onGoal(text: String) { _text.value = text.trim().ifEmpty { null } }
}
