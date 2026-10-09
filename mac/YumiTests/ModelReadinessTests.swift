import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// The model's state on the Mac (OBJ-46): the status line, goals spoken before the model is ready,
/// "Model failed to load", and the mock harness's `model-loading` and `model-failed` scripts.
@MainActor
struct ModelReadinessTests {
    /// A gate with everything it does recorded.
    final class Recorder {
        var submitted: [String] = []
        var said: [String] = []
        var failedShown = 0
    }

    static func gate() -> (ModelGate, AppModel, Recorder) {
        let model = AppStatusTests.isolatedModel()
        let recorder = Recorder()
        let gate = ModelGate(
            model: model,
            submit: { recorder.submitted.append($0) },
            say: { recorder.said.append($0) },
            showFailed: { recorder.failedShown += 1 }
        )
        return (gate, model, recorder)
    }

    @Test func statusLineSaysGettingReadyUntilTheModelIsReady() {
        let (gate, model, _) = Self.gate()
        model.harnessReady = true
        gate.update(.loading)
        #expect(model.status == .startingUp)
        #expect(model.status.menuTitle == "Yumi is getting ready")
        gate.update(.ready)
        #expect(model.status == .ready)
    }

    /// An app that connects after the model started loading learns it from `hello` at once.
    @Test func helloWhileLoadingShowsGettingReady() {
        let (gate, model, _) = Self.gate()
        gate.update(.loading)
        model.harnessReady = true
        #expect(model.status == .startingUp)
    }

    @Test func aHarnessThatDoesNotReportTheStateCountsAsReady() {
        let (gate, model, _) = Self.gate()
        model.harnessReady = true
        gate.update(nil)
        #expect(model.status == .ready)
    }

    @Test func aGoalSpokenWhileLoadingIsHeldAndRunsWhenReady() {
        let (gate, _, recorder) = Self.gate()
        gate.update(.loading)
        #expect(gate.hold("open my notes"))
        #expect(recorder.said == [ModelGate.wakingUpLine])
        #expect(recorder.submitted.isEmpty)
        gate.update(.ready)
        #expect(recorder.submitted == ["open my notes"])
        #expect(gate.heldGoal == nil)
        // Ready again (a repeated event) submits nothing more.
        gate.update(.ready)
        #expect(recorder.submitted == ["open my notes"])
    }

    @Test func onlyTheLatestHeldGoalRuns() {
        let (gate, _, recorder) = Self.gate()
        gate.update(.loading)
        _ = gate.hold("open my notes")
        _ = gate.hold("actually, open Keynote")
        gate.update(.ready)
        #expect(recorder.submitted == ["actually, open Keynote"])
    }

    @Test func aGoalWhenReadyGoesStraightThrough() {
        let (gate, _, recorder) = Self.gate()
        gate.update(.ready)
        #expect(!gate.hold("open my notes"))
        #expect(recorder.said.isEmpty)
    }

    @Test func failingDropsTheHeldGoalAndShowsTheFailure() {
        let (gate, _, recorder) = Self.gate()
        gate.update(.loading)
        _ = gate.hold("open my notes")
        gate.update(.failed)
        #expect(recorder.failedShown == 1)
        #expect(gate.heldGoal == nil)
        gate.update(.ready)
        #expect(recorder.submitted.isEmpty)
    }

    @Test func aGoalWhileFailedShowsTheFailureAgain() {
        let (gate, _, recorder) = Self.gate()
        gate.update(.failed)
        #expect(gate.hold("open my notes"))
        #expect(recorder.failedShown == 2)
        #expect(recorder.submitted.isEmpty)
    }

    /// A restarted harness ("Try again") starts from loading, and a held goal survives the restart.
    @Test func aDisconnectGoesBackToLoadingAndKeepsTheHeldGoal() {
        let (gate, model, recorder) = Self.gate()
        gate.update(.loading)
        _ = gate.hold("open my notes")
        gate.harnessDisconnected()
        #expect(model.modelReadiness == .loading)
        gate.update(.ready)
        #expect(recorder.submitted == ["open my notes"])
    }

    @Test func modelFailedToLoadShowsSpec11CopyWithTryAgainThatRestartsTheHarness() {
        let presented = ErrorPresenter.present(UserError(kind: .modelFailedToLoad))
        #expect(presented.message == "I couldn't start my brain on this device. Closing other apps usually helps.")
        #expect(presented.buttons == [ErrorButton(label: "Try again", action: .restartHarness)])
    }
}

/// The same, against the real mock harness's model scripts (OBJ-46.5). Needs node and
/// `npm install` in protocol/, like `HarnessClientTests`.
@MainActor
@Suite(.serialized, .timeLimit(.minutes(2)))
struct ModelReadinessMockHarnessTests {
    /// Plays a script on a fresh client and gate. Returns the state `hello` reported, and the state
    /// after each `modelStateChanged`, in order.
    func play(
        _ script: String, until last: ModelReadiness
    ) async throws -> (hello: ModelState?, events: [ModelReadiness], recorder: ModelReadinessTests.Recorder) {
        let mock = try await MockHarnessProcess.start(script: script, speed: "0")
        defer { mock.stop() }
        let (gate, model, recorder) = ModelReadinessTests.gate()
        let client = HarnessClient(socketPath: mock.socketPath, timing: HarnessClientTests.patient)
        var states: [ModelReadiness] = []
        var hello: ModelState?
        client.onModelState = { state in
            hello = state
            gate.update(state)
        }
        client.start()
        defer { client.stop() }
        let deadline = Task { @MainActor in
            try await Task.sleep(for: .seconds(60))
            client.stop()
        }
        defer { deadline.cancel() }
        for await event in client.events {
            guard case .modelStateChanged(let change) = event else { continue }
            gate.update(change.state)
            states.append(model.modelReadiness)
            if change.state == .loading { _ = gate.hold("open my notes") }
            if model.modelReadiness == last { break }
        }
        return (hello, states, recorder)
    }

    @Test func modelLoadingScript() async throws {
        let (hello, states, recorder) = try await play("model-loading", until: .ready)
        // `hello` answers ready (the mock's default), then the script plays loading and ready.
        #expect(hello == .ready)
        #expect(states == [.loading, .ready])
        #expect(recorder.said == [ModelGate.wakingUpLine])
        #expect(recorder.submitted == ["open my notes"])
    }

    @Test func modelFailedScript() async throws {
        let (hello, states, recorder) = try await play("model-failed", until: .failed)
        #expect(hello == .ready)
        #expect(states == [.loading, .failed])
        #expect(recorder.failedShown == 1)
        #expect(recorder.submitted.isEmpty)
    }
}
