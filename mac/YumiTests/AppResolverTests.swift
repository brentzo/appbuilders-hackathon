import AppKit
import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// `resolveApp` (OBJ-36, the resolveApp part of OBJ-39): an app's name as the user sees it, to the
/// bundle id of the installed app, without launching it and without guessing an id.
@MainActor
struct AppResolverTests {
    /// A folder of fake app bundles, removed after the test.
    final class Folder {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("yumi-apps-\(UUID().uuidString.prefix(8))")

        init() throws {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }

        deinit {
            try? FileManager.default.removeItem(at: url)
        }

        /// An app bundle with this file name and these Info.plist keys.
        func app(_ file: String, _ info: [String: String]) throws {
            let contents = url.appendingPathComponent(file).appendingPathComponent("Contents")
            try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
            let plist = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            try plist.write(to: contents.appendingPathComponent("Info.plist"))
        }
    }

    /// Launch Services as the tests see it: only these bundle ids are registered.
    static func registered(_ ids: Set<String>) -> (String) -> URL? {
        { ids.contains($0) ? URL(fileURLWithPath: "/Applications/\($0).app") : nil }
    }

    @Test func findsAnAppByTheNameTheUserSeesNotItsFileName() throws {
        let folder = try Folder()
        // Keynote on the demo Mac: the bundle is "Keynote Creator Studio.app", Finder shows "Keynote".
        try folder.app("Keynote Creator Studio.app", [
            "CFBundleIdentifier": "com.apple.Keynote",
            "CFBundleName": "Keynote",
            "CFBundleDisplayName": "Keynote Creator Studio",
        ])
        let found = AppResolver.resolve("Keynote", in: [folder.url.path], registered: Self.registered(["com.apple.Keynote"]))
        #expect(found?.bundleId == "com.apple.Keynote")
        #expect(found?.url.lastPathComponent == "Keynote Creator Studio.app")
        for name in ["keynote", " KEYNOTE ", "Keynote.app", "Keynote Creator Studio"] {
            #expect(AppResolver.resolve(name, in: [folder.url.path], registered: Self.registered(["com.apple.Keynote"])) == found)
        }
    }

    @Test func ignoresAccentsButNeverMatchesPartOfAName() throws {
        let folder = try Folder()
        try folder.app("Café Notes.app", ["CFBundleIdentifier": "com.example.cafe", "CFBundleName": "Café Notes"])
        let registered = Self.registered(["com.example.cafe"])
        #expect(AppResolver.resolve("cafe notes", in: [folder.url.path], registered: registered)?.bundleId == "com.example.cafe")
        #expect(AppResolver.resolve("Notes", in: [folder.url.path], registered: registered) == nil)
        #expect(AppResolver.resolve("Café", in: [folder.url.path], registered: registered) == nil)
    }

    @Test func answersOnlyWithAppsLaunchServicesKnows() throws {
        let folder = try Folder()
        try folder.app("Ghost.app", ["CFBundleIdentifier": "com.example.ghost", "CFBundleName": "Ghost"])
        try folder.app("NoId.app", ["CFBundleName": "NoId"])
        #expect(AppResolver.resolve("Ghost", in: [folder.url.path], registered: Self.registered([])) == nil)
        #expect(AppResolver.resolve("NoId", in: [folder.url.path], registered: { _ in URL(fileURLWithPath: "/") }) == nil)
    }

    @Test func refusesNamesThatAreNotNames() throws {
        let folder = try Folder()
        try folder.app("Mail.app", ["CFBundleIdentifier": "com.apple.mail", "CFBundleName": "Mail"])
        let registered = Self.registered(["com.apple.mail"])
        for name in ["", "   ", ".app", "../Mail", "/Applications/Mail.app"] {
            #expect(AppResolver.resolve(name, in: [folder.url.path], registered: registered) == nil, "\(name)")
        }
    }

    @Test func theFirstFolderWins() throws {
        let first = try Folder()
        let second = try Folder()
        try first.app("Notes.app", ["CFBundleIdentifier": "com.example.notes.user", "CFBundleName": "Notes"])
        try second.app("Notes.app", ["CFBundleIdentifier": "com.apple.Notes", "CFBundleName": "Notes"])
        let registered = Self.registered(["com.example.notes.user", "com.apple.Notes"])
        #expect(AppResolver.resolve("Notes", in: [first.url.path, second.url.path], registered: registered)?.bundleId == "com.example.notes.user")
    }

    @Test func findsTheMacsOwnApps() {
        // Apps every Mac has, read from the real application folders and Launch Services.
        #expect(AppResolver.resolve("Notes")?.bundleId == "com.apple.Notes")
        #expect(AppResolver.resolve("TextEdit")?.bundleId == "com.apple.TextEdit")
        #expect(AppResolver.resolve("Finder")?.bundleId == "com.apple.finder")
        #expect(AppResolver.resolve("Mail")?.bundleId == "com.apple.mail")
        #expect(AppResolver.resolve("No Such App \(UUID().uuidString.prefix(6))") == nil)
    }

    @Test func servesResolveAppWithTheProtocolTypes() async throws {
        let server = AppMethodServer(secrets: SecretStore(service: "ph.appbuilders.yumi.tests.resolve"))
        guard case .result(let data) = await server.serve("resolveApp", params: try JSONEncoder().encode(ResolveAppParams(name: "Notes"))) else {
            Issue.record("resolveApp failed"); return
        }
        #expect(try JSONDecoder().decode(ResolveAppResult.self, from: data) == ResolveAppResult(bundleId: "com.apple.Notes"))

        // An app that is not installed answers an empty result, like the protocol's "not-installed" example.
        guard case .result(let missing) = await server.serve("resolveApp", params: try JSONEncoder().encode(ResolveAppParams(name: "Not Installed Here"))) else {
            Issue.record("resolveApp failed for a missing app"); return
        }
        #expect(String(decoding: missing, as: UTF8.self) == "{}")
    }

    @Test func openAppByNameFindsAppsTheSameWay() throws {
        #expect(try DirectTools.appURL(bundleId: nil, name: "TextEdit") == AppResolver.resolve("TextEdit")?.url)
        #expect(throws: DirectTools.Failure.appNotFound) { try DirectTools.appURL(bundleId: nil, name: "No Such App Here") }
    }
}
