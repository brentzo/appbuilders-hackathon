import Foundation

/// Runs the real harness from `harness/` (OBJ-03), the default since OBJ-27.8. It needs the repo on
/// disk with `npm install` run in `harness/` and `protocol/`.
///
/// Like the mock, it runs `node --import tsx` directly, so the harness is one process the supervisor
/// can stop and watch. The script path is absolute so the supervisor's leftover check finds
/// "harness" in its command line. The harness reads its settings (model server, bridge URL, support
/// folder) from the environment Yumi was started with.
struct RealHarnessLauncher: HarnessLauncher {
    let displayName = "harness"
    let isMock = false

    func makeProcess() async throws -> Process {
        let folder = MockHarnessLauncher.repoRoot.appendingPathComponent("harness")
        guard FileManager.default.fileExists(atPath: folder.path) else {
            throw HarnessLaunchError.protocolFolderMissing(folder)
        }
        guard FileManager.default.fileExists(atPath: folder.appendingPathComponent("node_modules/tsx").path) else {
            throw HarnessLaunchError.dependenciesMissing(folder)
        }
        guard let node = await NodeLocator.shared.nodeURL() else {
            throw HarnessLaunchError.nodeNotFound
        }
        let process = Process()
        process.executableURL = node
        process.currentDirectoryURL = folder
        process.arguments = ["--import", "tsx", folder.appendingPathComponent("src/main.ts").path]
        return process
    }
}
