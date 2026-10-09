import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// SPEC-11 requirement 7 and scenario "Copy table matches the code": every row of the SPEC-11
/// table has the same text and buttons in code, word for word, and every protocol `ErrorKind`
/// has copy. Which kind belongs to which row comes from the protocol's own `x-specRows` mapping.
struct UserErrorCopyTests {
    struct SpecRow: Equatable {
        let message: String
        let buttons: [String]
    }

    static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // YumiTests
        .deletingLastPathComponent() // mac
        .deletingLastPathComponent()

    static func spec11Rows() throws -> [String: SpecRow] {
        let text = try String(contentsOf: repoRoot.appendingPathComponent("specs/11-user-facing-errors.md"), encoding: .utf8)
        var rows: [String: SpecRow] = [:]
        for line in text.split(separator: "\n") where line.hasPrefix("| ") {
            let cells = line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
            guard cells.count == 3, cells[1].hasPrefix("\""), cells[1].hasSuffix("\"") else { continue }
            rows[cells[0]] = SpecRow(
                message: String(cells[1].dropFirst().dropLast()),
                buttons: cells[2].components(separatedBy: ", ")
            )
        }
        return rows
    }

    /// `ErrorKind` to SPEC-11 row name, from protocol/schemas/errors.json.
    static func protocolSpecRows() throws -> [String: String] {
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("protocol/schemas/errors.json"))
        let schema = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let defs = schema?["$defs"] as? [String: Any]
        let errorKind = defs?["ErrorKind"] as? [String: Any]
        return try #require(errorKind?["x-specRows"] as? [String: String])
    }

    /// SPEC-07 requirement 5: `Yumi says "..." with "Keep going" and "Stop" buttons.`
    static func spec07BlockedCopy() throws -> SpecRow {
        let text = try String(contentsOf: repoRoot.appendingPathComponent("specs/07-safety.md"), encoding: .utf8)
        let line = try #require(text.split(separator: "\n").first { $0.hasPrefix("5. A blocked action never runs") })
        let quotes = line.split(separator: "\"", omittingEmptySubsequences: false).enumerated()
            .filter { $0.offset % 2 == 1 }.map { String($0.element) }
        return SpecRow(message: quotes[0], buttons: Array(quotes.dropFirst()))
    }

    @Test(arguments: ErrorKind.allCases)
    func everyKindMatchesItsSpecText(kind: ErrorKind) throws {
        let copy = UserErrorCopy.copy(for: kind)
        let expected: SpecRow
        if kind == .blockedAction {
            #expect(copy.source == .spec07Requirement5)
            expected = try Self.spec07BlockedCopy()
        } else {
            let rowName = try #require(try Self.protocolSpecRows()[kind.rawValue], "\(kind) has no x-specRows entry")
            #expect(copy.source == .spec11Row(rowName))
            expected = try #require(try Self.spec11Rows()[rowName], "No SPEC-11 row named \(rowName)")
        }
        #expect(copy.message == expected.message)
        #expect(copy.buttons == expected.buttons)
    }

    /// The "Unexpected" variant defined by SPEC-11's scenario "Unexpected error before any action".
    @Test func unexpectedBeforeAnyActionMatchesTheScenario() throws {
        let text = try String(contentsOf: Self.repoRoot.appendingPathComponent("specs/11-user-facing-errors.md"), encoding: .utf8)
        let scenario = try #require(text.components(separatedBy: "Scenario: Unexpected error before any action").dropFirst().first)
        let steps = scenario.components(separatedBy: "Scenario:")[0].split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        let quoted = { (prefix: String) -> [String] in
            let line = steps.first { $0.hasPrefix(prefix) } ?? ""
            return line.split(separator: "\"", omittingEmptySubsequences: false).enumerated()
                .filter { $0.offset % 2 == 1 }.map { String($0.element) }
        }
        #expect([UserErrorCopy.unexpectedBeforeAnyAction.message] == quoted("Then the user sees"))
        #expect(UserErrorCopy.unexpectedBeforeAnyAction.buttons == quoted("And the buttons are"))
    }

    @Test func everySpec11RowIsInCode() throws {
        let inCode = Set(ErrorKind.allCases.compactMap { kind -> String? in
            if case .spec11Row(let name) = UserErrorCopy.copy(for: kind).source { return name }
            return nil
        })
        #expect(Set(try Self.spec11Rows().keys) == inCode)
    }

    @Test func speechNotSetUpIsItsOwnRow() {
        let copy = UserErrorCopy.copy(for: .speechRecognitionNotSetUp)
        #expect(copy.source == .spec11Row("Speech recognition not set up on this phone"))
        #expect(copy.buttons == ["Open settings", "Type instead"])
        #expect(copy.message != UserErrorCopy.copy(for: .languageNotSupported).message)
    }

    @Test func eachPermissionUsesItsSpecRow() {
        #expect(Permission.screenRecording.missingErrorKind == .screenPermissionMissing)
        #expect(Permission.accessibility.missingErrorKind == .accessibilityPermissionMissing)
        #expect(Permission.microphone.missingErrorKind == .microphonePermissionMissing)
    }
}
