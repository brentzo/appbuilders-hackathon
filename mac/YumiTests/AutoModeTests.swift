import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// The Mac half of Auto mode (SPEC-01 requirement 14, OBJ-50): the setting is off by default and
/// kept, every goal says whether it is on, and a goal started in Auto mode shows what Yumi heard
/// and says "On it." with no buttons to answer.
@MainActor
struct AutoModeTests {
    final class FakeSpeech: SpeechOutput {
        var said: [String] = []
        func speak(_ text: String) async { said.append(text) }
    }

    final class FakeHeardPanel: HeardPresenting {
        var shown: [(taskId: String, line: String, heard: String)] = []
        var closed: [String] = []
        var isOpen: Bool { shown.count > closed.count }
        func showHeard(taskId: String, line: String, heard: String) { shown.append((taskId, line, heard)) }
        func close(taskId: String) { closed.append(taskId) }
    }

    /// A wait the test ends by hand, standing in for the 3 seconds on screen.
    final class HeldWait {
        var waited: [Duration] = []
        private var release: CheckedContinuation<Void, Never>?
        func wait(_ duration: Duration) async {
            waited.append(duration)
            await withCheckedContinuation { release = $0 }
        }
        func end() {
            release?.resume()
            release = nil
        }
        var isWaiting: Bool { release != nil }
    }

    struct NoSink: HarnessSettingsSink {
        func settingsDidChange(_ settings: YumiSettings) {}
    }

    static let taskId = "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8"

    private func freshDefaults() -> UserDefaults {
        let name = "yumi.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func isOffByDefaultAndKeptAcrossLaunches() {
        let defaults = freshDefaults()
        let first = SettingsStore(defaults: defaults, sink: NoSink())
        #expect(first.autoMode == false) // SPEC-01 requirement 14: confirmation stays on by default
        first.autoMode = true
        #expect(SettingsStore(defaults: defaults, sink: NoSink()).autoMode == true)
    }

    @Test func everyGoalSaysWhetherAutoModeIsOn() throws {
        for on in [true, false] {
            let params = HarnessLink.submitGoalParams("rename the invoices", autoMode: on)
            let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(params)) as? [String: Any]
            #expect(json?["autoMode"] as? Bool == on)
            #expect(json?["transcript"] as? String == "rename the invoices")
            #expect(json?["originDeviceId"] as? String == "mac-local")
        }
    }

    @Test func showsWhatItHeardAndSaysOnItThenCloses() async {
        let speech = FakeSpeech()
        let panel = FakeHeardPanel()
        let held = HeldWait()
        let acknowledgement = AutoModeAcknowledgement(speech: speech, presenter: panel, wait: held.wait)

        let started = Task { await acknowledgement.goalStarted(taskId: Self.taskId, heard: "  rename the invoices in Downloads by date \n") }
        while !held.isWaiting { await Task.yield() }

        #expect(panel.shown.count == 1)
        #expect(panel.shown.first?.line == "On it.")
        #expect(panel.shown.first?.heard == "rename the invoices in Downloads by date")
        #expect(panel.isOpen)
        #expect(held.waited == [.seconds(3)])

        held.end()
        await started.value
        #expect(speech.said == ["On it."])
        #expect(panel.closed == [Self.taskId])
    }

    @Test func aTaskThatEndsTakesThePanelWithItOnce() async {
        let panel = FakeHeardPanel()
        let held = HeldWait()
        let acknowledgement = AutoModeAcknowledgement(speech: FakeSpeech(), presenter: panel, wait: held.wait)
        let started = Task { await acknowledgement.goalStarted(taskId: Self.taskId, heard: "rename the invoices") }
        while !held.isWaiting { await Task.yield() }

        acknowledgement.taskStatusChanged(Self.taskId, .running)
        #expect(panel.isOpen)
        acknowledgement.taskStatusChanged("another-task", .cancelled)
        #expect(panel.isOpen)
        acknowledgement.taskStatusChanged(Self.taskId, .cancelled)
        #expect(panel.closed == [Self.taskId])

        held.end()
        await started.value
        #expect(panel.closed == [Self.taskId])
    }
}
