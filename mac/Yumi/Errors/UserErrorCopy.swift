import enum YumiProtocol.ErrorKind

/// The user-facing error copy, in the one place the app keeps it (SPEC-11 requirement 7).
///
/// Keyed by the protocol's `ErrorKind`, so the switch is exhaustive: a new kind in the protocol
/// fails the build here until it has copy. `UserErrorCopyTests` checks every entry against the
/// SPEC-11 table (and `blockedAction` against SPEC-07 requirement 5), word for word.
struct UserErrorCopy: Equatable, Sendable {
    /// Where the copy comes from: the SPEC-11 "Failure" column, or the SPEC-07 requirement.
    /// Never shown to the user.
    let source: Source
    /// What the user hears and sees. `{device}`, `{last action}`, `{permission}` and `{step}` are
    /// filled in by `ErrorPresenter`.
    let message: String
    /// Exactly as the spec lists them.
    let buttons: [String]

    enum Source: Equatable, Sendable {
        case spec11Row(String)
        case spec07Requirement5
    }

    static func copy(for kind: ErrorKind) -> UserErrorCopy {
        switch kind {
        case .otherDeviceOffline:
            row("Other device offline", "I can't reach {device} right now. It might be asleep or off the internet. I can run this as soon as it's back.", ["Run it when it's back", "Cancel"])
        case .otherDeviceBusy:
            row("Other device busy", "{device} is busy with another task. I'll start this right after.", ["Okay", "Cancel"])
        case .otherDeviceLocked:
            row("Other device locked (p1)", "{device} is awake but locked. Unlock it and I'll continue.", ["Okay", "Cancel"])
        case .bridgeDown:
            row("Bridge down", "I can't connect your phone and Mac right now because the connection between them is down. Things on this device still work.", ["Try again", "Work on this device only"])
        case .cannotPauseOtherDevice:
            row("Can't pause the other device", "I can't reach {device} to pause it. Use the stop shortcut on {device}.", ["Try again"])
        case .noReply:
            row("No reply", "{device} stopped answering while working on this. It might have gone to sleep.", ["Wait", "Cancel"])
        case .commandExpired:
            row("Command expired", "That request waited too long, so I didn't run it in case it's no longer what you want.", ["Run it now", "Cancel"])
        case .stepFailed:
            row("Couldn't finish a step", "I couldn't finish this step: {step}. I stopped there before anything else ran on top of it. I can try it again, skip it and keep going, or stop.", ["Try again", "Skip this step", "Stop"])
        case .stuckOnScreen:
            row("Stuck on screen", "I'm stuck. I tried a few times but couldn't find what I need on this screen. Can you show me, or should I stop?", ["I'll show you", "Skip this step", "Stop"])
        case .taskTookTooLong:
            row("Task took too long", "This is taking longer than it should, so I stopped. Here's what I finished so far.", ["Keep going", "Stop"])
        case .unsupportedRequest:
            row("Unsupported request", "I can't do that on {device}. Here's what I can do instead.", ["Depends on the request", "Cancel"])
        case .screenPermissionMissing:
            row("Screen permission missing (Mac)", "I need permission to see your screen before I can help with this.", ["Open settings", "Not now"])
        case .accessibilityPermissionMissing:
            row("Accessibility permission missing (Mac)", "I need permission to control your Mac before I can help with this.", ["Open settings", "Not now"])
        case .microphonePermissionMissing:
            row("Microphone permission missing", "I need permission to use the microphone so I can hear you.", ["Open settings", "Type instead"])
        case .androidPermissionMissing:
            row("Permission missing (Android)", "I need permission to use your {permission} for this.", ["Allow", "Not now"])
        case .androidAccessibilityServiceOff:
            row("Accessibility service off (Android, p1)", "I need you to turn on my accessibility access before I can use other apps on your phone.", ["Open settings", "Not now"])
        case .phoneTooHot:
            row("Phone too hot or battery low (p1)", "Your phone is getting hot, so I paused to let it cool down.", ["Keep going", "Stop"])
        case .languageNotSupported:
            row("Language not supported on this phone", "I can only understand English on this phone for now. Try saying it in English, or say it to your Mac.", ["Try again", "Type instead"])
        case .speechRecognitionNotSetUp:
            row("Speech recognition not set up on this phone", "I can't understand speech on this phone yet because its offline English speech pack isn't installed. Download it in your phone's speech settings, then try again.", ["Open settings", "Type instead"])
        case .didNotCatchSpeech:
            row("Didn't catch speech", "Sorry, I didn't catch that. Could you say it again?", ["Try again", "Type instead"])
        case .modelFailedToLoad:
            row("Model failed to load", "I couldn't start my brain on this device. Closing other apps usually helps.", ["Try again"])
        case .voiceFailedToLoad:
            row("Voice didn't load (Mac)", "I couldn't start my voice, so I'll stay quiet for now. Everything else still works. Closing other apps usually helps, then try again.", ["Try again", "Not now"])
        case .unpairedDevice:
            row("Unpaired device", "Your phone isn't paired with your Mac yet.", ["Pair now"])
        case .pairingCodeExpired:
            row("Pairing code expired", "That pairing code expired. Codes only last a few minutes to keep your devices safe. Show a new code on your Mac and scan it again.", ["Scan again", "Cancel"])
        case .notAPairingCode:
            row("Not a pairing code", "That doesn't look like a Yumi pairing code. On your Mac, open Yumi and show the pairing code, then scan it again.", ["Scan again", "Cancel"])
        case .pairingVersionsDiffer:
            row("Pairing versions differ", "Yumi on your phone and your Mac are different versions, so they can't pair yet. Update Yumi on both, then try again.", ["Okay"])
        case .macDidNotAnswerPairing:
            row("Mac didn't answer pairing", "Your Mac didn't answer, so pairing didn't finish. Make sure Yumi is open on your Mac and showing a new code, then scan it again.", ["Scan again", "Cancel"])
        case .unexpected:
            row("Unexpected", "Something went wrong and I stopped to be safe. Here's the last thing I did: {last action}.", ["Show what I did", "Try again", "Stop"])
        case .blockedAction:
            UserErrorCopy(
                source: .spec07Requirement5,
                message: "I can't do that. It's blocked to keep your Mac safe, so I skipped it. Want me to keep going with the rest?",
                buttons: ["Keep going", "Stop"]
            )
        }
    }

    /// SPEC-11 "Unexpected" before Yumi has done anything in the task: the second sentence and
    /// "Show what I did" are dropped (scenario "Unexpected error before any action").
    static let unexpectedBeforeAnyAction = UserErrorCopy(
        source: .spec11Row("Unexpected"),
        message: "Something went wrong and I stopped to be safe.",
        buttons: ["Try again", "Stop"]
    )

    private static func row(_ name: String, _ message: String, _ buttons: [String]) -> UserErrorCopy {
        UserErrorCopy(source: .spec11Row(name), message: message, buttons: buttons)
    }
}
