import Foundation
import YumiProtocol

/// An event from the harness, decoded into its generated protocol type.
enum HarnessEvent: Sendable {
    case taskStatusChanged(TaskStatusChanged)
    case goalRestated(GoalRestated)
    case questionAsked(QuestionAsked)
    case cursorCommand(CursorCommand)
    case approvalCancelled(ApprovalCancelled)
    case interruptedTaskFound(TaskRef)
    case userError(UserError)
    case waitingForWindow(WaitingForWindow)
    case tilingSuggested(TilingSuggested)
    case routeDecided(RouteDecided)
    case speak(Speak)
    case bridgeStateChanged(BridgeStateChanged)
    case workerThought(WorkerThought)

    enum DecodeError: Error {
        case unknownEvent(String)
    }

    /// Decodes an event by name. The switch is exhaustive over the generated `RpcEvent`, so a new
    /// event in the protocol fails the build here until it is handled.
    static func decode(name: String, payload: Data) throws -> HarnessEvent {
        guard let event = RpcEvent(rawValue: name) else { throw DecodeError.unknownEvent(name) }
        let decoder = JSONDecoder()
        switch event {
        case .taskStatusChanged: return .taskStatusChanged(try decoder.decode(TaskStatusChanged.self, from: payload))
        case .goalRestated: return .goalRestated(try decoder.decode(GoalRestated.self, from: payload))
        case .questionAsked: return .questionAsked(try decoder.decode(QuestionAsked.self, from: payload))
        case .cursorCommand: return .cursorCommand(try decoder.decode(CursorCommand.self, from: payload))
        case .approvalCancelled: return .approvalCancelled(try decoder.decode(ApprovalCancelled.self, from: payload))
        case .interruptedTaskFound: return .interruptedTaskFound(try decoder.decode(TaskRef.self, from: payload))
        case .userError: return .userError(UserErrorDecoding.decode(payload))
        case .waitingForWindow: return .waitingForWindow(try decoder.decode(WaitingForWindow.self, from: payload))
        case .tilingSuggested: return .tilingSuggested(try decoder.decode(TilingSuggested.self, from: payload))
        case .routeDecided: return .routeDecided(try decoder.decode(RouteDecided.self, from: payload))
        case .speak: return .speak(try decoder.decode(Speak.self, from: payload))
        case .bridgeStateChanged: return .bridgeStateChanged(try decoder.decode(BridgeStateChanged.self, from: payload))
        case .workerThought: return .workerThought(try decoder.decode(WorkerThought.self, from: payload))
        }
    }

    var name: String {
        switch self {
        case .taskStatusChanged: RpcEvent.taskStatusChanged.rawValue
        case .goalRestated: RpcEvent.goalRestated.rawValue
        case .questionAsked: RpcEvent.questionAsked.rawValue
        case .cursorCommand: RpcEvent.cursorCommand.rawValue
        case .approvalCancelled: RpcEvent.approvalCancelled.rawValue
        case .interruptedTaskFound: RpcEvent.interruptedTaskFound.rawValue
        case .userError: RpcEvent.userError.rawValue
        case .waitingForWindow: RpcEvent.waitingForWindow.rawValue
        case .tilingSuggested: RpcEvent.tilingSuggested.rawValue
        case .routeDecided: RpcEvent.routeDecided.rawValue
        case .speak: RpcEvent.speak.rawValue
        case .bridgeStateChanged: RpcEvent.bridgeStateChanged.rawValue
        case .workerThought: RpcEvent.workerThought.rawValue
        }
    }
}
