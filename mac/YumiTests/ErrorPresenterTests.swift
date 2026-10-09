import Foundation
import Testing
import YumiProtocol
@testable import Yumi

struct ErrorPresenterTests {
    @Test func screenPermissionScenario() {
        // SPEC-11 "Missing screen permission": the copy appears and "Open settings" opens the
        // Screen Recording pane (the pane URL is checked in PermissionCenterTests).
        let presented = ErrorPresenter.present(UserError(kind: .screenPermissionMissing))
        #expect(presented.message == "I need permission to see your screen before I can help with this.")
        #expect(presented.buttons == [
            ErrorButton(label: "Open settings", action: .openSettings(.screenRecording)),
            ErrorButton(label: "Not now", action: .dismiss),
        ])
    }

    @Test func unexpectedNamesTheLastAction() {
        // SPEC-11 "Unexpected error uses generic copy".
        let presented = ErrorPresenter.present(UserError(kind: .unexpected, lastAction: "Clicked Export in Keynote"))
        #expect(presented.message == "Something went wrong and I stopped to be safe. Here's the last thing I did: Clicked Export in Keynote.")
    }

    @Test func unexpectedBeforeAnyAction() {
        // SPEC-11 "Unexpected error before any action".
        let presented = ErrorPresenter.present(UserError(kind: .unexpected))
        #expect(presented.message == "Something went wrong and I stopped to be safe.")
        #expect(presented.buttons.map(\.label) == ["Try again", "Stop"])
    }

    @Test func permissionCopyNamesThePermission() {
        // SPEC-11 "Permission copy names the permission".
        let presented = ErrorPresenter.present(UserError(kind: .androidPermissionMissing, permission: "camera"))
        #expect(presented.message == "I need permission to use your camera for this.")
        #expect(presented.buttons.map(\.label) == ["Allow", "Not now"])
        #expect(ErrorPresenter.present(UserError(kind: .androidPermissionMissing)).kind == .unexpected)
    }

    @Test func otherDeviceIsYourPhone() {
        #expect(ErrorPresenter.present(UserError(kind: .otherDeviceOffline, device: "phone-ana")).message
            == "I can't reach your phone right now. It might be asleep or off the internet. I can run this as soon as it's back.")
        #expect(ErrorPresenter.present(UserError(kind: .otherDeviceBusy)).message
            == "Your phone is busy with another task. I'll start this right after.")
        #expect(ErrorPresenter.present(UserError(kind: .cannotPauseOtherDevice)).message
            == "I can't reach your phone to pause it. Use the stop shortcut on your phone.")
    }

    @Test(arguments: ErrorKind.allCases)
    func noPlaceholderOrDeviceIdReachesTheUser(kind: ErrorKind) {
        let presented = ErrorPresenter.present(UserError(kind: kind, taskId: "t-1", device: "phone-ana", lastAction: "Opened Mail", permission: "location"))
        #expect(!presented.message.contains("{"))
        #expect(!presented.message.contains("phone-ana"))
        #expect(!presented.buttons.isEmpty)
    }

    @Test func cancelCancelsTheTask() {
        let presented = ErrorPresenter.present(UserError(kind: .noReply, taskId: "t-1"))
        #expect(presented.buttons.last == ErrorButton(label: "Cancel", action: .cancelTask("t-1")))
    }

    @Test func taskTookTooLongShowsWhatWasFinished() {
        let presented = ErrorPresenter.present(UserError(kind: .taskTookTooLong, finishedSoFar: "Renamed 3 of 5 invoices."))
        #expect(presented.detail == "Renamed 3 of 5 invoices.")
    }

    @Test func unknownKindFromTheHarnessBecomesUnexpected() throws {
        let data = Data(#"{"kind":"somethingNew","lastAction":"Clicked Export in Keynote"}"#.utf8)
        let presented = ErrorPresenter.present(UserErrorDecoding.decode(data))
        #expect(presented.kind == .unexpected)
        #expect(presented.message.hasSuffix("Here's the last thing I did: Clicked Export in Keynote."))
    }

    @Test func missingErrorDataBecomesUnexpected() {
        #expect(ErrorPresenter.present(UserErrorDecoding.decode(nil)).kind == .unexpected)
        #expect(ErrorPresenter.present(UserErrorDecoding.decode(Data("not json".utf8))).kind == .unexpected)
    }
}
