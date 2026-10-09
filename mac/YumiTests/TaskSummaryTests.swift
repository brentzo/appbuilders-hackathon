import AppKit
import SwiftUI
import Testing
import YumiProtocol
@testable import Yumi

/// SPEC-02 r9: when a task finishes, Yumi says its summary and shows it on screen. On 2026-10-10
/// task e614636f ended with "Done. Listed the files in your Downloads folder.": the line was
/// spoken, but nothing showed.
@MainActor
struct TaskSummaryTests {
    final class FakeSpeech: SpeechOutput {
        var said: [String] = []
        func speak(_ text: String) async { said.append(text) }
        func speakOpening(_ text: String) async { said.append(text) }
    }

    final class FakePanel: SummaryPresenting {
        var shown: [(taskId: String, text: String)] = []
        var closed: [String] = []
        var closeButton: (() -> Void)?
        func show(taskId: String, text: String, close: @escaping () -> Void) {
            shown.append((taskId, text))
            closeButton = close
        }
        func close(taskId: String) { closed.append(taskId) }
    }

    /// Holds the card open until the test lets it go, like the reading time passing.
    final class HeldWait {
        var waited: [Duration] = []
        private var release: CheckedContinuation<Void, Never>?
        func wait(_ duration: Duration) async {
            waited.append(duration)
            await withCheckedContinuation { release = $0 }
        }
        func finish() { release?.resume(); release = nil }
    }

    static let line = "Done. Listed the files in your Downloads folder."

    @Test func aFinishedTaskIsSaidAndShownThenClosesOnItsOwn() async throws {
        let speech = FakeSpeech()
        let panel = FakePanel()
        let wait = HeldWait()
        let summary = TaskSummary(speech: speech, presenter: panel, wait: wait.wait)
        let shown = Task { await summary.taskFinished(taskId: "e614636f", summary: Self.line) }
        try await until { !wait.waited.isEmpty }
        #expect(panel.shown.map(\.text) == [Self.line])
        #expect(speech.said == [Self.line])
        #expect(summary.showing == "e614636f")
        #expect(panel.closed.isEmpty, "it stays while the user reads it")

        wait.finish()
        await shown.value
        #expect(panel.closed == ["e614636f"])
        #expect(summary.showing == nil)
    }

    @Test func theCloseButtonClosesItAtOnce() async throws {
        let panel = FakePanel()
        let wait = HeldWait()
        let summary = TaskSummary(speech: FakeSpeech(), presenter: panel, wait: wait.wait)
        let shown = Task { await summary.taskFinished(taskId: "t1", summary: Self.line) }
        try await until { !wait.waited.isEmpty }
        panel.closeButton?()
        #expect(panel.closed == ["t1"])
        wait.finish()
        await shown.value
        #expect(panel.closed == ["t1"], "closing on its own later does nothing more")
    }

    @Test func aNewGoalTakesTheCardAway() async throws {
        let panel = FakePanel()
        let wait = HeldWait()
        let summary = TaskSummary(speech: FakeSpeech(), presenter: panel, wait: wait.wait)
        let shown = Task { await summary.taskFinished(taskId: "t1", summary: Self.line) }
        try await until { !wait.waited.isEmpty }
        summary.goalSubmitted()
        #expect(panel.closed == ["t1"])
        wait.finish()
        await shown.value
    }

    @Test func whateverSummaryArrivesIsShownAsIs() async throws {
        // A partial or stopped task's summary, or one that holds the actual answer, shows the same way.
        let panel = FakePanel()
        let summary = TaskSummary(speech: FakeSpeech(), presenter: panel, wait: { _ in })
        let partial = "I renamed 9 of the 12 invoices. Three were open in Preview, so I left them."
        await summary.taskFinished(taskId: "t2", summary: "  \(partial)\n")
        #expect(panel.shown.map(\.text) == [partial])
        await summary.taskFinished(taskId: "t3", summary: "   ")
        #expect(panel.shown.count == 1, "nothing to show")
    }

    @Test func longerSummariesStayLonger() {
        #expect(TaskSummary.readingTime(for: Self.line) == .seconds(4))
        let long = Array(repeating: "word", count: 30).joined(separator: " ")
        #expect(TaskSummary.readingTime(for: long) == .seconds(9))
        #expect(TaskSummary.readingTime(for: long + " " + long + " " + long) == .seconds(12))
    }

    @Test func aSpeakEventWithATaskIsItsSummary() throws {
        // The harness's `speak` carries the task's id for a summary (SPEC-02 r9).
        let payload = Data(#"{"text":"Done. Listed the files in your Downloads folder.","taskId":"e614636f-6e50-4965-8e59-0b24778a8aa7"}"#.utf8)
        guard case .speak(let line) = try HarnessEvent.decode(name: "speak", payload: payload) else {
            Issue.record("not a speak event")
            return
        }
        #expect(line.taskId == "e614636f-6e50-4965-8e59-0b24778a8aa7")
    }

    /// The card in light and dark, rendered for a look; written to the temporary folder.
    @Test(arguments: [NSAppearance.Name.aqua, .darkAqua])
    func theCardRendersInLightAndDark(_ name: NSAppearance.Name) throws {
        let appearance = try #require(NSAppearance(named: name))
        var image: NSImage?
        appearance.performAsCurrentDrawingAppearance {
            let view = SummaryView(text: Self.line) {}
                .padding(YumiSpace.xl)
                .background(YumiColor.paperDeep)
                .environment(\.colorScheme, name == .darkAqua ? .dark : .light)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            image = renderer.nsImage
        }
        let rendered = try #require(image)
        #expect(rendered.size.width > 300 && rendered.size.height > 40)
        if let tiff = rendered.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("yumi-summary-\(name.rawValue).png"))
        }
    }

    private func until(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() { try await Task.sleep(for: .milliseconds(10)) }
        #expect(condition())
    }
}
