import Foundation
import OSLog
import YumiProtocol

/// What the app answers to a method the harness calls on it (protocol/README.md, "Local RPC").
enum AppMethodReply: Sendable {
    /// The encoded result.
    case result(Data)
    /// Not served by this app yet: JSON-RPC -32601.
    case notServed
    /// The params break the contract: JSON-RPC -32602. The text is for logs only.
    case invalidParams(String)
    /// The method ran and failed: JSON-RPC -32000 with a `UserError`. The text is for logs only.
    case failed(UserError, String)
}

/// Serves the harness-to-app methods (OBJ-27). Params and results are the generated protocol types.
///
/// `executeAction`, `observeWindow` and `readFieldValues` go to the GUI executor (OBJ-39).
/// `showApprovalCard` and `moveToTrash` (OBJ-40) are not served yet and answer -32601.
@MainActor
final class AppMethodServer {
    private let secrets: SecretStore
    private let gui: GuiExecutor?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "app-methods")

    init(secrets: SecretStore = SecretStore(), gui: GuiExecutor? = nil) {
        self.secrets = secrets
        self.gui = gui
    }

    func serve(_ name: String, params: Data) async -> AppMethodReply {
        guard let method = RpcMethod(rawValue: name) else { return .notServed }
        do {
            switch method {
            case .observeWindow:
                guard let gui else { return .notServed }
                return try encode(try gui.observeWindow(try decode(ObserveWindowParams.self, params)))
            case .executeAction:
                guard let gui else { return .notServed }
                return try encode(try await gui.executeAction(try decode(ExecuteActionParams.self, params)))
            case .readFieldValues:
                guard let gui else { return .notServed }
                return try encode(try gui.readFieldValues(try decode(ReadFieldValuesParams.self, params)))
            case .listWindows:
                let p = try decode(ListWindowsParams.self, params)
                return try encode(WindowList(windows: WindowService.listWindows(bundleId: p.bundleId)))
            case .getWindowFrame:
                let p = try decode(WindowRef.self, params)
                return try encode(WindowService.frame(of: p.windowId))
            case .setWindowFrame:
                let p = try decode(SetWindowFrameParams.self, params)
                try WindowService.setFrame(of: p.windowId, to: p.frame)
                return try encode(Empty())
            case .probeAppCapability:
                let p = try decode(ProbeAppCapabilityParams.self, params)
                return try encode(await AppCapabilityProbe.probe(bundleId: p.bundleId))
            case .openNewWindow:
                let p = try decode(OpenNewWindowParams.self, params)
                return try encode(await NewWindowOpener.open(bundleId: p.bundleId))
            case .storeSecret:
                let p = try decode(StoreSecretParams.self, params)
                guard let value = Data(base64Encoded: p.value) else { return .invalidParams("storeSecret value is not base64") }
                try secrets.store(value, for: p.key)
                log.notice("Stored secret \(p.key, privacy: .public)")
                return try encode(Empty())
            case .loadSecret:
                let p = try decode(SecretRef.self, params)
                let value = try secrets.load(p.key)
                return try encode(LoadSecretResult(value: value?.base64EncodedString()))
            default:
                return .notServed
            }
        } catch let failure as ParamsError {
            return .invalidParams(failure.detail)
        } catch {
            return Self.reply(for: error, method: name)
        }
    }

    /// Maps a native failure to the user-facing kind the harness passes on (SPEC-11).
    static func reply(for error: Error, method: String) -> AppMethodReply {
        switch error {
        case let failure as GuiFailure:
            return .failed(failure.userError, "\(method): \(failure)")
        case WindowService.Failure.accessibilityMissing, AppCapabilityProbe.Failure.accessibilityMissing:
            return .failed(UserError(kind: .accessibilityPermissionMissing), "\(method): Accessibility permission missing")
        case AppCapabilityProbe.Failure.appNotInstalled:
            return .failed(UserError(kind: .unsupportedRequest), "\(method): app not installed")
        default:
            return .failed(UserError(kind: .unexpected), "\(method): \(String(describing: error))")
        }
    }

    private struct ParamsError: Error {
        let detail: String
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw ParamsError(detail: "params do not match \(type): \(error)")
        }
    }

    private func encode<T: Encodable>(_ value: T) throws -> AppMethodReply {
        .result(try JSONEncoder().encode(value))
    }
}
