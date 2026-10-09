package ai.yumi.android.errors

/** A button on an error. [label] is the SPEC-11 label, which is also what the user can say to press it. */
enum class ErrorButton(val label: String) {
    RunWhenBack("Run it when it's back"),
    Cancel("Cancel"),
    Okay("Okay"),
    TryAgain("Try again"),
    WorkOnThisDeviceOnly("Work on this device only"),
    Wait("Wait"),
    RunNow("Run it now"),
    IllShowYou("I'll show you"),
    SkipThisStep("Skip this step"),
    Stop("Stop"),
    KeepGoing("Keep going"),

    /** Stands for the request-specific alternatives; the presenter replaces it with one button per alternative. */
    Alternatives("Depends on the request"),
    OpenSettings("Open settings"),
    NotNow("Not now"),
    TypeInstead("Type instead"),
    Allow("Allow"),
    PairNow("Pair now"),
    ScanAgain("Scan again"),
    ShowWhatIDid("Show what I did"),
}

data class ErrorCopy(val text: String, val buttons: List<ErrorButton>)

/**
 * The SPEC-11 error copy, the single place it lives in code (SPEC-11 requirement 7).
 * `ErrorCopySpecTest` fails if this drifts from the table in specs/11-user-facing-errors.md.
 *
 * Placeholders: `{device}` is the other device, `{last action}` is the last thing Yumi did,
 * `{permission}` is the plain name of a permission, such as "location", and `{step}` is the step that could not finish.
 */
object ErrorCopyTable {
    val copy: Map<ErrorKind, ErrorCopy> = mapOf(
        ErrorKind.OtherDeviceOffline to ErrorCopy(
            "I can't reach {device} right now. It might be asleep or off the internet. I can run this as soon as it's back.",
            listOf(ErrorButton.RunWhenBack, ErrorButton.Cancel),
        ),
        ErrorKind.OtherDeviceBusy to ErrorCopy(
            "{device} is busy with another task. I'll start this right after.",
            listOf(ErrorButton.Okay, ErrorButton.Cancel),
        ),
        ErrorKind.OtherDeviceLocked to ErrorCopy(
            "{device} is awake but locked. Unlock it and I'll continue.",
            listOf(ErrorButton.Okay, ErrorButton.Cancel),
        ),
        ErrorKind.BridgeDown to ErrorCopy(
            "I can't connect your phone and Mac right now because the connection between them is down. Things on this device still work.",
            listOf(ErrorButton.TryAgain, ErrorButton.WorkOnThisDeviceOnly),
        ),
        ErrorKind.CantPauseOtherDevice to ErrorCopy(
            "I can't reach {device} to pause it. Use the stop shortcut on {device}.",
            listOf(ErrorButton.TryAgain),
        ),
        ErrorKind.NoReply to ErrorCopy(
            "{device} stopped answering while working on this. It might have gone to sleep.",
            listOf(ErrorButton.Wait, ErrorButton.Cancel),
        ),
        ErrorKind.CommandExpired to ErrorCopy(
            "That request waited too long, so I didn't run it in case it's no longer what you want.",
            listOf(ErrorButton.RunNow, ErrorButton.Cancel),
        ),
        ErrorKind.StepFailed to ErrorCopy(
            "I couldn't finish this step: {step}. I stopped there before anything else ran on top of it. " +
                "I can try it again, skip it and keep going, or stop.",
            listOf(ErrorButton.TryAgain, ErrorButton.SkipThisStep, ErrorButton.Stop),
        ),
        ErrorKind.StuckOnScreen to ErrorCopy(
            "I'm stuck. I tried a few times but couldn't find what I need on this screen. Can you show me, or should I stop?",
            listOf(ErrorButton.IllShowYou, ErrorButton.SkipThisStep, ErrorButton.Stop),
        ),
        ErrorKind.TaskTookTooLong to ErrorCopy(
            "This is taking longer than it should, so I stopped. Here's what I finished so far.",
            listOf(ErrorButton.KeepGoing, ErrorButton.Stop),
        ),
        ErrorKind.UnsupportedRequest to ErrorCopy(
            "I can't do that on {device}. Here's what I can do instead.",
            listOf(ErrorButton.Alternatives, ErrorButton.Cancel),
        ),
        ErrorKind.ScreenPermissionMissingMac to ErrorCopy(
            "I need permission to see your screen before I can help with this.",
            listOf(ErrorButton.OpenSettings, ErrorButton.NotNow),
        ),
        ErrorKind.AccessibilityPermissionMissingMac to ErrorCopy(
            "I need permission to control your Mac before I can help with this.",
            listOf(ErrorButton.OpenSettings, ErrorButton.NotNow),
        ),
        ErrorKind.MicrophonePermissionMissing to ErrorCopy(
            "I need permission to use the microphone so I can hear you.",
            listOf(ErrorButton.OpenSettings, ErrorButton.TypeInstead),
        ),
        ErrorKind.PermissionMissingAndroid to ErrorCopy(
            "I need permission to use your {permission} for this.",
            listOf(ErrorButton.Allow, ErrorButton.NotNow),
        ),
        ErrorKind.AccessibilityServiceOffAndroid to ErrorCopy(
            "I need you to turn on my accessibility access before I can use other apps on your phone.",
            listOf(ErrorButton.OpenSettings, ErrorButton.NotNow),
        ),
        ErrorKind.PhoneTooHotOrBatteryLow to ErrorCopy(
            "Your phone is getting hot, so I paused to let it cool down.",
            listOf(ErrorButton.KeepGoing, ErrorButton.Stop),
        ),
        ErrorKind.LanguageNotSupported to ErrorCopy(
            "I can only understand English on this phone for now. Try saying it in English, or say it to your Mac.",
            listOf(ErrorButton.TryAgain, ErrorButton.TypeInstead),
        ),
        ErrorKind.DidntCatchSpeech to ErrorCopy(
            "Sorry, I didn't catch that. Could you say it again?",
            listOf(ErrorButton.TryAgain, ErrorButton.TypeInstead),
        ),
        ErrorKind.ModelFailedToLoad to ErrorCopy(
            "I couldn't start my brain on this device. Closing other apps usually helps.",
            listOf(ErrorButton.TryAgain),
        ),
        ErrorKind.UnpairedDevice to ErrorCopy(
            "Your phone isn't paired with your Mac yet.",
            listOf(ErrorButton.PairNow),
        ),
        ErrorKind.PairingCodeExpired to ErrorCopy(
            "That pairing code expired. Codes only last a few minutes to keep your devices safe. Show a new code on your Mac and scan it again.",
            listOf(ErrorButton.ScanAgain, ErrorButton.Cancel),
        ),
        ErrorKind.NotAPairingCode to ErrorCopy(
            "That doesn't look like a Yumi pairing code. On your Mac, open Yumi and show the pairing code, then scan it again.",
            listOf(ErrorButton.ScanAgain, ErrorButton.Cancel),
        ),
        ErrorKind.PairingVersionsDiffer to ErrorCopy(
            "Yumi on your phone and your Mac are different versions, so they can't pair yet. Update Yumi on both, then try again.",
            listOf(ErrorButton.Okay),
        ),
        ErrorKind.MacDidntAnswerPairing to ErrorCopy(
            "Your Mac didn't answer, so pairing didn't finish. Make sure Yumi is open on your Mac and showing a new code, then scan it again.",
            listOf(ErrorButton.ScanAgain, ErrorButton.Cancel),
        ),
        ErrorKind.Unexpected to ErrorCopy(
            "Something went wrong and I stopped to be safe. Here's the last thing I did: {last action}.",
            listOf(ErrorButton.ShowWhatIDid, ErrorButton.TryAgain, ErrorButton.Stop),
        ),
    )

    fun of(kind: ErrorKind): ErrorCopy = copy.getValue(kind)
}
