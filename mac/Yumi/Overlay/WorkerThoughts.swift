import Foundation
import YumiProtocol

/// Something on the overlay that can open its thoughts panel: a cat's bubble, by cursor id, or a
/// helper chip, by subtask id (SPEC-07 r23).
enum ThoughtTarget: Hashable, Sendable {
    case cursor(String)
    case chip(String)
}

/// What each worker is thinking, from the harness's `workerThought` events, and which panels are
/// open (OBJ-53). Only in Debug mode: with it off nothing is kept and nothing opens.
///
/// The latest thought per subtask replaces the one before. A cat finds its thought by cursor id
/// (`main` for the main cat, a ghost's own id), a helper chip by its subtask id. A panel closes
/// when it is clicked again, when its subtask ends, when its cat or chip leaves, or when Debug mode
/// turns off.
@MainActor
final class WorkerThoughts {
    private(set) var isEnabled: Bool
    private(set) var expanded: Set<ThoughtTarget> = []
    /// The latest thought of each subtask, with the order it came in, so a cat that moved on to a
    /// new subtask shows the newest one.
    private var latest: [String: (thought: WorkerThought, order: Int)] = [:]
    private var arrivals = 0

    /// Called with the targets whose drawing has to change.
    var onChange: ((Set<ThoughtTarget>) -> Void)?

    init(enabled: Bool) {
        isEnabled = enabled
    }

    func setEnabled(_ enabled: Bool) {
        guard enabled != isEnabled else { return }
        let affected = enabled ? [] : allTargets
        isEnabled = enabled
        if !enabled {
            latest = [:]
            expanded = []
        }
        notify(affected)
    }

    func receive(_ thought: WorkerThought) {
        guard isEnabled else { return }
        arrivals += 1
        latest[thought.subtaskId] = (thought, arrivals)
        notify(targets(of: thought))
    }

    /// The subtask is done or failed: its thought goes, and any panel showing it closes.
    func subtaskEnded(_ subtaskId: String) {
        guard let ended = latest[subtaskId]?.thought else { return }
        let affected = targets(of: ended).filter { thought(for: $0)?.subtaskId == subtaskId }
        latest[subtaskId] = nil
        expanded.subtract(affected)
        notify(affected)
    }

    /// No task is active any more.
    func clear() {
        let affected = allTargets
        latest = [:]
        expanded = []
        notify(affected)
    }

    /// A click on a bubble, a chip, or an open panel. Returns whether the panel is open now.
    @discardableResult
    func toggle(_ target: ThoughtTarget) -> Bool {
        guard isEnabled else { return false }
        if expanded.remove(target) == nil { expanded.insert(target) }
        notify([target])
        return expanded.contains(target)
    }

    /// The cat or chip left the screen.
    func targetLeft(_ target: ThoughtTarget) {
        guard expanded.remove(target) != nil else { return }
        notify([target])
    }

    func isExpanded(_ target: ThoughtTarget) -> Bool {
        expanded.contains(target)
    }

    /// The newest thought for a cat or a chip.
    func thought(for target: ThoughtTarget) -> WorkerThought? {
        switch target {
        case .chip(let subtaskId):
            return latest[subtaskId]?.thought
        case .cursor(let cursorId):
            return latest.values.filter { $0.thought.cursorId == cursorId }.max { $0.order < $1.order }?.thought
        }
    }

    private func targets(of thought: WorkerThought) -> Set<ThoughtTarget> {
        var targets: Set<ThoughtTarget> = [.chip(thought.subtaskId)]
        if let cursorId = thought.cursorId { targets.insert(.cursor(cursorId)) }
        return targets
    }

    private var allTargets: Set<ThoughtTarget> {
        latest.values.reduce(into: expanded) { $0.formUnion(targets(of: $1.thought)) }
    }

    private func notify(_ targets: Set<ThoughtTarget>) {
        guard !targets.isEmpty else { return }
        onChange?(targets)
    }
}

/// The words in a thoughts panel, made from a `WorkerThought`. Plain values, so tests can read them.
struct ThoughtsContent: Equatable {
    struct Row: Equatable {
        let label: String
        let value: String
        /// A placeholder such as "Nothing yet", drawn quieter than real values.
        var placeholder = false
    }

    let title: String
    /// The lane and when the thought arrived, for example "Ghost · 3:42:07 pm".
    let subtitle: String
    let rows: [Row]

    /// `fallbackTitle` and `lane` describe the cat or chip before its first thought arrives.
    init(thought: WorkerThought?, fallbackTitle: String, lane: Lane, timeZone: TimeZone = .current) {
        guard let thought else {
            title = fallbackTitle
            subtitle = Self.laneName(lane)
            rows = [Row(label: "Thinking", value: "Nothing yet. This fills in after its next step.", placeholder: true)]
            return
        }
        title = thought.title
        subtitle = [Self.laneName(thought.lane), Self.time(thought.at, timeZone: timeZone)].compactMap { $0 }.joined(separator: " · ")
        rows = [
            Row(label: "Sees", value: thought.sees),
            Self.row("Last action", thought.lastAction, otherwise: "Nothing yet"),
            Self.row("Decided", thought.decision, otherwise: "Nothing yet"),
            Self.row("Why", thought.reason, otherwise: "No reason given"),
        ]
    }

    private static func row(_ label: String, _ value: String?, otherwise: String) -> Row {
        guard let value, !value.isEmpty else { return Row(label: label, value: otherwise, placeholder: true) }
        return Row(label: label, value: value)
    }

    static func laneName(_ lane: Lane) -> String {
        switch lane {
        case .main: "Main cat"
        case .ghost: "Ghost"
        case .helper: "Helper"
        }
    }

    /// "3:42:07 pm": times shown to users use am/pm. Nil when the timestamp does not parse.
    static func time(_ iso: String, timeZone: TimeZone) -> String? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: iso) ?? {
            parser.formatOptions = [.withInternetDateTime]
            return parser.date(from: iso)
        }() else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "h:mm:ss a"
        formatter.amSymbol = "am"
        formatter.pmSymbol = "pm"
        return formatter.string(from: date)
    }
}
