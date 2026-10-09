import Foundation
import Testing
@testable import Yumi

/// SPEC-11 requirement 7 and scenario "Copy table matches the code": every row the app has in
/// code matches the table in specs/11-user-facing-errors.md, word for word.
struct UserErrorCopyTests {
    struct SpecRow {
        let message: String
        let buttons: [String]
    }

    static func specRows() throws -> [String: SpecRow] {
        let spec = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // YumiTests
            .deletingLastPathComponent() // mac
            .deletingLastPathComponent() // repo root
            .appendingPathComponent("specs/11-user-facing-errors.md")
        let text = try String(contentsOf: spec, encoding: .utf8)
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

    @Test(arguments: UserErrorKind.allCases)
    func matchesSpec11(kind: UserErrorKind) throws {
        let copy = UserErrorCopy.copy(for: kind)
        let row = try #require(try Self.specRows()[copy.specRow], "No SPEC-11 row named \(copy.specRow)")
        #expect(copy.message == row.message)
        #expect(copy.buttons == row.buttons)
    }

    @Test func eachPermissionUsesItsSpecRow() {
        #expect(Permission.screenRecording.missingErrorKind == .screenPermissionMissing)
        #expect(Permission.accessibility.missingErrorKind == .accessibilityPermissionMissing)
        #expect(Permission.microphone.missingErrorKind == .microphonePermissionMissing)
    }
}
