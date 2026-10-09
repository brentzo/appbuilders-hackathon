package ai.yumi.android.errors

/**
 * Every failure the user can see, one per row of the SPEC-11 error copy table.
 *
 * [specName] is the row's "Failure" column, word for word, so the copy test can match rows.
 * TEMPORARY: the structured error kinds will come from the protocol types (OBJ-01).
 * When they land, map them onto this enum in [ErrorPresenter] instead of duplicating it.
 */
enum class ErrorKind(val specName: String) {
    OtherDeviceOffline("Other device offline"),
    OtherDeviceBusy("Other device busy"),
    OtherDeviceLocked("Other device locked (p1)"),
    BridgeDown("Bridge down"),
    CantPauseOtherDevice("Can't pause the other device"),
    NoReply("No reply"),
    CommandExpired("Command expired"),
    StepFailed("Couldn't finish a step"),
    StuckOnScreen("Stuck on screen"),
    TaskTookTooLong("Task took too long"),
    UnsupportedRequest("Unsupported request"),
    ScreenPermissionMissingMac("Screen permission missing (Mac)"),
    AccessibilityPermissionMissingMac("Accessibility permission missing (Mac)"),
    MicrophonePermissionMissing("Microphone permission missing"),
    PermissionMissingAndroid("Permission missing (Android)"),
    AccessibilityServiceOffAndroid("Accessibility service off (Android, p1)"),
    PhoneTooHotOrBatteryLow("Phone too hot or battery low (p1)"),
    LanguageNotSupported("Language not supported on this phone"),
    SpeechRecognitionNotSetUp("Speech recognition not set up on this phone"),
    DidntCatchSpeech("Didn't catch speech"),
    ModelFailedToLoad("Model failed to load"),
    VoiceFailedToLoadMac("Voice didn't load (Mac)"),
    UnpairedDevice("Unpaired device"),
    PairingCodeExpired("Pairing code expired"),
    NotAPairingCode("Not a pairing code"),
    PairingVersionsDiffer("Pairing versions differ"),
    MacDidntAnswerPairing("Mac didn't answer pairing"),
    Unexpected("Unexpected"),
}

/** A failure Yumi knows how to explain. Throw this with a [kind]; anything else is shown as [ErrorKind.Unexpected]. */
class YumiException(
    val kind: ErrorKind,
    message: String? = null,
    cause: Throwable? = null,
) : Exception(message ?: kind.name, cause)
