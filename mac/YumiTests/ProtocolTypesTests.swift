import Foundation
import Testing
import YumiProtocol

/// The generated types from protocol/ decode the protocol's own examples on macOS, and encode them
/// back to the same JSON. OBJ-01 only compiled them on Linux.
struct ProtocolTypesTests {
    static let examples = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // YumiTests
        .deletingLastPathComponent() // mac
        .deletingLastPathComponent() // repo root
        .appendingPathComponent("protocol/examples")

    /// Round-trips one example through a generated type.
    static func roundTrip<T: Codable & Equatable>(_ type: T.Type, _ file: String) throws {
        let data = try Data(contentsOf: examples.appendingPathComponent("\(file).json"))
        let value = try JSONDecoder().decode(T.self, from: data)
        let again = try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
        let same = value == again
        #expect(same, "\(file) changed in a round trip")
        let original = try JSONSerialization.jsonObject(with: data) as? NSDictionary
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? NSDictionary
        #expect(original == encoded, "\(file) encodes to different JSON")
    }

    @Test func helloAndPing() throws {
        try Self.roundTrip(HelloParams.self, "HelloParams.v1")
        try Self.roundTrip(HelloResult.self, "HelloResult.v1")
        try Self.roundTrip(Empty.self, "Empty.empty")
    }

    @Test func userErrors() throws {
        try Self.roundTrip(UserError.self, "UserError.mac-offline")
        try Self.roundTrip(UserError.self, "UserError.unexpected")
    }

    @Test func eventPayloads() throws {
        try Self.roundTrip(TaskStatusChanged.self, "TaskStatusChanged.subtask-done")
        try Self.roundTrip(GoalRestated.self, "GoalRestated.invoices")
        try Self.roundTrip(QuestionAsked.self, "QuestionAsked.which-deck")
        try Self.roundTrip(CursorCommand.self, "CursorCommand.move-to-point")
        try Self.roundTrip(CursorCommand.self, "CursorCommand.spawn-ghost")
        try Self.roundTrip(ApprovalCancelled.self, "ApprovalCancelled.paused")
        try Self.roundTrip(TaskRef.self, "TaskRef.keynote")
        try Self.roundTrip(WaitingForWindow.self, "WaitingForWindow.keynote")
        try Self.roundTrip(TilingSuggested.self, "TilingSuggested.two-windows")
        try Self.roundTrip(RouteDecided.self, "RouteDecided.main")
        try Self.roundTrip(Speak.self, "Speak.summary")
        try Self.roundTrip(BridgeStateChanged.self, "BridgeStateChanged.offline")
    }

    @Test func taskRecords() throws {
        try Self.roundTrip(TaskRecord.self, "Task.awaiting-confirmation")
        try Self.roundTrip(TaskRecord.self, "Task.running-delegated")
        try Self.roundTrip(SubmitGoalParams.self, "SubmitGoalParams.from-mac")
    }
}
