import YumiProtocol

/// Whether the local model can take a goal yet, as the harness reports it (OBJ-46, OBJ-47): in
/// `hello`'s answer, then as `modelStateChanged` on every change.
enum ModelReadiness: Equatable, Sendable {
    /// The model server is still starting. The status line says "Yumi is getting ready".
    case loading
    case ready
    /// It did not start in time, or serves another model: SPEC-11 "Model failed to load".
    case failed

    /// A harness that does not report the state (older than OBJ-47) is taken as ready, so it is
    /// never blocked by a state it cannot send.
    init(_ state: ModelState?) {
        switch state {
        case .loading: self = .loading
        case .failed: self = .failed
        case .ready, nil: self = .ready
        }
    }
}

/// What happens to the model's state and to goals spoken before the model is ready (OBJ-46.3).
///
/// A goal spoken while the model loads is held, Yumi says she is still waking up, and the goal is
/// submitted once the model is ready. Only the latest goal is kept: a second one replaces the
/// first, because the user's last words are what they want now. A held goal is dropped when the
/// model fails, and the failure shows instead. This is a proposal waiting for Brent's yes (SPEC-11,
/// "Open questions").
@MainActor
final class ModelGate {
    /// Said when a goal is held: plain words, no promise of a time.
    static let wakingUpLine = "I'm still waking up. I'll start on that as soon as I'm ready."

    private let model: AppModel
    private let submit: (String) -> Void
    private let say: (String) -> Void
    private let showFailed: () -> Void
    /// The goal spoken while the model loaded, submitted once it is ready.
    private(set) var heldGoal: String?

    init(
        model: AppModel, submit: @escaping (String) -> Void, say: @escaping (String) -> Void,
        showFailed: @escaping () -> Void
    ) {
        self.model = model
        self.submit = submit
        self.say = say
        self.showFailed = showFailed
    }

    /// The state from `hello` or `modelStateChanged`.
    func update(_ state: ModelState?) {
        let next = ModelReadiness(state)
        let previous = model.modelReadiness
        model.modelReadiness = next
        guard next != previous else { return }
        switch next {
        case .ready:
            if let goal = heldGoal {
                heldGoal = nil
                submit(goal)
            }
        case .failed:
            heldGoal = nil
            showFailed()
        case .loading:
            break
        }
    }

    /// The harness went away: until the next `hello` says otherwise, the model is not known to be
    /// ready. A held goal stays held, so it runs when the restarted harness has the model.
    func harnessDisconnected() {
        model.modelReadiness = .loading
    }

    /// Takes a new goal. Returns true when the gate kept it from the harness: held while the
    /// model loads, or answered with "Model failed to load" again while it has failed.
    func hold(_ goal: String) -> Bool {
        switch model.modelReadiness {
        case .ready:
            return false
        case .loading:
            heldGoal = goal
            say(Self.wakingUpLine)
            return true
        case .failed:
            showFailed()
            return true
        }
    }
}
