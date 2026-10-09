import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// The harness-to-app dispatch (OBJ-27): params decode into the generated types, results encode
/// from them, and failures map to JSON-RPC errors with a SPEC-11 kind.
@MainActor
struct AppMethodServerTests {
    let secrets = SecretStore(service: "ph.appbuilders.yumi.tests.\(UUID().uuidString.prefix(8)).secrets")

    @Test func secretsRoundTripThroughTheKeychain() async throws {
        let server = AppMethodServer(secrets: secrets)
        defer { try? secrets.delete("bridge.device-key") }
        let value = Data("not-a-real-key".utf8).base64EncodedString()

        guard case .result = await server.serve("storeSecret", params: json(["key": "bridge.device-key", "value": value])) else {
            Issue.record("storeSecret failed"); return
        }
        guard case .result(let data) = await server.serve("loadSecret", params: json(["key": "bridge.device-key"])) else {
            Issue.record("loadSecret failed"); return
        }
        #expect(try JSONDecoder().decode(LoadSecretResult.self, from: data).value == value)
    }

    @Test func aMissingSecretHasNoValue() async throws {
        let server = AppMethodServer(secrets: secrets)
        guard case .result(let data) = await server.serve("loadSecret", params: json(["key": "nothing.here"])) else {
            Issue.record("loadSecret failed"); return
        }
        #expect(try JSONDecoder().decode(LoadSecretResult.self, from: data).value == nil)
    }

    @Test func paramsThatBreakTheContractAreInvalid() async {
        let server = AppMethodServer(secrets: secrets)
        guard case .invalidParams = await server.serve("getWindowFrame", params: json(["window": 1])) else {
            Issue.record("expected invalidParams"); return
        }
    }

    @Test func methodsOfLaterObjectivesAreNotServed() async {
        let server = AppMethodServer(secrets: secrets)
        for method in ["executeAction", "observeWindow", "showApprovalCard", "noSuchMethod"] {
            guard case .notServed = await server.serve(method, params: Data("{}".utf8)) else {
                Issue.record("\(method) should not be served"); continue
            }
        }
    }

    @Test func nativeFailuresMapToSpec11Kinds() {
        guard case .failed(let missing, _) = AppMethodServer.reply(for: WindowService.Failure.accessibilityMissing, method: "listWindows"),
              case .failed(let notInstalled, _) = AppMethodServer.reply(for: AppCapabilityProbe.Failure.appNotInstalled, method: "probeAppCapability"),
              case .failed(let other, _) = AppMethodServer.reply(for: WindowService.Failure.windowNotFound, method: "getWindowFrame")
        else { Issue.record("expected failures"); return }
        #expect(missing.kind == .accessibilityPermissionMissing)
        #expect(notInstalled.kind == .unsupportedRequest)
        #expect(other.kind == .unexpected)
    }

    @Test func openNewWindowIsUnsupportedForAppsWithoutAStrategy() async throws {
        let server = AppMethodServer(secrets: secrets)
        guard case .result(let data) = await server.serve("openNewWindow", params: json(["bundleId": "com.apple.TextEdit"])) else {
            Issue.record("openNewWindow failed"); return
        }
        #expect(try JSONDecoder().decode(OpenNewWindowResult.self, from: data) == OpenNewWindowResult(supported: false))
    }

    @Test func phoneStatusLine() {
        let phone = PhoneLink.Device(id: "phone-1", name: "Ana's Pixel")
        #expect(PhoneMenuItems.statusLine(connection: .connected, device: nil) == "Not paired")
        #expect(PhoneMenuItems.statusLine(connection: .connected, device: phone) == "Ana's Pixel: connected")
        #expect(PhoneMenuItems.statusLine(connection: .reconnecting, device: phone) == "Ana's Pixel: reconnecting…")
        #expect(PhoneMenuItems.statusLine(connection: nil, device: phone) == "Ana's Pixel: offline")
    }

    private func json(_ object: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: object)
    }
}
