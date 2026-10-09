import AppKit
import Foundation
import Testing
@testable import Yumi

@MainActor
struct PermissionCenterTests {
    final class FakeSystem: PermissionSystem {
        var states: [Permission: PermissionState] = [
            .microphone: .notAsked, .accessibility: .missing, .screenRecording: .missing,
        ]
        var requested: [Permission] = []
        var opened: [URL] = []

        func state(of permission: Permission) -> PermissionState { states[permission]! }
        func request(_ permission: Permission) async {
            requested.append(permission)
            if permission == .microphone { states[.microphone] = .granted }
        }
        func open(_ url: URL) { opened.append(url) }
    }

    func freshDefaults() -> UserDefaults {
        let name = "yumi.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func noticesAGrantOnRefresh() {
        let system = FakeSystem()
        let center = PermissionCenter(system: system, defaults: freshDefaults())
        #expect(center.missing == [.microphone, .accessibility, .screenRecording])

        system.states[.accessibility] = .granted
        center.refresh()
        #expect(center.state(of: .accessibility) == .granted)
        #expect(center.missing == [.microphone, .screenRecording])
    }

    @Test func screenRecordingOpensItsPane() async {
        let system = FakeSystem()
        let center = PermissionCenter(system: system, defaults: freshDefaults())
        await center.openSettings(for: .screenRecording)
        #expect(system.opened.map(\.absoluteString) == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        ])
        #expect(system.requested == [.screenRecording])

        // Only the first click asks macOS; later clicks just open the pane.
        await center.openSettings(for: .screenRecording)
        #expect(system.requested == [.screenRecording])
        #expect(system.opened.count == 2)
    }

    @Test func accessibilityOpensItsPane() async {
        let system = FakeSystem()
        let center = PermissionCenter(system: system, defaults: freshDefaults())
        await center.openSettings(for: .accessibility)
        #expect(system.opened.map(\.absoluteString) == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ])
    }

    @Test func microphoneAsksFirstThenOpensThePane() async {
        let system = FakeSystem()
        let center = PermissionCenter(system: system, defaults: freshDefaults())
        await center.openSettings(for: .microphone)
        #expect(system.requested == [.microphone])
        #expect(system.opened.isEmpty)
        #expect(center.state(of: .microphone) == .granted)

        system.states[.microphone] = .missing // the user turned it off later
        center.refresh()
        await center.openSettings(for: .microphone)
        #expect(system.opened.map(\.absoluteString) == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        ])
    }
}

extension PermissionCenterTests {
    @Test func checkReadsMacOSAgainRightBeforeUse() {
        let system = FakeSystem()
        let center = PermissionCenter(system: system, defaults: freshDefaults())
        system.states[.screenRecording] = .granted
        #expect(center.state(of: .screenRecording) == .missing) // not re-read yet
        #expect(center.check(.screenRecording) == .granted)
    }

    @Test func pollsOnlyWhileAskedTo() {
        let center = PermissionCenter(system: FakeSystem(), defaults: freshDefaults())
        #expect(center.isPolling == false)
        center.startPolling()
        #expect(center.isPolling)
        center.stopPolling()
        #expect(center.isPolling == false)
    }
}

extension PermissionCenterTests {
    @Test func opensOfTheMenuReadMacOSAgain() {
        let system = FakeSystem()
        let center = PermissionCenter(system: system, defaults: freshDefaults())
        center.observeActivation()
        system.states[.accessibility] = .granted
        #expect(center.state(of: .accessibility) == .missing)
        NotificationCenter.default.post(name: NSMenu.didBeginTrackingNotification, object: NSMenu())
        #expect(center.state(of: .accessibility) == .granted)
    }
}
